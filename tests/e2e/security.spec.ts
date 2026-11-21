// The deployed headers and the release-versioned data, as served by scripts/serve-dist.ts from netlify.toml: the Content
// Security Policy is sent and nothing ATLAS does violates it (globe, flags, regions, cities, fonts, the share image);
// every data request goes to this release's folder; and a page left open across a deploy says it is out of date.
import { expect, test } from '@playwright/test';
import { DESKTOP, contextFor, finishRush, home, sayCity, startRush, watch } from './helpers.ts';

test('every page response carries the security headers and the CSP', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).not.toContain('unsafe-eval');
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
});

test('data lives in a release folder that can be cached for good; release.json is always checked', async ({ request }) => {
  const rel = await request.get('/release.json');
  expect(rel.headers()['cache-control']).toBe('no-cache');
  const { dataDir } = await rel.json();
  expect(dataDir).toMatch(/^data\/[0-9a-f]{12}\/$/);
  const data = await request.get(`/${dataDir}cities/index.json`);
  expect(data.status()).toBe(200);
  expect(data.headers()['cache-control']).toContain('immutable');
  // The old unversioned paths are gone: nothing can mix them up.
  expect((await request.get('/data/cities/index.json')).status()).toBe(404);
  // The page preloads the country shapes from the same folder.
  expect(await (await request.get('/')).text()).toContain(`href="/${dataDir}countries.topo.json"`);
});

test('a full tour of the game breaks no CSP rule and asks only for this release\'s data', async ({ browser, request }) => {
  test.slow();
  const { dataDir } = await (await request.get('/release.json')).json();
  const ctx = await contextFor(browser, DESKTOP);
  const page = await ctx.newPage();
  const w = watch(page);
  const dataRequests: string[] = [];
  page.on('request', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/data/')) dataRequests.push(p); });

  // The globe, a country in Explore (places, flags, regions), a Regions round, City Rush and its share image.
  await home(page);
  await page.click('.rail button:has-text("Explore")');
  await page.click('.region-picks .chip:has-text("Canada")');
  await expect(page.locator('.region-mode').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.region-mode').first().click();
  await expect(page.locator('.hud')).toBeVisible();
  await page.click('.hud-top .close');
  await startRush(page, 'Quick');
  await sayCity(page, 'Toronto');
  await finishRush(page);
  const download = page.waitForEvent('download');
  await page.click('.rush-results button:has-text("Save image")');
  expect((await download).suggestedFilename()).toBe('atlas-city-rush-can.png');

  expect(await w.csp(), 'CSP violations').toEqual([]);
  expect(w.errors, 'page errors').toEqual([]);
  expect(dataRequests.length).toBeGreaterThan(5);
  expect(dataRequests.filter(p => !p.startsWith(`/${dataDir}`)), 'data requests outside the release folder').toEqual([]);
  await ctx.close();
});

test.describe('a page left open across a deploy', () => {
  test('says ATLAS has been updated when its data is gone, and keeps the player\'s progress', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP);
    const page = await ctx.newPage();
    await home(page);
    // A deploy happens: this release's city files are gone and release.json names another folder.
    await page.route('**/data/*/cities/**', r => r.fulfill({ status: 404, body: 'Not found' }));
    await page.route('**/release.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dataDir: 'data/0123456789ab/' }) }));
    await page.evaluate(() => localStorage.setItem('atlas-city-rush-choice-v1', '180'));
    await page.click('.rail button:has-text("Play")');
    await page.locator('.challenge:has-text("City Rush")').first().click();
    const note = page.locator('.update-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('ATLAS has been updated');
    await expect(note.locator('button:has-text("Reload")')).toBeVisible();
    // Not now hides it; the game is still there.
    await note.locator('button:has-text("Not now")').click();
    await expect(note).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('atlas-city-rush-choice-v1'))).toBe('180');
    await ctx.close();
  });

  test('a missing file in the current release is an ordinary load failure, not an update', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP);
    const page = await ctx.newPage();
    await home(page);
    await page.route('**/data/*/cities/**', r => r.fulfill({ status: 404, body: 'Not found' }));
    await page.goto('/?rush=CAN');
    await expect(page.getByText('could not load', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.update-note')).toHaveCount(0);
    await ctx.close();
  });
});

test('the policy is enforced: an injected inline script does not run and is reported', async ({ browser }) => {
  // (eval cannot be checked from here: Playwright's own evaluation is exempt from the page's policy.)
  const ctx = await contextFor(browser, DESKTOP);
  const page = await ctx.newPage();
  const w = watch(page);
  await home(page);
  const ran = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inline = true';
    document.head.append(s);
    return (window as unknown as { __inline?: boolean }).__inline === true;
  });
  expect(ran).toBe(false);
  await expect.poll(() => w.csp()).toEqual([expect.stringMatching(/^script-src/)]);
  await ctx.close();
});
