// Phones: the game menu and the City Rush setup are bottom sheets (components/Sheet.tsx). Collapsed on arrival so the
// globe comes first; tap or swipe to expand; a tap on the globe folds them; every option reachable and never covered by
// the Start button; the navigation always usable. Larger screens keep the side panel exactly as before.
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, contextFor, label, mapShare, openMenu, type Size } from './helpers.ts';

const PHONES: Size[] = [[320, 568], [390, 844], [430, 932]];
const menu = (p: Page) => p.locator('.play-menu');
const toggle = (p: Page) => p.locator('.play-menu .sheet-toggle');
const expanded = (p: Page) => toggle(p).getAttribute('aria-expanded');
// True when the element's centre is really the element (nothing drawn over it).
const uncovered = (p: Page, sel: string) => p.locator(sel).evaluateAll(els => els.map(e => {
  e.scrollIntoView({ block: 'nearest' });
  const r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!top && (top === e || e.contains(top));
}));
async function swipe(p: Page, sel: string, dy: number) {
  const b = (await p.locator(sel).boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y + dy, { steps: 6 }); await p.mouse.up();
}

for (const size of PHONES) {
  test.describe(`bottom sheets at ${label(size)}`, () => {
    test('the menu arrives collapsed, leaving the globe and the navigation', async ({ browser }) => {
      const ctx = await contextFor(browser, size); const page = await ctx.newPage();
      await page.goto('/');
      await expect(menu(page)).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      expect(await expanded(page)).toBe('false');
      expect((await menu(page).boundingBox())!.height).toBeLessThan(90);
      await expect(menu(page)).toContainText('Choose a game');
      expect(await mapShare(page)).toBeGreaterThanOrEqual(size[0] === 320 ? 68 : 76);
      // The options are out of reach of the keyboard and screen readers while collapsed.
      expect(await page.locator('.play-menu .sheet-content').getAttribute('inert')).not.toBeNull();
      // The navigation works from here.
      await page.click('.rail button:has-text("Explore")');
      await expect(menu(page)).toHaveCount(0);
      await page.click('.rail button:has-text("Play")');
      await expect(menu(page)).toBeVisible();
      expect(await expanded(page)).toBe('true');
      await ctx.close();
    });

    test('expanded: every game reachable, nothing clipped, above the navigation; swipe and globe tap fold it', async ({ browser }) => {
      const ctx = await contextFor(browser, size); const page = await ctx.newPage();
      await page.goto('/');
      await openMenu(page);
      await page.waitForTimeout(400);
      const sheet = (await menu(page).boundingBox())!, rail = (await page.locator('.rail').boundingBox())!;
      expect(sheet.y + sheet.height).toBeLessThanOrEqual(rail.y + 1);
      expect(sheet.y).toBeGreaterThan(40);   // the logo and some globe stay above it
      expect(await uncovered(page, '.play-menu .challenge')).toEqual([true, true, true, true, true]);
      // Swipe down on the bar folds it; swipe up opens it.
      await swipe(page, '.play-menu .sheet-bar', 80);
      await expect.poll(() => expanded(page)).toBe('false');
      await page.waitForTimeout(400);   // the bar settles at the bottom
      await swipe(page, '.play-menu .sheet-bar', -80);
      await expect.poll(() => expanded(page)).toBe('true');
      // Turning the globe leaves it open; a tap on the globe folds it.
      // On the globe just above the sheet (once it has finished opening), below the area tabs.
      await page.waitForTimeout(400);
      const gy = (await menu(page).boundingBox())!.y - 14, gx = size[0] / 2;
      await page.mouse.move(gx, gy); await page.mouse.down();
      await page.mouse.move(gx + 60, gy - 6, { steps: 6 }); await page.mouse.up();
      expect(await expanded(page)).toBe('true');
      await page.mouse.click(gx, gy);
      await expect.poll(() => expanded(page)).toBe('false');
      await ctx.close();
    });

    test('City Rush setup: all three modes and Start visible and usable; folded, its bar can start the game', async ({ browser }) => {
      const ctx = await contextFor(browser, size); const page = await ctx.newPage();
      await page.goto('/');
      await openMenu(page);
      await page.locator('.challenge', { hasText: 'City Rush' }).click();
      await page.fill('.rush-setup input', 'Canada'); await page.keyboard.press('Enter');
      const start = page.locator('.rush-setup .sheet-foot .btn.primary');
      await expect(start).toBeEnabled({ timeout: 60_000 });
      expect(await uncovered(page, '.rush-setup .rush-modes button')).toEqual([true, true, true]);
      expect(await uncovered(page, '.rush-setup .sheet-foot .btn.primary')).toEqual([true]);
      await page.click('.rush-modes button:has-text("City Explorer")');
      await expect(start).toHaveText('Start exploring');
      await page.click('.rush-modes button:has-text("Quick")');
      await expect(start).toHaveText('Start Quick Rush');
      // Fold it: the bar names the country and mode, and starts the game.
      await page.click('.rush-setup .sheet-toggle');
      await expect(page.locator('.rush-setup .sheet-summary')).toContainText('Canada');
      await expect(page.locator('.rush-setup .sheet-summary')).toContainText('Quick Rush');
      await page.click('.rush-setup .sheet-go');
      await expect(page.locator('.rush-hud')).toBeVisible();
      await expect(page.locator('.rush-hud .hud-area')).toContainText('Quick Rush');
      await ctx.close();
    });

    test('with the keyboard up, the sheet sits above it', async ({ browser }) => {
      const ctx = await contextFor(browser, size); const page = await ctx.newPage();
      await page.goto('/?rush=CAN');
      await expect(page.locator('.rush-setup')).toBeVisible({ timeout: 60_000 });
      // Typing in the search: browsers report the keyboard by shrinking the visual viewport, which App turns into --kb
      // (set directly here, as a desktop browser has no keyboard to open) and keeps the field in sight.
      const search = page.locator('.rush-setup input:not([type="checkbox"])');
      await search.focus();
      await page.evaluate(() => { document.documentElement.style.setProperty('--kb', '260px'); document.activeElement?.scrollIntoView({ block: 'nearest' }); });
      await page.waitForTimeout(400);
      const b = (await page.locator('.rush-setup').boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(size[1] - 260 - 84 + 1);
      expect(b.y).toBeGreaterThanOrEqual(0);
      await expect(search).toBeInViewport();
      await expect(search).toBeFocused();
      await ctx.close();
    });
  });
}

test('larger screens keep the side panel: no sheet bar, everything shown', async ({ browser }) => {
  for (const size of [DESKTOP, [844, 390], [768, 1024]] as Size[]) {
    const ctx = await contextFor(browser, size); const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.play-menu .sheet-bar')).toBeHidden();
    if (size === DESKTOP) {
      const b = (await menu(page).boundingBox())!;
      expect([Math.round(b.x + b.width), Math.round(b.y)]).toEqual([1420, 76]);   // right: 20px, top: 76px, as before
    }
    await ctx.close();
  }
});
