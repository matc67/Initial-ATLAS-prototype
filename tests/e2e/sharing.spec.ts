// Sharing and challenges: the result card for each kind of game (with the run's real numbers), the share sheet on
// phones and computers, the challenge link it sends, what a friend sees when opening one (valid, outdated, broken),
// the comparison after their run, and the link preview metadata.
import { expect, test, type Page } from '@playwright/test';
import { decodeAnswer } from '../../src/game/mysteryRecords.ts';
import { ROSTER } from '../../src/data/roster.ts';
import { DESKTOP, PHONE, contextFor, finishRush, openRush, readoutValue, sayCity, startMystery, startRegions, startRound, startRush, storage, watch, type Size } from './helpers.ts';

const sheet = (p: Page) => p.locator('.share-sheet');
// Opens the share sheet from results and waits for the card; returns its alt text and pixel size.
async function openCard(page: Page) {
  await page.locator('.challenge-btn').first().click();
  const img = sheet(page).locator('.share-preview img');
  await expect(img).toBeVisible({ timeout: 30_000 });
  return img.evaluate((i: HTMLImageElement) => ({ alt: i.alt, w: i.naturalWidth, h: i.naturalHeight }));
}
// The link the sheet copies (clipboard permission granted for the test).
async function copiedLink(page: Page) {
  await sheet(page).locator('button:has-text("Copy link")').click();
  await expect(sheet(page).locator('[role="status"]')).toContainText('Link copied');
  return new URL(await page.evaluate(() => navigator.clipboard.readText()));
}
async function withClipboard(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
}
const sprintDone = async (page: Page) => { for (let i = 0; i < 10; i++) { await page.click('.hud-meta .link:has-text("Show me")'); await page.locator('.hud .btn.primary').click(); } };

test.describe('result cards', () => {
  test('City Rush: the card carries the run\'s coverage, cities and length; the link the same game and score', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage(); const w = watch(page);
    await withClipboard(page);
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await sayCity(page, 'Montreal');
    await finishRush(page);
    const shown = (await page.locator('.rush-score strong').textContent())!.trim();   // e.g. "14.2%"
    const card = await openCard(page);
    expect(card).toMatchObject({ w: 1800, h: 945 });
    expect(card.alt).toContain(`Quick rush · 3 minutes, Canada: ${shown} city population coverage. 2 cities named`);
    expect(card.alt).toContain(`Can you beat ${shown} in 3 minutes?`);
    const link = await copiedLink(page);
    expect(Object.fromEntries(link.searchParams)).toMatchObject({ rush: 'CAN', t: '180', beat: shown.replace('%', '') });
    expect(link.searchParams.get('v')).toMatch(/\w+/);
    // Nothing about the cities named travels in the link.
    expect(link.href).not.toMatch(/Toronto|Montreal|gn:/);
    // Save image downloads a reasonably small JPEG.
    const download = page.waitForEvent('download');
    await sheet(page).locator('button:has-text("Save image")').click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('atlas-city-rush-can.jpg');
    const bytes = (await (await import('node:fs/promises')).readFile((await d.path())!)).byteLength;
    expect(bytes).toBeGreaterThan(40_000);
    expect(bytes).toBeLessThan(700_000);
    // Escape closes the sheet and gives focus back to the button.
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('.challenge-btn')).toBeFocused();
    expect(w.errors).toEqual([]);
    expect(await w.csp()).toEqual([]);
    await ctx.close();
  });

  test('a long country name wraps on the card, which still shows the result', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await startRush(page, 'City Explorer', 'COD');
    await sayCity(page, 'Kinshasa');
    await finishRush(page);
    const card = await openCard(page);
    expect(card.alt).toContain('Democratic Republic of the Congo');
    expect(card.alt).toMatch(/: \d+(\.\d)?% city population coverage\. 1 city named/);
    await ctx.close();
  });

  test('Sprint: the score, first-try answers and a link to the same Sprint', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await withClipboard(page);
    await startRound(page, 'Find it');
    await sprintDone(page);
    const card = await openCard(page);
    expect(card.alt).toContain('Sprint · Find it, The World: 0 points of 1,400. 0/10 first try, 0 mistakes');
    const link = await copiedLink(page);
    expect(Object.fromEntries(link.searchParams)).toMatchObject({ play: 'sprint', area: 'world', mode: 'find', set: '200', beat: '0' });
    await ctx.close();
  });

  test('Regions: the country\'s own word for its regions', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await withClipboard(page);
    await startRegions(page);
    for (let i = 0; i < 40 && await page.locator('.hud').count(); i++) { await page.click('.hud-meta .link:has-text("Show me")'); await page.locator('.hud .btn.primary').click(); }
    const card = await openCard(page);
    expect(card.alt).toMatch(/Canada: 0 points/);
    expect(card.alt.toLowerCase()).toContain('provinces and territories');
    const link = await copiedLink(page);
    expect(link.searchParams.get('play')).toMatch(/^regions-(sprint|full)$/);
    expect(link.searchParams.get('country')).toBe('CAN');
    await ctx.close();
  });

  test('Mystery: the guesses, never the answer', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await withClipboard(page);
    await startMystery(page);
    for (const g of ['Iceland', 'Chile']) { await page.fill('.mystery-search input', g); await page.keyboard.press('Enter'); await expect(page.locator('.mystery-search input, .mystery-results').first()).toBeVisible(); if (await page.locator('.mystery-results').count()) break; }
    const saved = await storage(page, 'atlas-mystery-active-v1');
    const answer = saved ? ROSTER.find(r => r.id === decodeAnswer(saved.answer))!.name : null;
    if (answer) { await page.fill('.mystery-search input', answer); await page.keyboard.press('Enter'); }
    await expect(page.locator('.mystery-results')).toBeVisible();
    const guesses = Number(await page.locator('.mystery-results .sprint-stats strong').first().textContent());
    const card = await openCard(page);
    expect(card.alt).toContain(`Mystery solved: ${guesses} guess`);
    if (answer) expect(card.alt).not.toContain(answer);
    const link = await copiedLink(page);
    expect(Object.fromEntries(link.searchParams)).toEqual({ play: 'mystery', set: '200', beat: String(guesses) });
    await ctx.close();
  });
});

test.describe('sharing on phones and computers', () => {
  // The Web Share API stands in for the phone's share sheet: it records what it was given.
  const stubShare = (page: Page, files: boolean) => page.addInitScript(f => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: { files?: File[] }) => f || !d.files });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: { files?: File[]; text?: string; url?: string }) => { w.__shared.push({ files: d.files?.map(x => [x.name, x.type, x.size]), text: d.text, url: d.url }); } });
  }, files);

  test('a phone that shares files sends the card with the text and link', async ({ browser }) => {
    const ctx = await contextFor(browser, PHONE); const page = await ctx.newPage();
    await stubShare(page, true);
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await openCard(page);
    await sheet(page).locator('button:has-text("Share")').click();
    const shared = await page.evaluate(() => (window as unknown as { __shared: { files: [string, string, number][]; text: string }[] }).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].files[0].slice(0, 2)).toEqual(['atlas-city-rush-can.jpg', 'image/jpeg']);
    expect(shared[0].text).toMatch(/^ATLAS · Canada\n.*city population coverage.*\nCan you beat .*\nhttps?:\/\/.*\?rush=CAN&t=180&beat=/s);
    await ctx.close();
  });

  test('a browser that shares only text sends the text and the link', async ({ browser }) => {
    const ctx = await contextFor(browser, PHONE); const page = await ctx.newPage();
    await stubShare(page, false);
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await openCard(page);
    await sheet(page).locator('button:has-text("Share")').click();
    const shared = await page.evaluate(() => (window as unknown as { __shared: { files?: unknown; text: string; url: string }[] }).__shared);
    expect(shared[0].files).toBeUndefined();
    expect(shared[0].url).toMatch(/\?rush=CAN&t=180&beat=/);
    await ctx.close();
  });

  test('without the Web Share API, Save image is the main action', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }); });
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await openCard(page);
    await expect(sheet(page).locator('button:has-text("Share")')).toHaveCount(0);
    await expect(sheet(page).locator('.btn.primary')).toHaveText('Save image');
    await ctx.close();
  });

  test('the share sheet fits a small phone, and keeps focus inside it', async ({ browser }) => {
    const ctx = await contextFor(browser, [320, 568] as Size); const page = await ctx.newPage();
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await openCard(page);
    // The sheet covers the screen (not just the results panel it was opened from).
    const back = (await page.locator('.sheet-backdrop').boundingBox())!;
    expect([back.x, back.y, back.width, back.height]).toEqual([0, 0, 320, 568]);
    await expect.poll(() => page.evaluate(() => { const r = document.querySelector('.share-sheet')!.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + 20)?.closest('.share-sheet') !== null; })).toBe(true);
    const box = (await sheet(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.share-sheet'))).toBe(true);
    await ctx.close();
  });
});

test.describe('opening a challenge link', () => {
  const version = async (page: Page, country: string) => {
    const { dataDir } = await (await page.request.get('/release.json')).json();
    return (await (await page.request.get(`/${dataDir}cities/${country}.json`)).json()).version as string;
  };

  test('City Rush: the invitation, the same game, a target on the bar, and the result against it', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage(); const w = watch(page);
    const v = await version(page, 'CAN');
    await page.goto(`/?rush=CAN&t=180&beat=1.0&v=${v}`);
    const invite = page.locator('.challenge-invite');
    await expect(invite).toBeVisible({ timeout: 60_000 });
    await expect(invite.locator('h2')).toHaveText('Quick Rush · Canada');
    await expect(invite).toContainText('Beat 1.0% city population coverage in 3 minutes.');
    // The link is taken out of the address once read.
    expect(new URL(page.url()).search).toBe('');
    await invite.locator('button:has-text("Accept the challenge")').click();
    await expect(page.locator('.rush-modes button.on')).toContainText('Quick Rush');
    await expect(page.locator('.challenge-target')).toContainText('1.0%');
    await page.click('.rush-setup .btn.primary');
    await expect(page.locator('.rush-progress .bar-mark.vs')).toBeAttached();
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await expect(page.locator('.challenge-outcome.beat')).toContainText('You won the challenge');
    await expect(page.locator('.challenge-outcome')).not.toContainText('earlier version');
    // The run is a normal run; the target is stored nowhere.
    const all = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
    expect(Object.values(JSON.parse(JSON.parse(all)['atlas-city-rush-bests-v2'] ?? '{}'))).toHaveLength(1);
    expect(all).not.toContain('beat');
    expect(w.errors).toEqual([]);
    await ctx.close();
  });

  test('a target set on other city data is shown with a note', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await page.goto('/?rush=CAN&t=180&beat=99.0&v=an-older-version');
    await page.locator('.challenge-invite button:has-text("Accept the challenge")').click({ timeout: 60_000 });
    await page.click('.rush-setup .btn.primary');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await expect(page.locator('.challenge-outcome.short')).toContainText('Not this time');
    await expect(page.locator('.challenge-outcome')).toContainText('earlier version');
    await ctx.close();
  });

  test('a Sprint challenge starts the same Sprint and compares the score', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await page.goto('/?play=sprint&area=europe&mode=flag&set=195&beat=300');
    const invite = page.locator('.challenge-invite');
    await expect(invite.locator('h2')).toHaveText('Sprint · Flags · Europe', { timeout: 60_000 });
    await expect(invite).not.toContainText('earlier version');   // the link names no version: nothing to compare
    await invite.locator('button:has-text("Accept the challenge")').click();
    await expect(page.locator('.hud-area')).toContainText('Europe');
    await expect(page.locator('.flag-question')).toBeVisible();
    await sprintDone(page);
    await expect(page.locator('.challenge-outcome.short')).toContainText('0 pts against 300 pts');
    // Play again keeps the challenge.
    await page.click('.sprint-results .btn.primary');
    await sprintDone(page);
    await expect(page.locator('.challenge-outcome')).toBeVisible();
    // The set chosen by the link is the game's set now.
    expect(await page.evaluate(() => localStorage.getItem('atlas-country-set'))).toBe('195');
    await ctx.close();
  });

  test('a Mystery challenge starts a mystery with a number of guesses to beat', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await page.goto('/?play=mystery&set=200&beat=6');
    const invite = page.locator('.challenge-invite');
    await expect(invite).toContainText('Solve a mystery in fewer than 6 guesses.', { timeout: 60_000 });
    await invite.locator('button:has-text("Accept the challenge")').click();
    await expect(page.locator('.mystery-hud')).toBeVisible();
    await ctx.close();
  });

  test('Not now leaves the game menu as it was', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await page.goto('/?play=mystery&set=200&beat=6');
    await page.locator('.challenge-invite button:has-text("Not now")').click({ timeout: 60_000 });
    await expect(page.locator('.challenge-invite')).toHaveCount(0);
    await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible();
    await ctx.close();
  });

  test('a broken link says so once, and the game works', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage(); const w = watch(page);
    await page.goto('/?play=sprint&area=atlantis&mode=find&set=200&beat=10');
    await expect(page.locator('.update-note')).toContainText('That challenge link does not work', { timeout: 60_000 });
    await page.locator('.update-note button').click();
    await expect(page.locator('.challenge-invite')).toHaveCount(0);
    await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible();
    expect(w.errors).toEqual([]);
    await ctx.close();
  });

  test('a challenge for a game ATLAS cannot start here is explained', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await page.goto('/?play=regions-sprint&country=XYZ&mode=find&beat=10');
    await expect(page.locator('.challenge-invite')).toContainText('That country is not in ATLAS.', { timeout: 60_000 });
    await page.locator('.challenge-invite button:has-text("Play something else")').click();
    await expect(page.locator('.challenge-invite')).toHaveCount(0);
    await ctx.close();
  });

  test('the plain ?rush=CAN link of earlier releases still opens City Rush on Canada', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await openRush(page, 'CAN');
    await expect(page.locator('.rush-setup h1')).toContainText('Canada');
    await expect(page.locator('.challenge-invite')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('replay', () => {
  test('City Rush results: Play again, change country or mode, back to the menu', async ({ browser }) => {
    const ctx = await contextFor(browser, PHONE); const page = await ctx.newPage();
    await startRush(page, 'Quick');
    await sayCity(page, 'Toronto');
    await finishRush(page);
    await expect(page.locator('.rush-results .btn.primary')).toHaveText(/Play again · Quick Rush/);
    await page.click('.rush-results .btn.primary');
    expect(await readoutValue(page, 'Cities')).toBe('0');
    await finishRush(page);
    await page.click('.rush-results button:has-text("Change country or mode")');
    await expect(page.locator('.rush-setup')).toBeVisible();
    await page.click('.rush-modes button:has-text("Quick")');
    await page.click('.rush-setup .btn.primary');
    await finishRush(page);
    await page.locator('.rush-results button:has-text("Back to menu")').first().click();
    await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible();
    await ctx.close();
  });

  test('Sprint results: Play again first, then Share result, then Back to menu', async ({ browser }) => {
    const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
    await startRound(page, 'Find it');
    await sprintDone(page);
    const order = await page.locator('.sprint-results > .btn').allTextContents();
    expect(order.map(t => t.replace(/Enter$/, '').trim())).toEqual(['Play again', 'Share result', 'Back to menu']);
    await expect(page.locator('.sprint-results .btn.primary')).toBeFocused();
    await page.click('.sprint-results button:has-text("Back to menu")');
    await expect(page.locator('.challenge.sprint:not([disabled])')).toBeVisible();
    await ctx.close();
  });
});

test('the link preview: title, description, a large branded image and icons', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const meta = (attr: string, name: string) => new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(html)?.[1];
  expect(meta('property', 'og:title')).toBe('ATLAS — Master the World');
  expect(meta('property', 'og:description')).toMatch(/geography game on a 3D globe/);
  expect(meta('property', 'og:image')).toMatch(/^https:\/\/[^/]+\/og-image\.jpg$/);
  expect(meta('property', 'og:image:width')).toBe('1800');
  expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  expect(html).not.toContain('%SITE_URL%');
  const og = await request.get('/og-image.jpg');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toBe('image/jpeg');
  expect((await og.body()).byteLength).toBeLessThan(400_000);
  expect((await request.get('/apple-touch-icon.png')).status()).toBe(200);
});

test('the first visit explains City Rush scoring in a few lines', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
  await openRush(page, 'CAN');
  const how = page.locator('.how-scoring');
  await how.locator('summary').click();
  await expect(how).toContainText('big cities count most');
  await expect(how).toContainText('not of the whole national population');
  await expect(how).toContainText('City Explorer has no clock');
  await ctx.close();
});

test('a timed run that ran out while away says so on its results', async ({ browser }) => {
  const ctx = await contextFor(browser, DESKTOP); const page = await ctx.newPage();
  await startRush(page, 'Quick');
  await sayCity(page, 'Toronto');
  await page.goto('/release.json');
  await page.evaluate(() => { const k = 'atlas-city-rush-active-v2', s = JSON.parse(localStorage.getItem(k)!); s.startedAt -= 3_600_000; localStorage.setItem(k, JSON.stringify(s)); });
  await page.goto('/');
  await expect(page.locator('.away-note')).toContainText('Time ran out while you were away', { timeout: 60_000 });
  await ctx.close();
});
