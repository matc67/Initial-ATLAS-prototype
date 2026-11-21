// The globe itself (MapLibre): it starts, draws countries and regions that answer hover, click and tap, moves with
// drag, pinch and the zoom buttons, shows its labels and city markers, and the results map can be explored. Written for
// the MapLibre 5.24.1 upgrade; a MapLibre change that breaks any of these fails here.
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, PHONE, contextFor, finishRush, home, sayCity, startRush, watch } from './helpers.ts';

const canvasShot = (page: Page) => page.locator('.map canvas').screenshot();
const mapBox = async (page: Page) => (await page.locator('.map').boundingBox())!;
// Points of the map from its centre outwards, as fractions of its box.
const GRID = Array.from({ length: 13 * 13 }, (_, i) => [0.2 + (i % 13) * 0.05, 0.2 + Math.floor(i / 13) * 0.05] as const)
  .sort((a, b) => Math.hypot(a[0] - 0.5, a[1] - 0.5) - Math.hypot(b[0] - 0.5, b[1] - 0.5));
// Moves the mouse from the centre outwards until the globe names something that `wanted` accepts, and returns it.
async function hoverSomething(page: Page, wanted: (name: string) => boolean = () => true): Promise<string> {
  const b = await mapBox(page);
  for (const [x, y] of GRID) {
    await page.mouse.move(b.x + b.width * x, b.y + b.height * y);
    const name = page.locator('.hover-name');
    if (!(await name.isVisible().catch(() => false))) continue;
    const text = ((await name.textContent()) ?? '').trim();
    if (wanted(text)) return text;
  }
  return '';
}

test('the globe starts: WebGL canvas, data loaded, ocean labels, no errors', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP);
  const page = await ctx.newPage();
  const w = watch(page);
  await home(page);
  await expect(page.locator('.globe-loading')).toHaveCount(0);
  expect(await page.evaluate(() => !!document.querySelector<HTMLCanvasElement>('.map canvas')?.getContext('webgl2'))).toBe(true);
  await expect(page.locator('.ocean-label', { hasText: 'Atlantic Ocean' }).first()).toBeVisible();
  expect(w.errors).toEqual([]);
  await ctx.close();
});

test('countries answer hover and click; drag and zoom move the camera', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP);
  const page = await ctx.newPage();
  const w = watch(page);
  await home(page);
  await page.click('.rail button:has-text("Explore")');
  await page.waitForTimeout(800);
  const name = await hoverSomething(page);
  expect(name, 'a country under the pointer is named').not.toBe('');
  // A click opens that country in Explore.
  await page.mouse.down(); await page.mouse.up();
  await expect(page.locator('.panel h1, .panel h2').first()).toContainText(name.replace(/^\W+/, '').slice(0, 6));
  // Drag turns the globe; the zoom buttons zoom.
  const before = await canvasShot(page);
  const b = await mapBox(page);
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const dragged = await canvasShot(page);
  expect(dragged.equals(before), 'drag moved the globe').toBe(false);
  await page.click('.zoom button[aria-label="Zoom in"]');
  await page.waitForTimeout(900);
  expect((await canvasShot(page)).equals(dragged), 'zoom changed the view').toBe(false);
  expect(w.errors).toEqual([]);
  await ctx.close();
});

test('touch: a tap opens a country, a one-finger drag pans and a pinch zooms', async ({ browser }) => {
  const ctx = await contextFor(browser, PHONE);
  const page = await ctx.newPage();
  const w = watch(page);
  await home(page);
  await page.click('.rail button:has-text("Explore")');
  await page.waitForTimeout(800);
  const b = await mapBox(page);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  // A tap on land opens a country.
  for (const [x, y] of GRID) {
    await page.touchscreen.tap(b.x + b.width * x, b.y + b.height * y);
    if (await page.locator('.panel h1').first().isVisible().catch(() => false)) break;
  }
  await expect(page.locator('.panel h1').first()).toBeVisible();
  // Pinch out around the centre.
  const before = await canvasShot(page);
  const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
  await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 30 - i * 12, cy], [cx + 30 + i * 12, cy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(800);
  const pinched = await canvasShot(page);
  expect(pinched.equals(before), 'pinch zoomed').toBe(false);
  // One finger pans.
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - i * 15, cy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(800);
  expect((await canvasShot(page)).equals(pinched), 'drag panned').toBe(false);
  expect(w.errors).toEqual([]);
  await ctx.close();
});

test('region boundaries: Explore shows a country\'s regions, which answer hover', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP);
  const page = await ctx.newPage();
  await home(page);
  await page.click('.rail button:has-text("Explore")');
  await page.click('.region-picks .chip:has-text("Canada")');
  await page.locator('.panel.sub').waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // A region is named with its kind ("OntarioProvince"); a country is named with its flag.
  const name = await hoverSomething(page, n => /Province|Territory/.test(n));
  expect(name).toMatch(/Province|Territory/);
  await ctx.close();
});

test('City Rush: cities land on the globe with labels; the results map flies to a missed city', async ({ browser }) => {
  const ctx = await contextFor(browser, PHONE);
  const page = await ctx.newPage();
  const w = watch(page);
  await startRush(page, 'Quick');
  await sayCity(page, 'Toronto');
  await expect(page.locator('.rush-label', { hasText: 'Toronto' })).toBeVisible();
  await finishRush(page);
  const before = await canvasShot(page);
  await page.locator('.rush-missed li button').first().click();
  await expect(page.locator('.rush-results.peek'), 'the results fold to show the map').toBeVisible();
  await page.waitForTimeout(1500);
  expect((await canvasShot(page)).equals(before), 'the camera moved to the city').toBe(false);
  await expect(page.locator('.rush-label.missed').first()).toBeVisible();
  expect(w.errors).toEqual([]);
  await ctx.close();
});
