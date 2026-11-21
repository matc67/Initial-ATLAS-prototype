// What City Rush and the rounds keep in the browser: timed runs survive a refresh with their clock, expired runs take no
// more guesses, abandoned runs leave no record, completed runs are recorded exactly once, City Explorer maps persist per
// country, and records from another data version are kept but never compared.
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, clockMs, contextFor, finishRush, openRush, readoutValue, sayCity, startRush, storage } from './helpers.ts';

const BESTS = 'atlas-city-rush-bests-v2', ACTIVE = 'atlas-city-rush-active-v2', EXPLORER = 'atlas-city-rush-explorer-v2', LEARNING = 'atlas-city-rush-learning-v1';
type TimedRecord = { runs: number; best: number; version: string; country: string };
const timeLeft = async (p: Page) => clockMs((await p.locator('.rush-hud .readout.time strong').textContent())!);
const records = async (p: Page) => ((await storage(p, BESTS)) ?? {}) as { [key: string]: TimedRecord };

test.describe('City Rush persistence', () => {
  let page: Page;
  test.beforeEach(async ({ browser }) => { page = await (await contextFor(browser, DESKTOP)).newPage(); });
  test.afterEach(async () => { await page.context().close(); });

  test('a timed run survives a refresh, and its clock does not restart', async () => {
    await startRush(page, 'Marathon');
    await sayCity(page, 'Toronto');
    const before = await timeLeft(page);
    await page.waitForTimeout(3000);
    await page.reload();
    await expect(page.locator('.rush-bar input')).toBeVisible({ timeout: 60_000 });
    const after = await timeLeft(page);
    expect(after, 'the clock kept running through the refresh').toBeLessThanOrEqual(before - 2500);
    expect(after, 'and did not start over').toBeGreaterThan(before - 20_000);
    expect(await readoutValue(page, 'Cities')).toBe('1');
  });

  test('a run that ends takes no more guesses, and is recorded once', async () => {
    await page.clock.install();
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await page.clock.fastForward('03:05');
    await expect(page.locator('.rush-results')).toBeVisible();
    await expect(page.locator('.rush-bar input')).toHaveCount(0);
    expect(Object.values(await records(page)).map(r => r.runs)).toEqual([1]);
    // A refresh after the results records nothing again (and opens the game menu: no run is in progress).
    await page.reload();
    await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible({ timeout: 60_000 });
    expect(Object.values(await records(page)).map(r => r.runs)).toEqual([1]);
  });

  test('a run that expired while the page was closed ends on return, with no input', async () => {
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    // Leave (the page saves the run as it goes), then move the saved start back past its deadline, as if the player came
    // back an hour later. The edit is made on a page of the same site without the game, which would save over it.
    await page.goto('/release.json');
    await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)!); s.startedAt -= 3_600_000; s.updatedAt -= 3_600_000; localStorage.setItem(k, JSON.stringify(s)); }, ACTIVE);
    await page.goto('/');
    await expect(page.locator('.rush-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.rush-bar input')).toHaveCount(0);
    const rec = Object.values(await records(page));
    expect(rec.map(r => r.runs)).toEqual([1]);
    expect(rec[0].best, 'Toronto still counts').toBeGreaterThan(0);
    expect(await storage(page, ACTIVE)).toBeNull();
  });

  test('an abandoned run leaves no record', async () => {
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await page.click('.rush-hud button:has-text("Abandon")');
    await page.click('.rush-hud button:has-text("Discard run")');
    await expect(page.locator('.rush-setup')).toBeVisible();
    expect(await records(page)).toEqual({});
    expect(await storage(page, LEARNING)).toBeNull();
    expect(await storage(page, ACTIVE)).toBeNull();
  });

  test('a finished run is recorded exactly once, with what it missed', async () => {
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    const rec = Object.entries(await records(page));
    expect(rec).toHaveLength(1);
    expect(rec[0][0]).toMatch(/^CAN:180@/);
    expect(rec[0][1].runs).toBe(1);
    const learning = await storage(page, LEARNING);
    expect(Object.keys(learning)).toEqual(['CAN:timed-180']);
    expect(learning['CAN:timed-180'].missed.length).toBeGreaterThan(0);
  });

  test('City Explorer keeps each country\'s map, through a refresh', async () => {
    await startRush(page, 'City Explorer', 'CAN');
    await sayCity(page, 'Ottawa');
    // A refresh opens the game menu (City Explorer has no clock to come back to); the map waits on the country's card.
    await page.reload();
    await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible({ timeout: 60_000 });
    await startRush(page, 'City Explorer', 'CAN');
    expect(await readoutValue(page, 'Cities')).toBe('1');
    await page.click('.rush-hud button:has-text("Leave")');

    await startRush(page, 'City Explorer', 'USA');
    expect(await readoutValue(page, 'Cities'), 'another country starts empty').toBe('0');
    await sayCity(page, 'Chicago');
    await sayCity(page, 'Houston');
    await page.click('.rush-hud button:has-text("Leave")');

    const store = await storage(page, EXPLORER);
    expect(Object.keys(store.countries).sort()).toEqual(['CAN', 'USA']);
    expect(store.countries.CAN.found).toHaveLength(1);
    expect(store.countries.USA.found).toHaveLength(2);
    await openRush(page, 'CAN');
    await expect(page.locator('.rush-modes button:has-text("City Explorer")')).toContainText('1 found');
    await openRush(page, 'USA');
    await expect(page.locator('.rush-modes button:has-text("City Explorer")')).toContainText('2 found');
  });

  test('a record from another data version is kept, but not compared', async () => {
    await page.goto('/');
    const old: TimedRecord & { [k: string]: unknown } = {
      country: 'CAN', durationMs: 180_000, version: 'an-older-version', total: 30_000_000, runs: 4,
      best: 29_000_000, bestCities: 400, bestAt: '2026-01-01T00:00:00.000Z', latest: 1, latestCities: 1, latestAt: '2026-01-01T00:00:00.000Z', history: [1],
    };
    await page.evaluate(([k, rec]) => localStorage.setItem(k, JSON.stringify({ 'CAN:180@an-older-version': rec })), [BESTS, old] as const);
    await openRush(page, 'CAN');
    // The old best (97%) is not offered as this version's best.
    await expect(page.locator('.rush-modes button:has-text("Quick")')).not.toContainText('Best');
    await page.click('.rush-modes button:has-text("Quick")');
    await page.click('.rush-setup .btn.primary');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await expect(page.locator('.rush-results')).toContainText('First run: the score to beat');
    const rec = await records(page);
    expect(rec['CAN:180@an-older-version'], 'the old record is untouched').toEqual(old);
    expect(Object.keys(rec)).toHaveLength(2);
  });
});

test('a Mystery in progress survives a refresh with its guesses', async ({ browser }) => {
  const page = await (await contextFor(browser, DESKTOP)).newPage();
  await page.goto('/');
  await page.locator('.challenge.mystery:not([disabled])').click({ timeout: 60_000 });
  const guesses = page.locator('.mystery-hud .readout.guesses strong');
  for (const g of ['Iceland', 'Chile']) {
    const before = Number(await guesses.textContent());
    await page.fill('.mystery-search input', g);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await page.locator('.mystery-hud').count()) === 0 || Number(await guesses.textContent()) > before).toBe(true);
    if (!(await page.locator('.mystery-hud').count())) test.skip(true, 'the mystery happened to be one of the guesses');
  }
  await page.reload();
  await expect(guesses).toHaveText('2', { timeout: 60_000 });
  await page.context().close();
});
