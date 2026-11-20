// Cities You Missed: which cities, what counts as learned, the improvement summary, and what is saved (and when not).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBook, type RushCity } from './cityMatch.ts';
import { finishRush, guessRush, newRush, type Rush } from './cityRush.ts';
import {
  LEARNING_KEY, formatDelta, improvementOf, lastRunOf, learningKey, loadLearning, missedBefore, missedCities, saveLearning, validLastRun, withLastRun,
} from './cityLearning.ts';

const city = (gid: number, name: string, population: number, partOf: number | null = null): RushCity =>
  ({ id: `gn:${gid}`, name, aliases: [], population, lng: 0, lat: 0, admin1: '', region: 0, partOf: partOf ? `gn:${partOf}` : null });
// Canada, roughly: eight cities, a district inside Ottawa, a city with no population figure, and a tie.
const book = buildBook([
  city(1, 'Toronto', 2_800_000), city(2, 'Montréal', 1_760_000), city(3, 'Calgary', 1_240_000), city(4, 'Ottawa', 1_020_000),
  city(5, 'Edmonton', 1_000_000), city(6, 'Winnipeg', 750_000), city(7, 'Vancouver', 660_000), city(8, 'Brampton', 660_000),
  city(9, 'Nepean', 180_000, 4), city(10, 'Ghost Town', 0),
]);
const T0 = 1_700_000_000_000;
const run = (found: number[], mode: 'timed' | 'explorer' = 'timed', start = T0, version = 'v1'): Rush => finishRush(
  found.reduce((r, g, i) => guessRush(r, String(g), `gn:${g}`, start + 1000 * (i + 1)).rush, newRush('CAN', version, mode, start)), start + 300_000);
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

test('missed: the five largest cities not named, largest first, ties by id', () => {
  assert.deepEqual(missedCities(book, []), ['gn:1', 'gn:2', 'gn:3', 'gn:4', 'gn:5']);
  assert.deepEqual(missedCities(book, ['gn:1', 'gn:3']), ['gn:2', 'gn:4', 'gn:5', 'gn:6', 'gn:7']);
  // Vancouver and Brampton tie on population: the lower id first, every time.
  assert.deepEqual(missedCities(book, ['gn:1', 'gn:2', 'gn:3', 'gn:4', 'gn:5', 'gn:6']), ['gn:7', 'gn:8']);
});

test('missed never names a district, a city without a figure, or a city already found; fewer than five when that is all', () => {
  const all = missedCities(book, ['gn:1', 'gn:2', 'gn:3', 'gn:5', 'gn:6', 'gn:7']);
  assert.deepEqual(all, ['gn:4', 'gn:8'], 'Nepean is inside Ottawa; Ghost Town has no figure');
  assert.deepEqual(missedCities(book, ['gn:1', 'gn:2', 'gn:3', 'gn:4', 'gn:5', 'gn:6', 'gn:7', 'gn:8']), []);
});

test('learning: a city leaves the list only when named; forgotten again, it stays', () => {
  const first = lastRunOf(run([3]), book);
  assert.deepEqual(first.missed, ['gn:1', 'gn:2', 'gn:4', 'gn:5', 'gn:6']);
  // Next run remembers Toronto and Ottawa, forgets Montréal again.
  const second = lastRunOf(run([3, 1, 4]), book);
  assert.deepEqual(second.missed, ['gn:2', 'gn:5', 'gn:6', 'gn:7', 'gn:8']);
  assert.ok(second.missed.includes('gn:2'), 'Montréal, forgotten again, is still there');
  // Learned: named this time after being missed last time.
  const before = missedBefore(first, book);
  assert.equal(before.has('gn:1'), true);
  assert.equal(before.has('gn:3'), false, 'found last time: nothing to learn');
});

test('improvement: coverage then and now, cities remembered and the people they brought', () => {
  const prev = lastRunOf(run([3]), book);
  const i = improvementOf(prev, book, 'v1', run([3, 1, 4]).found)!;
  assert.equal(i.previous!.toFixed(2), ((1_240_000 / book.total) * 100).toFixed(2));
  assert.equal(i.current.toFixed(2), (((1_240_000 + 2_800_000 + 1_020_000) / book.total) * 100).toFixed(2));
  assert.ok(Math.abs(i.delta! - (i.current - i.previous!)) < 1e-9);
  assert.deepEqual([i.remembered, i.of, i.recovered], [2, 5, 3_820_000]);
  // Worse this time: shown as a change, not an improvement.
  const worse = improvementOf(lastRunOf(run([1, 2]), book), book, 'v1', run([3]).found)!;
  assert.ok(worse.delta! < 0);
  assert.equal(formatDelta(worse.delta!).startsWith('−'), true);
  assert.equal(formatDelta(9.34), '+9.3 points');
  assert.equal(formatDelta(0.02), 'no change');
  assert.equal(improvementOf(undefined, book, 'v1', []), null);
});

test('after a data change, coverage is not compared, but remembered cities still count', () => {
  const prev = { ...lastRunOf(run([3]), book), version: 'old' };
  const i = improvementOf(prev, book, 'v1', run([1]).found)!;
  assert.equal(i.previous, null);
  assert.equal(i.delta, null);
  assert.equal(i.remembered, 1);
  // Ids the current data no longer has are ignored.
  const gone = { ...prev, missed: ['gn:999', 'gn:1'] };
  assert.deepEqual([...missedBefore(gone, book)], ['gn:1']);
});

test('saved per country and mode; only what is written survives; a corrupted store loads empty', () => {
  const s = new MemoryStorage();
  const timed = lastRunOf(run([3]), book), explorer = lastRunOf(run([1, 2], 'explorer'), book);
  saveLearning(withLastRun(withLastRun({}, timed), explorer), s);
  const back = loadLearning(s);
  assert.deepEqual(Object.keys(back).sort(), [learningKey('CAN', null), learningKey('CAN', 600_000)]);
  assert.deepEqual(back[learningKey('CAN', 600_000)].missed, timed.missed);
  assert.equal(back[learningKey('CAN', 600_000)].runId, String(T0), 'the run id guards against recording one run twice');
  for (const bad of ['{oops', '[]', '42', JSON.stringify({ 'CAN:timed': { country: 'CAN' } })]) {
    s.setItem(LEARNING_KEY, bad);
    assert.deepEqual(loadLearning(s), {}, bad);
  }
  assert.deepEqual(loadLearning(null), {});
  // An entry is filed under what it says it is, whatever key it was stored under.
  s.setItem(LEARNING_KEY, JSON.stringify({ 'USA:timed': timed }));
  assert.deepEqual(Object.keys(loadLearning(s)), ['CAN:timed-600']);
  // Stored ids are cleaned: not ids, repeats and extras are dropped.
  const v = validLastRun({ ...timed, missed: ['gn:1', 'Toronto', 'gn:1', 'gn:2', 'gn:3', 'gn:4', 'gn:5', 'gn:6'] })!;
  assert.deepEqual(v.missed, ['gn:1', 'gn:2', 'gn:3', 'gn:4', 'gn:5']);
});

test('an abandoned run writes nothing: only a completed run replaces the list', () => {
  let store = withLastRun({}, lastRunOf(run([3]), book));
  const before = JSON.stringify(store);
  // An abandoned run is simply never turned into a LastRun (the game discards it); the store is untouched.
  const abandoned = guessRush(newRush('CAN', 'v1', 'timed', T0 + 1e6), 'Toronto', 'gn:1', T0 + 1e6 + 1000).rush;
  assert.equal(abandoned.phase, 'playing');
  assert.equal(JSON.stringify(store), before);
  // A completed one replaces it, for its own mode only.
  store = withLastRun(store, lastRunOf(run([1], 'explorer'), book));
  assert.deepEqual(store[learningKey('CAN', 600_000)].missed, ['gn:1', 'gn:2', 'gn:4', 'gn:5', 'gn:6']);
  store = withLastRun(store, lastRunOf(run([1, 2, 3, 4, 5]), book));
  assert.deepEqual(store[learningKey('CAN', 600_000)].missed, ['gn:6', 'gn:7', 'gn:8']);
});

test('each timed duration keeps its own history; City Explorer its own', () => {
  const five = lastRunOf(finishRush(guessRush(newRush('CAN', 'v1', 'timed', T0, 300), 'Calgary', 'gn:3', T0 + 1000).rush, T0 + 300_000), book);
  const twenty = lastRunOf(finishRush(guessRush(newRush('CAN', 'v1', 'timed', T0 + 1, 1200), 'Toronto', 'gn:1', T0 + 1000).rush, T0 + 1_200_000), book);
  const store = withLastRun(withLastRun({}, five), twenty);
  assert.deepEqual(Object.keys(store).sort(), ['CAN:timed-1200', 'CAN:timed-300']);
  assert.equal(store['CAN:timed-300'].missed[0], 'gn:1', 'the 20-minute run did not overwrite the 5-minute lesson');
  assert.equal(store['CAN:timed-1200'].missed[0], 'gn:2');
  assert.equal(learningKey('CAN', null), 'CAN:explorer');
});

test('a history saved before durations is kept as Classic Rush (5 minutes)', () => {
  const s = new MemoryStorage();
  const { durationMs: _d, ...old } = lastRunOf(run([3]), book);
  s.setItem(LEARNING_KEY, JSON.stringify({ 'CAN:timed': old }));
  const back = loadLearning(s);
  assert.deepEqual(Object.keys(back), ['CAN:timed-300']);
  assert.equal(back['CAN:timed-300'].durationMs, 300_000);
});
