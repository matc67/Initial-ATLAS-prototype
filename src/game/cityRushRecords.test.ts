import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishRush, guessRush, newRush, type Rush } from './cityRush.ts';
import {
  ACTIVE_KEY, BESTS_KEY, EXPLORER_KEY, addTimedRun, loadActive, loadExplorer, loadTimedStore, restoreRun, saveActive, saveExplorer,
  saveTimedStore, timedKey, toSaved, withExplorerRun, withoutExplorerRun, CHOICE_KEY, loadChoice, saveChoice,
} from './cityRushRecords.ts';

const T0 = 1_700_000_000_000;
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const play = (r: Rush, names: string[], start = T0) => names.reduce((x, k, i) => guessRush(x, k, k, start + (i + 1) * 1000).rush, r);
const timedRun = (count: number) => finishRush(play(newRush('CAN', 'v1', 'timed', T0), Array.from({ length: count }, (_, i) => `c${i}`)), T0 + 300_000);

const TOTAL = 1_000_000;
test('personal bests: the most people wins; more cities break a tie; an exact tie is not a new best', () => {
  const a = addTimedRun(undefined, timedRun(12), 400_000, TOTAL, 'a');
  assert.equal(a.first, true);
  assert.equal(a.newBest, false);
  assert.equal(a.record.best, 400_000);
  assert.equal(a.record.bestCities, 12);
  assert.equal(a.record.total, TOTAL);
  const b = addTimedRun(a.record, timedRun(12), 400_000, TOTAL, 'b');
  assert.equal(b.newBest, false, 'a tie is not a new best');
  assert.equal(b.before, 400_000);
  const more = addTimedRun(b.record, timedRun(15), 400_000, TOTAL, 'm');
  assert.equal(more.newBest, true, 'same people, more cities');
  const c = addTimedRun(more.record, timedRun(3), 650_000, TOTAL, 'c');
  assert.equal(c.newBest, true, 'fewer cities, more people: population is the score');
  assert.equal(c.record.best, 650_000);
  assert.equal(c.record.bestCities, 3);
  assert.equal(c.record.bestAt, 'c');
  const d = addTimedRun(c.record, timedRun(40), 100_000, TOTAL, 'd');
  assert.equal(d.record.best, 650_000);
  assert.equal(d.record.latest, 100_000);
  assert.equal(d.record.latestCities, 40);
  assert.equal(d.record.runs, 5);
  assert.deepEqual(d.record.history, [100_000, 650_000, 400_000, 400_000, 400_000]);
});

test('records are kept per country, duration and data version', () => {
  assert.notEqual(timedKey('CAN', 300_000, 'v1'), timedKey('CAN', 600_000, 'v1'));
  assert.notEqual(timedKey('CAN', 300_000, 'v1'), timedKey('CAN', 300_000, 'v2'));
  assert.notEqual(timedKey('CAN', 300_000, 'v1'), timedKey('USA', 300_000, 'v1'));
});

test('timed bests survive storage and corrupted entries are dropped', () => {
  const s = new MemoryStorage();
  const rec = addTimedRun(undefined, timedRun(7), 7000, TOTAL).record;
  saveTimedStore({ [timedKey('CAN', 300_000, 'v1')]: rec, broken: { country: 'X' } as never }, s);
  const back = loadTimedStore(s);
  assert.deepEqual(Object.keys(back), [timedKey('CAN', 300_000, 'v1')]);
  assert.equal(back[timedKey('CAN', 300_000, 'v1')].best, 7000);
  s.setItem(BESTS_KEY, '{not json');
  assert.deepEqual(loadTimedStore(s), {});
  assert.deepEqual(loadTimedStore(null), {});
});

test('explorer progress is saved per country and restored with its cities and active time', () => {
  const s = new MemoryStorage();
  const r = play(newRush('CAN', 'v1', 'explorer', T0), ['toronto', 'ottawa', 'montreal']);
  saveExplorer(withExplorerRun(loadExplorer(s), toSaved(r, T0 + 4000)), s);
  const store = loadExplorer(s);
  assert.equal(store.last, 'CAN');
  const back = restoreRun(store.countries.CAN, new Set(['toronto', 'ottawa', 'montreal']), 'v1', T0 + 99_000);
  assert.deepEqual(back.found, ['toronto', 'ottawa', 'montreal']);
  assert.equal(back.mode, 'explorer');
  assert.equal(back.clock.accumulated, 4000);
  assert.equal(back.clock.since, T0 + 99_000);
  // Reset: the country's progress goes, others stay.
  const usa = toSaved(play(newRush('USA', 'u1', 'explorer', T0), ['boston']), T0 + 2000);
  const both = withExplorerRun(store, usa);
  const reset = withoutExplorerRun(both, 'CAN');
  assert.deepEqual(Object.keys(reset.countries), ['USA']);
});

test('restoring outdated progress keeps only cities the current data can still score, without duplicates', () => {
  const saved = { ...toSaved(play(newRush('CAN', 'v1', 'explorer', T0), ['toronto', 'kitchener', 'ottawa']), T0 + 5000), found: ['toronto', 'kitchener', 'ottawa', 'toronto'], foundAt: [1000, 2000, 3000, 4000] };
  const back = restoreRun(saved, new Set(['toronto', 'ottawa']), 'v2', T0);
  assert.deepEqual(back.found, ['toronto', 'ottawa']);
  assert.deepEqual(back.foundAt, [1000, 3000]);
  assert.equal(back.version, 'v2');
});

test('corrupted or foreign explorer data loads as empty, never throws', () => {
  const s = new MemoryStorage();
  for (const bad of ['{oops', '42', 'null', JSON.stringify({ last: 'CAN', countries: { CAN: { country: 'CAN', found: 'x' } } }),
    JSON.stringify({ last: 'CAN', countries: { CAN: { country: 'USA', version: 'v', startedAt: 1, ms: 1, durationMs: null, found: [] } } })]) {
    s.setItem(EXPLORER_KEY, bad);
    assert.deepEqual(loadExplorer(s), { last: null, countries: {} }, bad);
  }
});

test('a timed run in progress resumes with its original deadline, never a fresh one', () => {
  const s = new MemoryStorage();
  const r = play(newRush('CAN', 'v1', 'timed', T0), ['toronto']);
  saveActive(toSaved(r, T0 + 60_000), s);
  const a = loadActive(s)!;
  assert.equal(a.startedAt, T0);
  const back = restoreRun(a, new Set(['toronto']), 'v1', T0 + 120_000);
  assert.equal(back.startedAt, T0);
  assert.equal(back.durationMs, 600_000);
  assert.deepEqual(back.found, ['toronto']);
  saveActive(null, s);
  assert.equal(s.getItem(ACTIVE_KEY), null);
  // An explorer run is never taken for a timed one.
  s.setItem(ACTIVE_KEY, JSON.stringify(toSaved(newRush('CAN', 'v1', 'explorer', T0), T0)));
  assert.equal(loadActive(s), null);
  s.setItem(ACTIVE_KEY, '[]');
  assert.equal(loadActive(s), null);
});

test('bests are kept apart by duration: a 20-minute run never touches the 5-minute best', () => {
  const run = (sec: number) => finishRush(play(newRush('CAN', 'v1', 'timed', T0, sec), ['a', 'b']), T0 + sec * 1000);
  const five = addTimedRun(undefined, run(300), 100, TOTAL).record;
  let store = { [timedKey('CAN', 300_000, 'v1')]: five };
  const twenty = addTimedRun(store[timedKey('CAN', 1_200_000, 'v1')], run(1200), 900, TOTAL);
  assert.equal(twenty.first, true, 'its own first run, not a new best over the 5-minute one');
  store = { ...store, [timedKey('CAN', 1_200_000, 'v1')]: twenty.record };
  assert.equal(store[timedKey('CAN', 300_000, 'v1')].best, 100);
  assert.equal(store[timedKey('CAN', 1_200_000, 'v1')].best, 900);
  assert.equal(store[timedKey('CAN', 1_200_000, 'v1')].durationMs, 1_200_000);
});

test('a timed run of any length resumes with its own deadline', () => {
  const s = new MemoryStorage();
  saveActive(toSaved(newRush('CAN', 'v1', 'timed', T0, 1200), T0 + 60_000), s);
  const back = restoreRun(loadActive(s)!, new Set(), 'v1', T0 + 600_000);
  assert.equal(back.durationMs, 1_200_000);
  assert.equal(back.startedAt, T0);
});

test('the chosen mode is remembered; Extended until one is chosen; nonsense is ignored', () => {
  const s = new MemoryStorage();
  assert.equal(loadChoice(s), 600);
  saveChoice(180, s);
  assert.equal(loadChoice(s), 180);
  saveChoice('explorer', s);
  assert.equal(loadChoice(s), 'explorer');
  s.setItem(CHOICE_KEY, '999');
  assert.equal(loadChoice(s), 600);
  assert.equal(loadChoice(null), 600);
});
