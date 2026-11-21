// City Explorer with 2,000 cities found (the United States' largest, saved as a returning player would have them):
//   idle work      main-thread time per second while nothing happens (Chrome's TaskDuration). The code before Sprint B
//                  re-rendered all of City Rush four times a second: ~140 ms/s here, against ~18 ms/s now. This is the
//                  budget that catches that slowness coming back, on any machine.
//   long tasks     over 5 s idle with the CPU slowed 4×
//   typing         keystroke to next frame, 95th percentile, at normal speed and 4× slower
//   new city       submitting a new city to the second frame after, 4× slower
// The other budgets are generous: they catch a severe regression, not a few milliseconds. PERF_BUDGET_SCALE=2 doubles
// every budget for a slow machine. The measured values are attached to the test report.
import { expect, test, type Page } from '@playwright/test';
import { DESKTOP, contextFor, openRush, sayCity } from './helpers.ts';

const SCALE = Number(process.env.PERF_BUDGET_SCALE ?? 1);
//                                           Sprint B   before Sprint B (Sprint B report, system Chrome)
const BUDGET = {
  idleBusyMsPerSec: 75 * SCALE,           //  18 ms/s    140 ms/s (measured with Playwright's Chromium)
  idleLongTasks4x: 4 * SCALE,             //  0          20 (worst 185 ms)
  typingP95: 50 * SCALE,                  //  18 ms      86 ms
  typingP95_4x: 100 * SCALE,              //  36 ms      148 ms
  newCityMedian4x: 300 * SCALE,           //  120–170 ms 350–460 ms
};
const FOUND = 2000;

const idle = (page: Page) => page.evaluate(() => new Promise<{ count: number; worst: number }>(res => {
  const t: number[] = [];
  const obs = new PerformanceObserver(l => { for (const e of l.getEntries()) t.push(e.duration); });
  obs.observe({ type: 'longtask' });
  setTimeout(() => { obs.disconnect(); res({ count: t.length, worst: Math.round(Math.max(0, ...t)) }); }, 5000);
}));
// 30 keystrokes, each timed from the input event to the next frame.
const typing = (page: Page) => page.evaluate(async () => {
  const input = document.querySelector<HTMLInputElement>('.rush-bar input')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  input.focus();
  const lat: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    set.call(input, input.value + 'x');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => r(null)));
    lat.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, 60));
  }
  set.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  lat.sort((a, b) => a - b);
  return { p50: Math.round(lat[15]), p95: Math.round(lat[28]) };
});

test('City Explorer stays responsive with 2,000 cities found', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await contextFor(browser, DESKTOP);
  const page = await ctx.newPage();
  await openRush(page, 'USA');
  // This release's data folder (or data/, for a build from before release folders, to compare with older code).
  const rel = await page.request.get('/release.json');
  const dataDir: string = rel.ok() ? (await rel.json()).dataDir : 'data/';
  const file = await (await page.request.get(`/${dataDir}cities/USA.json`)).json() as { version: string; cities: [number, string][] };
  const ids = file.cities.slice(0, FOUND).map(r => `gn:${r[0]}`);
  await page.evaluate(([ids, version]) => localStorage.setItem('atlas-city-rush-explorer-v2', JSON.stringify({
    last: 'USA', countries: { USA: { country: 'USA', version, startedAt: Date.now() - 1e6, durationMs: null, ms: 5e5, found: ids, foundAt: ids.map(() => 0), updatedAt: Date.now() } },
  })), [ids, file.version] as const);
  await openRush(page, 'USA');
  await page.click('.rush-modes button:has-text("City Explorer")');
  await page.click('.rush-setup .btn.primary');
  await expect(page.locator('.rush-readouts .readout:has(span:text-is("Cities")) strong')).toHaveText(FOUND.toLocaleString('en-US'));
  await page.waitForTimeout(2000);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const taskMs = async () => 1000 * (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration')!.value;
  const t0 = await taskMs();
  const idleNormal = await idle(page);
  const idleBusyMsPerSec = Math.round((await taskMs() - t0) / 5);
  const normal = { idle: idleNormal, idleBusyMsPerSec, typing: await typing(page) };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = { idle: await idle(page), typing: await typing(page) };
  // Five new cities (beyond the 2,000), each timed from submitting to the second frame after.
  const newCity: number[] = [];
  for (const [, name] of file.cities.slice(3000, 3005)) {
    await page.fill('.rush-bar input', name);
    newCity.push(await page.evaluate(() => new Promise<number>(res => {
      const t0 = performance.now();
      document.querySelector<HTMLFormElement>('.rush-bar')!.requestSubmit();
      requestAnimationFrame(() => requestAnimationFrame(() => res(Math.round(performance.now() - t0))));
    })));
    await page.waitForTimeout(300);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  newCity.sort((a, b) => a - b);
  const result = { normal, slow4x: slow, newCity4x: newCity, budgets: BUDGET };
  test.info().annotations.push({ type: 'City Explorer, 2,000 cities', description: JSON.stringify(result) });
  console.log(JSON.stringify(result));

  expect(normal.idleBusyMsPerSec, 'main-thread ms per second while idle').toBeLessThanOrEqual(BUDGET.idleBusyMsPerSec);
  expect(slow.idle.count, 'long tasks in 5 s idle at 4× slower CPU').toBeLessThanOrEqual(BUDGET.idleLongTasks4x);
  expect(normal.typing.p95, 'keystroke to frame, 95th percentile (ms)').toBeLessThanOrEqual(BUDGET.typingP95);
  expect(slow.typing.p95, 'keystroke to frame at 4× slower CPU, 95th percentile (ms)').toBeLessThanOrEqual(BUDGET.typingP95_4x);
  expect(newCity[2], 'new city to frame at 4× slower CPU, median (ms)').toBeLessThanOrEqual(BUDGET.newCityMedian4x);
  // The cities were really added.
  expect(await page.locator('.rush-readouts .readout:has(span:text-is("Cities")) strong').textContent()).not.toBe(FOUND.toLocaleString('en-US'));
  await sayCity(page, 'Qwxyzzy');
  await ctx.close();
});
