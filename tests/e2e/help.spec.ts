// Help during play: every game has a Help button in its own panel, which opens that game's rules without leaving it. It
// opens from the keyboard, closes with Escape or ×, gives focus back, and changes nothing about the game: the round and
// mystery clocks pause while it is open, a timed City Rush keeps its clock, and progress is untouched.
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, clockMs, contextFor, label, placement, readoutValue, sayCity, startMystery, startRegions, startRound, startRush, watch, type Size } from './helpers.ts';

type Game = { name: string; title: RegExp; start: (p: Page) => Promise<void>; clock: string; pauses: boolean; progress: (p: Page) => Promise<string> };
const roundCount = (p: Page) => p.locator('.hud-count').textContent().then(t => (t ?? '').trim());
const GAMES: Game[] = [
  { name: 'Find it Sprint', title: /^Sprint$/, start: p => startRound(p, 'Find it'), clock: '.hud .readout.time strong', pauses: true, progress: roundCount },
  { name: 'Name it Sprint', title: /^Sprint$/, start: p => startRound(p, 'Name it'), clock: '.hud .readout.time strong', pauses: true, progress: roundCount },
  { name: 'Flags Sprint', title: /^Sprint$/, start: p => startRound(p, 'Flags'), clock: '.hud .readout.time strong', pauses: true, progress: roundCount },
  { name: 'Full challenge', title: /^Full challenge$/, start: p => startRound(p, 'Find it', 'full'), clock: '.hud .readout.time strong', pauses: true, progress: roundCount },
  { name: 'Mystery', title: /^Mystery Country$/, start: startMystery, clock: '.mystery-hud .readout.time strong', pauses: true, progress: p => p.locator('.mystery-hud .readout.guesses strong').textContent().then(t => t ?? '') },
  { name: 'Regions', title: /^Regions: /, start: p => startRegions(p), clock: '.hud .readout.time strong', pauses: true, progress: roundCount },
  { name: 'City Rush', title: /^Quick Rush · Canada$/, start: async p => { await startRush(p, 'Quick'); await sayCity(p, 'Toronto'); }, clock: '.rush-hud .readout.time strong', pauses: false, progress: p => readoutValue(p, 'Cities') },
  { name: 'City Explorer', title: /^City Explorer · Canada$/, start: async p => { await startRush(p, 'City Explorer'); await sayCity(p, 'Ottawa'); }, clock: '.rush-hud .readout.time strong', pauses: false, progress: p => readoutValue(p, 'Cities') },
];

for (const size of [PHONE, DESKTOP] as Size[]) {
  test.describe(`Help in play at ${label(size)}`, () => {
    for (const g of GAMES) test(g.name, async ({ browser }) => {
      const ctx = await contextFor(browser, size);
      const page = await ctx.newPage();
      const w = watch(page);
      await g.start(page);
      const button = page.locator('.hud [aria-label="How to play"]');
      await expect(button).toBeVisible();
      await expect.poll(() => placement(page, '.hud [aria-label="How to play"]')).toBe('ok');
      const progress = await g.progress(page);

      // Opens from the keyboard, takes focus, and shows this game's rules.
      await button.focus();
      await page.keyboard.press('Enter');
      const help = page.locator('aside.help.in-game');
      await expect(help).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(help.locator('.card-head strong')).toHaveText(g.title);
      await expect(help.locator('.card-head .close')).toBeFocused();
      expect(await help.locator('.how.now li').count()).toBeGreaterThanOrEqual(3);
      await expect.poll(() => placement(page, 'aside.help'), { message: 'Help fits the screen' }).toBe('ok');
      // The game's own panel stays in view under it.
      await expect.poll(() => placement(page, '.hud')).toBe('ok');

      // The clock: paused for rounds and mysteries, running for City Rush.
      const t0 = clockMs((await page.locator(g.clock).textContent())!);
      await page.waitForTimeout(2200);
      const t1 = clockMs((await page.locator(g.clock).textContent())!);
      if (g.pauses) expect(Math.abs(t1 - t0), 'clock paused while Help is open').toBeLessThan(600);
      else expect(Math.abs(t1 - t0), 'City Rush clock keeps running').toBeGreaterThan(1200);

      // Escape closes it and gives focus back; nothing about the game changed.
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);
      await expect(button).toBeFocused();
      expect(await g.progress(page)).toBe(progress);
      if (g.pauses) {
        await page.waitForTimeout(1200);
        expect(clockMs((await page.locator(g.clock).textContent())!), 'clock runs again').toBeGreaterThan(t1 + 500);
      }
      // And the × closes it too.
      await button.click();
      await expect(help).toBeVisible();
      await help.locator('.card-head .close').click();
      await expect(help).toHaveCount(0);

      expect(w.errors).toEqual([]);
      await ctx.close();
    });
  });
}

test('Help outside a game is the full guide', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP);
  const page = await ctx.newPage();
  await page.goto('/');
  await page.click('.rail button:has-text("Help")');
  await expect(page.locator('aside.help .card-head strong')).toHaveText('How to play');
  await expect(page.locator('aside.help .how li')).toHaveCount(6);
  await ctx.close();
});
