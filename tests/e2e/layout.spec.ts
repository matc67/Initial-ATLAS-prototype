// Every game at every checked viewport: the essential controls on screen, no sideways scrolling, panels inside the
// viewport, and the map left visible. Map share is compared with what Sprint C measured (Sprint B's figures or better),
// with room for small changes (MIN_SHARE_SLACK points), so a test fails only when the interface really starts covering
// the map.
import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, contextFor, finishRush, isTouch, label, mapShare, overflowsX, placement, sayCity, smallTargets, startMystery, startRegions, startRound, startRush, home, type Size } from './helpers.ts';

const MIN_SHARE_SLACK = 6;
// The share of the screen showing the map in Sprint C, per viewport, in VIEWPORTS order.
type Baseline = [number, number, number, number, number, number, number, number];
type Scenario = { start: (p: Page) => Promise<void>; essentials: string[]; baseline?: Baseline; touchWithin?: string };
const HELP = '.hud [aria-label="How to play"]';
const SCENARIOS: { [name: string]: Scenario } = {
  'game menu': { start: home, essentials: ['.challenge.sprint'] },
  'Find it': { start: p => startRound(p, 'Find it'), essentials: ['.hud', '.hud-name', '.hud-top .exit', HELP], baseline: [71, 77, 81, 83, 82, 74, 82, 89], touchWithin: '.hud' },
  'Name it': { start: p => startRound(p, 'Name it'), essentials: ['.hud', '.answer-bar input', '.hud-top .exit', HELP], baseline: [61, 69, 76, 78, 79, 68, 79, 87], touchWithin: '.hud' },
  'Flags': { start: p => startRound(p, 'Flags'), essentials: ['.hud', '.hud-name', '.hud-top .exit', HELP], baseline: [67, 75, 80, 82, 80, 68, 80, 88], touchWithin: '.hud' },
  'Full challenge': { start: p => startRound(p, 'Find it', 'full'), essentials: ['.hud', '.hud-name', '.hud-top .exit', HELP], baseline: [71, 77, 81, 83, 82, 74, 82, 89], touchWithin: '.hud' },
  'Mystery': { start: startMystery, essentials: ['.mystery-hud', '.mystery-search input', '.mystery-hud .hud-top .exit', HELP], baseline: [71, 76, 81, 83, 84, 66, 81, 87], touchWithin: '.mystery-hud' },
  'Regions': { start: p => startRegions(p), essentials: ['.hud', '.hud-name', '.hud-top .exit', HELP], baseline: [71, 77, 81, 83, 82, 74, 82, 89], touchWithin: '.hud' },
  'City Rush': {
    start: async p => { await startRush(p, 'Classic'); for (const c of ['Toronto', 'Montreal', 'Calgary']) await sayCity(p, c); },
    essentials: ['.rush-bar input', '.rush-hud .readout.time', '.rush-hud', '.rush-hud .finish', '.rush-hud .exit', HELP], baseline: [62, 68, 74, 76, 79, 60, 79, 84], touchWithin: '.rush-hud',
  },
  'City Explorer': {
    start: async p => { await startRush(p, 'City Explorer'); await sayCity(p, 'Ottawa'); },
    essentials: ['.rush-bar input', '.rush-hud', '.rush-hud .exit', HELP], baseline: [62, 68, 74, 76, 79, 60, 79, 84], touchWithin: '.rush-hud',
  },
  'City Rush results': {
    start: async p => { await startRush(p, 'Classic'); for (const c of ['Toronto', 'Montreal']) await sayCity(p, c); await finishRush(p); },
    essentials: ['.rush-results'], baseline: [46, 49, 51, 50, 59, 57, 70, 78],
  },
};

for (const [name, sc] of Object.entries(SCENARIOS)) {
  test.describe(name, () => {
    VIEWPORTS.forEach((size: Size, i) => {
      test(label(size), async ({ browser }) => {
        const ctx = await contextFor(browser, size);
        const page = await ctx.newPage();
        await sc.start(page);
        await page.waitForTimeout(900);   // the camera settles and the panels finish sliding in
        for (const s of sc.essentials) await expect.poll(() => placement(page, s), { message: `${s} on screen` }).toBe('ok');
        expect(await overflowsX(page), 'no sideways scrolling').toBe(false);
        if (sc.baseline) {
          const share = await mapShare(page);
          test.info().annotations.push({ type: 'map share', description: `${share}%` });
          expect(share, `map share ${share}% (baseline ${sc.baseline[i]}%)`).toBeGreaterThanOrEqual(sc.baseline[i] - MIN_SHARE_SLACK);
        }
        if (sc.touchWithin && isTouch(size)) expect(await smallTargets(page, sc.touchWithin, 36), 'touch targets under 36px').toEqual([]);
        await ctx.close();
      });
    });
  });
}

// On phones, folded results give the map back.
for (const size of VIEWPORTS.filter(([w]) => w <= 760)) {
  test(`City Rush results fold to show the map at ${label(size)}`, async ({ browser }) => {
    const ctx = await contextFor(browser, size);
    const page = await ctx.newPage();
    await SCENARIOS['City Rush results'].start(page);
    await page.click('.results-peek button');
    await expect(page.locator('.rush-results.peek')).toBeVisible();
    const share = await mapShare(page);
    test.info().annotations.push({ type: 'map share', description: `${share}%` });
    expect(share).toBeGreaterThanOrEqual(75);
    await page.click('.results-peek button');
    await expect(page.locator('.rush-results .btn.primary')).toBeVisible();
    await ctx.close();
  });
}

// Round and Mystery results fold the same way on phones.
const solveMystery = async (page: Page) => {
  const { decodeAnswer } = await import('../../src/game/mysteryRecords.ts');
  const { ROSTER } = await import('../../src/data/roster.ts');
  await startMystery(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas-mystery-active-v1') ?? 'null'));
  await page.fill('.mystery-search input', ROSTER.find(r => r.id === decodeAnswer(saved.answer))!.name);
  await page.keyboard.press('Enter');
};
const finishSprint = async (page: Page) => {
  await startRound(page, 'Find it');
  for (let i = 0; i < 10; i++) { await page.click('.hud-meta .link:has-text("Show me")'); await page.locator('.hud .btn.primary').click(); }
};
for (const [name, reach] of [['Sprint', finishSprint], ['Mystery', solveMystery]] as const) {
  for (const size of [[320, 568], [390, 844]] as Size[]) {
    test(`${name} results fold to show the map at ${label(size)}`, async ({ browser }) => {
      const ctx = await contextFor(browser, size);
      const page = await ctx.newPage();
      await reach(page);
      const row = page.locator('.panel .results-peek');
      await expect(row).toBeVisible();
      const open = await mapShare(page);
      await row.locator('button').click();
      await expect(page.locator('.panel.peek')).toBeVisible();
      const folded = await mapShare(page);
      test.info().annotations.push({ type: 'map share', description: `${open}% open, ${folded}% folded` });
      // Folded, only the summary line, the area tabs and the navigation remain (results keep the navigation).
      expect(folded).toBeGreaterThanOrEqual(68);
      expect(folded).toBeGreaterThan(open + 15);
      await row.locator('button').click();
      await expect(page.locator('.panel .btn.primary').first()).toBeVisible();
      await ctx.close();
    });
  }
}

test('results do not fold on a desktop: they sit beside the globe', async ({ browser }) => {
  const ctx = await contextFor(browser, [1440, 900]);
  const page = await ctx.newPage();
  await finishSprint(page);
  await expect(page.locator('.panel .results-peek')).toBeHidden();
  await ctx.close();
});
