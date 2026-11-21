// How players move between game selection, setup, play, the exit question and results (v1.2). Every game has an Exit
// back to the menu, which asks first only when progress would be lost and never shows results, answers or a record;
// Finish (timed City Rush) ends a run with exactly one result; and none of it wears out when repeated.
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, clockMs, contextFor, exitGame, finishRush, home, label, openRush, readoutValue, sayCity, startMystery, startRegions, startRound, startRush, storage, watch, type Size } from './helpers.ts';

const BESTS = 'atlas-city-rush-bests-v2', LEARNING = 'atlas-city-rush-learning-v1', ACTIVE = 'atlas-city-rush-active-v2';
const menu = (p: Page) => p.locator('.challenge.sprint:not([disabled])');
const dialog = (p: Page) => p.locator('.exit-confirm');
const runsRecorded = async (p: Page) => Object.values(((await storage(p, BESTS)) ?? {}) as { [k: string]: { runs: number } }).reduce((n, r) => n + r.runs, 0);
const reveal = async (p: Page) => { await p.click('.hud-meta .link:has-text("Show me")'); await p.locator('.hud .btn.primary').click(); };

// Each game, with one step of progress made, and how to tell its state is unchanged.
type Game = { name: string; start: (p: Page) => Promise<void>; progress: (p: Page) => Promise<void>; state: (p: Page) => Promise<string>; back?: (p: Page) => Promise<void> };
const roundState = (p: Page) => p.locator('.hud-count').textContent().then(t => t ?? '');
const GAMES: Game[] = [
  { name: 'Find it', start: p => startRound(p, 'Find it'), progress: reveal, state: roundState },
  { name: 'Name it', start: p => startRound(p, 'Name it'), progress: reveal, state: roundState },
  { name: 'Flags', start: p => startRound(p, 'Flags'), progress: reveal, state: roundState },
  { name: 'Full challenge', start: p => startRound(p, 'Find it', 'full'), progress: reveal, state: roundState },
  { name: 'Mystery', start: startMystery, progress: async p => { await p.fill('.mystery-search input', 'Iceland'); await p.keyboard.press('Enter'); await expect(p.locator('.mystery-hud .readout.guesses strong')).not.toHaveText('0'); }, state: p => p.locator('.mystery-hud .readout.guesses strong').textContent().then(t => t ?? '') },
  { name: 'Regions', start: p => startRegions(p), progress: reveal, state: roundState, back: async p => { await expect(p.locator('.panel.sub, .region-mode').first()).toBeVisible(); } },
  { name: 'City Rush', start: p => startRush(p, 'Quick'), progress: async p => { await sayCity(p, 'Toronto'); }, state: p => readoutValue(p, 'Cities') },
];

for (const size of [[320, 568], PHONE, [768, 1024], DESKTOP] as Size[]) {
  test.describe(`exit at ${label(size)}`, () => {
    for (const g of GAMES) test(g.name, async ({ browser }) => {
      const ctx = await contextFor(browser, size); const page = await ctx.newPage(); const w = watch(page);
      // With nothing to lose, Exit leaves at once.
      await g.start(page);
      await expect(page.locator('.hud .exit').first()).toBeVisible();
      await exitGame(page, false);
      if (g.back) await g.back(page); else await expect(menu(page)).toBeVisible();
      // With progress, it asks; Continue playing (or Escape) changes nothing.
      await g.start(page);
      await g.progress(page);
      const before = await g.state(page);
      await page.locator('.hud .exit').first().click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).locator('button:has-text("Continue playing")')).toBeFocused();
      await dialog(page).locator('button:has-text("Continue playing")').click();
      await expect(dialog(page)).toHaveCount(0);
      expect(await g.state(page)).toBe(before);
      await page.locator('.hud .exit').first().click();
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.locator('.hud').first()).toBeVisible();
      // Exit to menu: no results, no answers, no record.
      await page.locator('.hud .exit').first().click();
      await dialog(page).locator('button:has-text("Exit to menu")').click();
      await expect(page.locator('.hud')).toHaveCount(0);
      if (g.back) await g.back(page); else await expect(menu(page)).toBeVisible();
      await expect(page.locator('.rush-results, .sprint-results, .mystery-results, .rush-missed')).toHaveCount(0);
      if (g.name === 'City Rush') {
        expect(await storage(page, BESTS)).toBeNull();
        expect(await storage(page, LEARNING)).toBeNull();
        expect(await storage(page, ACTIVE)).toBeNull();
      } else if (g.name !== 'Mystery') {
        expect(await storage(page, 'atlas-performance-v2')).toBeNull();
      }
      expect(w.errors).toEqual([]);
      await ctx.close();
    });
  });
}

test('the reported cycle, three times: finish, results, play again, menu, start, exit', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage(); const w = watch(page);
  await home(page);
  let finished = 0;
  for (let i = 0; i < 3; i++) {
    // Menu → City Rush → Start → Finish → Results
    await page.locator('.challenge', { hasText: 'City Rush' }).first().click();
    await expect(page.locator('.rush-setup')).toBeVisible();
    if (!(await page.locator('.rush-setup h1', { hasText: 'Canada' }).count())) { await page.fill('.rush-setup input', 'Canada'); await page.keyboard.press('Enter'); }
    await expect(page.locator('.rush-setup h1')).toContainText('Canada');
    await page.click('.rush-modes button:has-text("Quick")');
    await page.click('.rush-setup .btn.primary');
    expect(clockMs(await page.locator('.rush-hud .readout.time strong').textContent() ?? '')).toBeGreaterThan(175_000);
    expect(await readoutValue(page, 'Cities')).toBe('0');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    expect(await runsRecorded(page)).toBe(++finished);
    await expect(page.locator('.rush-missed')).toBeVisible();
    // → Play again → Finish → Results: a fresh run, its own single result.
    await page.click('.rush-results .btn.primary');
    expect(await readoutValue(page, 'Cities')).toBe('0');
    expect(clockMs(await page.locator('.rush-hud .readout.time strong').textContent() ?? '')).toBeGreaterThan(175_000);
    await sayCity(page, 'Montreal');
    await finishRush(page);
    expect(await runsRecorded(page)).toBe(++finished);
    // → Menu → Start again → Exit → Menu: nothing recorded, no results shown.
    await page.locator('.rush-results button:has-text("Back to menu")').first().click();
    await expect(menu(page)).toBeVisible();
    await expect(page.locator('.rush-results, .rush-setup, .rush-hud')).toHaveCount(0);
    await page.locator('.challenge', { hasText: 'City Rush' }).first().click();
    await page.click('.rush-setup .btn.primary');
    await sayCity(page, 'Calgary');
    await exitGame(page, true);
    await expect(menu(page)).toBeVisible();
    expect(await runsRecorded(page)).toBe(finished);
    await expect(page.locator('.rush-results, .exit-confirm, .share-sheet, .rush-list')).toHaveCount(0);
  }
  expect(w.errors).toEqual([]);
  await ctx.close();
});

test('repeated start and exit, in every kind of game, never wears out', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, PHONE); const page = await ctx.newPage();
  for (let i = 0; i < 3; i++) {
    for (const g of [GAMES[0], GAMES[4], GAMES[6]]) {
      await g.start(page);
      await g.progress(page);
      await exitGame(page, true);
      await expect(menu(page)).toBeVisible();
    }
  }
  expect(await storage(page, BESTS)).toBeNull();
  await ctx.close();
});

test('switching modes and countries from results and setup', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
  await startRush(page, 'Quick');
  await sayCity(page, 'Toronto');
  await finishRush(page);
  await page.click('.rush-results button:has-text("Change country or mode")');
  await page.fill('.rush-setup input', 'Australia'); await page.keyboard.press('Enter');
  await expect(page.locator('.rush-setup h1')).toContainText('Australia');
  await page.click('.rush-modes button:has-text("Classic")');
  await page.click('.rush-setup .btn.primary');
  await expect(page.locator('.rush-hud .hud-area')).toContainText('Classic Rush');
  await expect(page.locator('.rush-hud .hud-area')).toContainText('Australia');
  expect(await readoutValue(page, 'Cities')).toBe('0');
  await exitGame(page, false);
  // Rounds: another mode from the menu after exiting.
  await startRound(page, 'Find it');
  await exitGame(page, false);
  await startRound(page, 'Name it');
  await expect(page.locator('.answer-bar input')).toBeVisible();
  await ctx.close();
});

test('the Play tab is the game menu: from results, from a City Rush setup, and after visiting Explore', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
  await startRush(page, 'Quick');
  await sayCity(page, 'Toronto');
  await finishRush(page);
  await page.click('.rail button:has-text("Play")');
  await expect(menu(page)).toBeVisible();
  await openRush(page, 'CAN');
  await page.click('.rail button:has-text("Explore")');
  await page.click('.rail button:has-text("Play")');
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('.rush-setup')).toHaveCount(0);
  // During a round it asks, like Exit.
  await startRound(page, 'Find it');
  await reveal(page);
  await page.click('.rail button:has-text("Play")');
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator('button:has-text("Exit to menu")').click();
  await expect(menu(page)).toBeVisible();
  await ctx.close();
});

test('City Rush offers three modes; 5- and 20-minute records stay, and old links to them still play', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
  await page.goto('/');
  const old = (s: number) => ({ country: 'CAN', durationMs: s * 1000, version: 'v-old', total: 100, runs: 3, best: 40, bestCities: 9, bestAt: '', latest: 1, latestCities: 1, latestAt: '', history: [1] });
  await page.evaluate(([k, a, b]) => { localStorage.setItem(k, JSON.stringify({ 'CAN:300@v-old': a, 'CAN:1200@v-old': b })); localStorage.setItem('atlas-city-rush-choice-v1', '1200'); }, [BESTS, old(300), old(1200)] as const);
  await openRush(page, 'CAN');
  await expect(page.locator('.rush-modes button')).toHaveText([/Quick Rush.*3 min/, /Classic Rush.*10 min/, /City Explorer.*Unlimited/]);
  await expect(page.locator('.rush-modes button.on')).toContainText('Classic Rush');   // the saved 20-minute choice
  await page.click('.rush-modes button:has-text("Quick")');
  await page.click('.rush-setup .btn.primary');
  await sayCity(page, 'Toronto');
  await finishRush(page);
  const bests = await storage(page, BESTS);
  expect(bests['CAN:300@v-old']).toEqual(old(300));
  expect(bests['CAN:1200@v-old']).toEqual(old(1200));
  // A challenge link to a 5-minute Rush still plays 5 minutes.
  await page.goto('/?rush=CAN&t=300&beat=1.0');
  await page.locator('.challenge-invite button:has-text("Accept the challenge")').click({ timeout: 60_000 });
  await expect(page.locator('.rush-modes button.on')).toContainText('5-Minute Rush');
  await expect(page.locator('.rush-modes button')).toHaveCount(4);
  await page.click('.rush-setup .btn.primary');
  expect(clockMs(await page.locator('.rush-hud .readout.time strong').textContent() ?? '')).toBeGreaterThan(295_000);
  await ctx.close();
});

// Every map label or marker that overlaps an interface panel is under it: the point where they overlap belongs to the panel.
const labelsUnderPanels = (page: Page) => page.evaluate(() => {
  const panels = [...document.querySelectorAll('.card, .hud, .answer-bar, .rail, .zoom, .sheet-backdrop')].filter(e => getComputedStyle(e).display !== 'none');
  const bad: string[] = [];
  for (const m of document.querySelectorAll('.maplibregl-marker')) {
    const r = m.getBoundingClientRect();
    if (!r.width || getComputedStyle(m).visibility === 'hidden') continue;
    for (const p of panels) {
      const q = p.getBoundingClientRect();
      const x0 = Math.max(r.left, q.left), x1 = Math.min(r.right, q.right), y0 = Math.max(r.top, q.top), y1 = Math.min(r.bottom, q.bottom);
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      const top = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      if (top && m.contains(top)) bad.push(`${(m.textContent ?? '').trim() || m.className} over ${p.className}`);
    }
  }
  return bad;
});

test('map labels stay under menus, lists, results, Help and dialogs, also while the camera moves', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
  await openRush(page, 'USA');
  expect(await labelsUnderPanels(page), 'setup').toEqual([]);
  await page.click('.rush-modes button:has-text("Quick")');
  await page.click('.rush-setup .btn.primary');
  for (const c of ['Miami', 'Key West', 'Key Largo', 'Florida City', 'Homestead', 'Hialeah', 'Los Angeles']) await sayCity(page, c);
  await expect(page.locator('.rush-list')).toBeVisible();
  // Fly to Florida so its labels sit under the list of found cities, as in the report.
  await page.locator('.rush-list li button', { hasText: 'Key West' }).click();
  for (let i = 0; i < 8; i++) { expect(await labelsUnderPanels(page), `found-cities list, during the flight (${i})`).toEqual([]); await page.waitForTimeout(150); }
  await page.locator('.hud [aria-label="How to play"]').click();
  expect(await labelsUnderPanels(page), 'Help').toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('.hud .exit').click();
  expect(await labelsUnderPanels(page), 'exit dialog').toEqual([]);
  await page.locator('.exit-confirm button:has-text("Continue playing")').click();
  await finishRush(page);
  await page.locator('.rush-missed li button').first().click();
  for (let i = 0; i < 6; i++) { expect(await labelsUnderPanels(page), `results, during the flight (${i})`).toEqual([]); await page.waitForTimeout(150); }
  await page.click('.zoom button[aria-label="Zoom in"]');
  await page.waitForTimeout(700);
  expect(await labelsUnderPanels(page), 'results after zooming').toEqual([]);
  await page.locator('.rush-results button:has-text("Back to menu")').first().click();
  expect(await labelsUnderPanels(page), 'game menu').toEqual([]);
  await ctx.close();
});

test('the coverage bar draws only the bar and thin markers: no stray box', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
  await openRush(page, 'CAN');
  const { dataDir } = await (await page.request.get('/release.json')).json();
  const f = await (await page.request.get(`/${dataDir}cities/CAN.json`)).json();
  await page.evaluate(([v, tot]) => localStorage.setItem('atlas-city-rush-bests-v2', JSON.stringify({ [`CAN:180@${v}`]: { country: 'CAN', durationMs: 180000, version: v, total: tot, runs: 1, best: Math.round(tot * 0.035), bestCities: 2, bestAt: '', latest: 1, latestCities: 1, latestAt: '', history: [1] } })), [f.version, f.population] as const);
  await startRush(page, 'Quick');
  await sayCity(page, 'Toronto');
  const mark = page.locator('.rush-progress .bar-mark');
  await expect(mark).toHaveCount(1);
  const box = (await mark.boundingBox())!, bar = (await page.locator('.rush-progress .bar').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(3);
  expect(box.height).toBeLessThanOrEqual(bar.height + 7);
  expect(await mark.evaluate(e => { const s = getComputedStyle(e); return [s.paddingLeft, s.borderTopWidth]; })).toEqual(['0px', '0px']);
  // The best marker sits at 3.5% of the bar.
  expect(Math.abs(box.x + box.width / 2 - (bar.x + bar.width * 0.035))).toBeLessThan(3);
  await ctx.close();
});
