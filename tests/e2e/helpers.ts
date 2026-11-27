// Shared steps for the browser tests: opening each game, reading the screen, and catching errors and CSP violations.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export type Size = readonly [number, number];
// The viewports ATLAS is checked at: small, medium and large phones, a tablet both ways, a phone held sideways, desktop.
export const VIEWPORTS: readonly Size[] = [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [844, 390], [1024, 768], [1440, 900]];
export const PHONE: Size = [390, 844];
export const DESKTOP: Size = [1440, 900];
export const label = ([w, h]: Size) => `${w}×${h}`;
// Phones and tablets are touch screens; the phone held sideways is a phone.
export const isTouch = ([w]: Size) => w < 1100;

export async function contextFor(browser: Browser, size: Size, opts: { fixedRandom?: boolean } = {}): Promise<BrowserContext> {
  const [width, height] = size;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: isTouch(size) && width !== 1024, hasTouch: isTouch(size) });
  // Records every Content Security Policy violation, for watch().
  await ctx.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', e => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  // Repeatable draws: while a click is handled, Math.random is a seeded sequence that starts over on every click, so the
  // same click (Start a Sprint) draws the same countries. Outside clicks it is the real one: MapLibre names its worker
  // messages with Math.random, and repeated names would mix up their replies.
  if (opts.fixedRandom) await ctx.addInitScript(() => {
    const real = Math.random;
    const seeded = () => { let s = 42; return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    window.addEventListener('click', () => { Math.random = seeded(); }, true);
    window.addEventListener('click', () => { Math.random = real; });
  });
  return ctx;
}

// Collects uncaught errors and console errors of a page. Network failures of Google Fonts are ignored (tests may run
// offline); everything else counts.
export function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message || e.stack?.split("\n").slice(0, 3).join(" | ") || String(e)}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR_/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return {
    errors,
    csp: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []),
  };
}

export async function home(page: Page) {
  await page.goto('/');
  await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible({ timeout: 60_000 });
}

export type RoundMode = 'Find it' | 'Name it' | 'Flags';
export async function startRound(page: Page, mode: RoundMode, kind: 'sprint' | 'full' = 'sprint') {
  await home(page);
  await page.click(`.segmented button:has-text("${mode}")`);
  await page.click(kind === 'sprint' ? '.challenge.sprint' : '.challenges > button.challenge:nth-of-type(2)');
  await expect(page.locator('.hud')).toBeVisible();
}
export async function startMystery(page: Page) {
  await page.goto('/');
  await page.locator('.challenge.mystery:not([disabled])').click({ timeout: 60_000 });
  await expect(page.locator('.mystery-search input')).toBeVisible();
}
export async function startRegions(page: Page, country = 'Canada') {
  await home(page);
  await page.click('.rail button:has-text("Explore")');
  await page.click(`.region-picks .chip:has-text("${country}")`);
  await page.locator('.region-mode').first().click({ timeout: 30_000 });
  await expect(page.locator('.hud')).toBeVisible();
}
export type RushCard = 'Quick' | 'Classic' | 'City Explorer';
export async function openRush(page: Page, country = 'CAN') {
  await page.goto(`/?rush=${country}`);
  await expect(page.locator('.rush-setup .btn.primary:not([disabled])')).toBeVisible({ timeout: 60_000 });
}
export async function startRush(page: Page, card: RushCard, country = 'CAN') {
  await openRush(page, country);
  await page.click(`.rush-modes button:has-text("${card}")`);
  await page.click('.rush-setup .btn.primary');
  await expect(page.locator('.rush-bar input')).toBeVisible();
}
// Types a city and returns the message City Rush answers with.
export async function sayCity(page: Page, name: string) {
  const before = await page.locator('.rush-msg').textContent().catch(() => '');
  await page.fill('.rush-bar input', name);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('.rush-msg').textContent()).not.toBe(before);
  return ((await page.locator('.rush-msg').textContent()) ?? '').trim();
}
export const readoutValue = (page: Page, name: string) => page.locator(`.rush-readouts .readout:has(span:text-is("${name}")) strong`).textContent().then(t => (t ?? '').trim());
export async function finishRush(page: Page) {
  // A timed run asks to confirm ("Finish now?", which lapses after a few seconds); City Explorer finishes at once.
  const confirm = page.locator('.rush-hud button:has-text("Finish now?")'), results = page.locator('.rush-results');
  for (let i = 0; i < 3 && !(await results.isVisible()); i++) {
    if (!(await confirm.isVisible())) await page.locator('.rush-hud .finish').click();
    await expect(confirm.or(results).first()).toBeVisible();
    if (await confirm.isVisible()) await confirm.click().catch(() => {});
    await results.waitFor({ timeout: 5000 }).catch(() => {});
  }
  await expect(results).toBeVisible();
}
// Exit from any game's panel: through the confirmation when one is asked (progress would be lost).
export async function exitGame(page: Page, expectConfirm?: boolean) {
  await page.locator('.hud .exit').first().click();
  const dialog = page.locator('.exit-confirm');
  if (expectConfirm === undefined) await page.waitForTimeout(150);
  else if (expectConfirm) await expect(dialog).toBeVisible(); else await expect(dialog).toHaveCount(0);
  if (await dialog.count()) await dialog.locator('button:has-text("Exit to menu")').click();
  await expect(page.locator('.hud')).toHaveCount(0);
}
// "1:23" or "12:03.4" as milliseconds.
export const clockMs = (s: string) => { const [m, sec] = s.trim().split(':'); return (Number(m) * 60 + Number(sec)) * 1000; };

// The share of the screen where the map is the topmost thing (interface with pointer-events: none, like map labels, does
// not count as covering it), sampled every 10px.
export const mapShare = (page: Page) => page.evaluate(() => {
  let map = 0, all = 0;
  for (let y = 4; y < innerHeight; y += 10) for (let x = 4; x < innerWidth; x += 10) {
    all++;
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest('.map') || el.matches('canvas, .atmosphere, .globe-shade, .app, body, html')) map++;
  }
  return Math.round((map / all) * 100);
});
// Where an element is: 'ok' (wholly on screen and visible), 'off' (partly off screen), 'hidden' or 'missing'.
export const placement = (page: Page, selector: string) => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) return 'missing';
  const r = e.getBoundingClientRect(), st = getComputedStyle(e);
  if (!r.width || !r.height || st.visibility === 'hidden' || st.display === 'none') return 'hidden';
  return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 ? 'ok' : 'off';
}, selector);
export const overflowsX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
// Visible buttons and inputs inside `within` whose smaller side is under `min` px.
export const smallTargets = (page: Page, within: string, min: number) => page.evaluate(([w, m]) =>
  [...document.querySelectorAll(`${w} button, ${w} input, ${w} a`)].flatMap(e => {
    const r = e.getBoundingClientRect(), st = getComputedStyle(e);
    if (!r.width || !r.height || st.visibility === 'hidden' || r.bottom <= 0 || r.top >= innerHeight) return [];
    // A link or button inside running text is sized by its line, as on any page; checked separately where it matters.
    return Math.min(r.width, r.height) < m ? [`${(e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 24)} ${Math.round(r.width)}×${Math.round(r.height)}`] : [];
  }), [within, min] as const);

export const storage = (page: Page, key: string) => page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
