// Every game, played through: it starts, takes its kind of answer, shows progress, and can be left or completed. Each
// runs on a touch phone and on a desktop, with no page errors and no CSP violations.
import { expect, test, type Page } from '@playwright/test';
import { decodeAnswer } from '../../src/game/mysteryRecords.ts';
import { ROSTER } from '../../src/data/roster.ts';
import { DESKTOP, PHONE, contextFor, finishRush, label, readoutValue, sayCity, startMystery, startRegions, startRound, startRush, storage, watch, type Size } from './helpers.ts';

const hudCount = (page: Page) => page.locator('.hud-count b').textContent().then(t => Number(t));
const clickMap = async (page: Page, touch: boolean) => {
  const box = (await page.locator('.map').boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height * 0.55];
  if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
};
// Reveals the current question with Show me and moves on.
const revealAndNext = async (page: Page) => {
  await page.click('.hud-meta .link:has-text("Show me")');
  await page.locator('.hud .btn.primary').click();
};

for (const size of [PHONE, DESKTOP] as Size[]) {
  const touch = size === PHONE;
  test.describe(`gameplay at ${label(size)}`, () => {
    let page: Page, w: ReturnType<typeof watch>;
    test.beforeEach(async ({ browser }) => {
      const ctx = await contextFor(browser, size, { fixedRandom: true });
      page = await ctx.newPage();
      w = watch(page);
    });
    test.afterEach(async () => {
      expect(w.errors, 'page errors').toEqual([]);
      expect(await w.csp(), 'CSP violations').toEqual([]);
      await page.context().close();
    });

    test('Find it: a click on the globe is answered, Show me moves on, × leaves', async () => {
      await startRound(page, 'Find it');
      await expect(page.locator('.hud-name .verb')).toHaveText('Find');
      const before = await page.locator('.hud-line').textContent();
      await clickMap(page, touch);
      await expect.poll(() => page.locator('.hud-line').textContent()).not.toBe(before);
      expect(await hudCount(page)).toBe(0);
      await revealAndNext(page);
      await expect.poll(() => hudCount(page)).toBe(1);
      await page.click('.hud-top .close');
      await expect(page.locator('.hud')).toHaveCount(0);
      await expect(page.locator('.challenge.sprint')).toBeVisible();
    });

    test('Name it: a wrong name is marked, the right one scores', async () => {
      // The Sprint's first country (Math.random is fixed), learned by revealing it…
      await startRound(page, 'Name it');
      await page.click('.hud-meta .link:has-text("Show me")');
      const answer = (await page.locator('.hud-name h2').textContent())!.trim();
      await page.click('.hud-top .close');
      // …and answered in the same Sprint, drawn again.
      await startRound(page, 'Name it');
      await page.fill('.answer-bar input', 'Atlantis');
      await page.keyboard.press('Enter');
      await expect(page.locator('.hud-wrong')).toContainText('Not “Atlantis”');
      await page.fill('.answer-bar input', answer);
      await page.keyboard.press('Enter');
      // Right on the 2nd attempt: 50 points, and straight on to the next country.
      await expect.poll(() => hudCount(page)).toBe(1);
      await expect(page.locator('.readout.score')).toHaveAttribute('aria-label', 'Score 50');
      await expect(page.locator('.hud-name h2')).toHaveText('?');
      await expect(page.locator('.answer-bar input')).toBeVisible();
    });

    test('Flags: the flag is asked, a click is answered', async () => {
      await startRound(page, 'Flags');
      await expect(page.locator('.flag-question')).toBeVisible();
      const before = await page.locator('.hud-line').textContent();
      await clickMap(page, touch);
      await expect.poll(() => page.locator('.hud-line').textContent()).not.toBe(before);
      await revealAndNext(page);
      await expect.poll(() => hudCount(page)).toBe(1);
    });

    test('Sprint: ten questions to the results, which offer another run', async () => {
      test.slow();
      await startRound(page, 'Find it');
      await expect(page.locator('.hud-count')).toContainText('/ 10');
      for (let i = 0; i < 10; i++) await revealAndNext(page);
      await expect(page.locator('.hud')).toHaveCount(0);
      await expect(page.locator('.panel .btn.primary')).toBeVisible();
      // The run is recorded once.
      const store = await storage(page, 'atlas-performance-v2');
      const runs = Object.values(store as { [k: string]: { runs: number } }).map(p => p.runs);
      expect(runs).toEqual([1]);
    });

    test('Full challenge: every country of the area, and it can be left', async () => {
      await startRound(page, 'Find it', 'full');
      const total = Number((await page.locator('.hud-count').textContent())!.split('/')[1]);
      expect(total).toBeGreaterThan(10);
      await revealAndNext(page);
      await expect.poll(() => hudCount(page)).toBe(1);
      await page.click('.hud-top .close');
      await expect(page.locator('.hud')).toHaveCount(0);
    });

    test('Mystery: guesses are counted and coloured, the answer solves it', async () => {
      await startMystery(page);
      for (const g of ['France', 'Japan']) {
        await page.fill('.mystery-search input', g);
        await page.keyboard.press('Enter');
        await expect(page.locator('.mystery-search input')).toHaveValue('');
      }
      await expect(page.locator('.mystery-hud .readout.guesses strong')).toHaveText(/^[12]$/);   // one of them may be the answer
      const saved = await storage(page, 'atlas-mystery-active-v1');
      if (saved) {
        const answer = ROSTER.find(r => r.id === decodeAnswer(saved.answer))!.name;
        await page.fill('.mystery-search input', answer);
        await page.keyboard.press('Enter');
      }
      await expect(page.locator('.mystery-hud')).toHaveCount(0);
      await expect(page.locator('.mystery-results, .panel').first()).toBeVisible();
      expect(await storage(page, 'atlas-mystery-active-v1')).toBeNull();
    });

    test('Mystery: can be left', async () => {
      await startMystery(page);
      await page.click('.mystery-hud .hud-top .close');
      await expect(page.locator('.mystery-hud')).toHaveCount(0);
    });

    test('Regions: a country\'s provinces, a click answered, progress, leave', async () => {
      await startRegions(page);
      const before = await page.locator('.hud-line').textContent();
      await clickMap(page, touch);
      await expect.poll(() => page.locator('.hud-line').textContent()).not.toBe(before);
      await revealAndNext(page);
      await expect.poll(() => hudCount(page)).toBe(1);
      await page.click('.hud-top .close');
      await expect(page.locator('.hud')).toHaveCount(0);
    });

    test('City Rush: cities add people, unknown names are told apart, Finish shows the results', async () => {
      await startRush(page, 'Quick');
      expect(await sayCity(page, 'Toronto')).toMatch(/Toronto/);
      expect(await readoutValue(page, 'Cities')).toBe('1');
      await expect.poll(() => readoutValue(page, 'Coverage')).not.toMatch(/^0(\.0)?%$/);
      expect(await sayCity(page, 'Toronto')).toMatch(/already/i);
      expect(await sayCity(page, 'Qwxyzzy')).toMatch(/Qwxyzzy/);
      await expect(page.locator('.rush-bar input'), 'an unknown name stays, to be corrected').toHaveValue('Qwxyzzy');
      expect(await readoutValue(page, 'Cities')).toBe('1');
      // Typing keeps the field focused, so the next city can be typed straight away.
      expect(await page.evaluate(() => document.activeElement?.closest('.rush-bar') !== null)).toBe(true);
      await finishRush(page);
      await expect(page.locator('.rush-results')).toContainText('Toronto');
    });

    test('City Explorer: cities found, Leave keeps the map, Finish shows it', async () => {
      await startRush(page, 'City Explorer');
      await sayCity(page, 'Ottawa');
      await page.click('.rush-hud button:has-text("Leave")');
      await expect(page.locator('.rush-setup')).toBeVisible();
      await expect(page.locator('.rush-modes button:has-text("City Explorer")')).toContainText('1 found');
      await page.click('.rush-modes button:has-text("City Explorer")');
      await page.click('.rush-setup .btn.primary');
      expect(await readoutValue(page, 'Cities')).toBe('1');
      await finishRush(page);
    });
  });
}
