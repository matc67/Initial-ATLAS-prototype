import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryChallenge, sprintChallenge, type GeographyChallenge } from './challenges.ts';
import { addRun, loadPerformance, migrateRecordsV1, perfKey, savePerformance, totalsOf, type GameRun, type PerformanceStore } from './records.ts';
import type { Attempt } from './scoring.ts';
import { CATALOG, overview, recentSprints, recordsFor } from './stats.ts';

const hit = (id: string): Attempt => ({ id, points: 100, mistakes: 0, wrongIds: [], hint: false });
const miss = (id: string): Attempt => ({ id, points: 50, mistakes: 1, wrongIds: ['X'], hint: false });
let n = 0;
const run = (c: GeographyChallenge, results: Attempt[], ms: number, day: number): GameRun =>
  ({ id: `r${++n}`, challengeId: c.id, version: c.version, completedAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`, activeTimeMs: ms, results });
const ten = (misses = 0) => Array.from({ length: 10 }, (_, i) => (i < misses ? miss(`C${i}`) : hit(`C${i}`)));
function play(store: PerformanceStore, c: GeographyChallenge, r: GameRun) {
  return { ...store, [perfKey(c)]: addRun(store[perfKey(c)], r).performance };
}

const africaSprint = sprintChallenge('Africa', '200', 'find'), europeSprint = sprintChallenge('Europe', '195', 'name');
const oceaniaFull = countryChallenge('Oceania', '200', 'find');
let store: PerformanceStore = {};
store = play(store, africaSprint, run(africaSprint, ten(2), 40_000, 20));   // 900, 80%
store = play(store, africaSprint, run(africaSprint, ten(0), 35_000, 21));   // 1,000, perfect
store = play(store, europeSprint, run(europeSprint, ten(1), 50_000, 22));   // 950
store = play(store, oceaniaFull, run(oceaniaFull, Array.from({ length: 14 }, (_, i) => (i < 4 ? miss(`O${i}`) : hit(`O${i}`))), 90_000, 23));

test('the catalog covers every area, set, mode and kind once, with distinct keys', () => {
  assert.equal(CATALOG.length, 8 * 2 * 2 * 2);
  assert.equal(new Set(CATALOG.map(c => c.key)).size, CATALOG.length);
});

test('all-time overview adds up the real runs only', () => {
  const o = overview(store);
  assert.deepEqual([o.games, o.sprints, o.perfect, o.bestSprintScore, o.bestStreak, o.countriesAnswered], [4, 3, 1, 1000, 10, 44]);
  // 44 answered, 7 missed first try: (44 − 7) / 44.
  assert.ok(Math.abs(o.accuracy! - (37 / 44) * 100) < 1e-9);
  assert.equal(o.accuracyRuns, 4);
  const empty = overview({});
  assert.deepEqual([empty.games, empty.bestSprintScore, empty.bestStreak, empty.accuracy, empty.countriesAnswered], [0, null, null, null, 0]);
});

test('records are filtered by kind, mode and set, one per area, never mixing Sprint and Full', () => {
  const sprintFind200 = recordsFor(store, { kind: 'sprint', mode: 'find', set: '200' });
  assert.equal(sprintFind200.length, 8);
  assert.deepEqual(sprintFind200.filter(r => r.performance).map(r => [r.ref.area, r.performance!.bestScore, r.performance!.runs]), [['Africa', 1000, 2]]);
  assert.deepEqual(recordsFor(store, { kind: 'full', mode: 'find', set: '200' }).filter(r => r.performance).map(r => r.ref.area), ['Oceania']);
  assert.deepEqual(recordsFor(store, { kind: 'sprint', mode: 'name', set: '195' }).filter(r => r.performance).map(r => r.ref.area), ['Europe']);
  assert.equal(recordsFor(store, { kind: 'full', mode: 'name', set: '200' }).filter(r => r.performance).length, 0);
});

test('recent Sprints are newest first, across areas, with the personal best marked', () => {
  const recent = recentSprints(store);
  assert.deepEqual(recent.map(r => [r.ref.area, r.run.score, r.isBest]), [['Europe', 950, true], ['Africa', 1000, true], ['Africa', 900, false]]);
  assert.equal(recent[2].best.score, 1000);
  assert.ok(!recent.some(r => r.ref.kind !== 'sprint'), 'a Full Challenge run is listed as a Sprint');
  assert.deepEqual(recentSprints({}), []);
});

test('the latest and best runs of a record are kept for the Progress globe, Sprints included', () => {
  const p = store[perfKey(africaSprint)];
  assert.equal(p.latestRun?.results.length, 10);
  assert.equal(p.bestRun?.id, p.latestRun?.id);   // the perfect second run is both
  assert.notEqual(p.history[1].runId, p.best.runId);
});

test('records from before running totals still count, from their history; v1 records add games but no made-up accuracy', () => {
  const legacy = migrateRecordsV1({ '200|find|South America': { runs: 3, perfectRuns: 1, bestScore: 1200, bestAccuracy: 100, fewestMistakes: 0, fastestMs: 20_000, longestStreak: 12, best: { score: 1200, maxScore: 1200, accuracy: 100, mistakes: 0, ms: 20_000, streak: 12, perfect: true }, at: '2026-10-01T00:00:00Z' } });
  // A v0.2 record: history but no totals field.
  const { totals: _, ...v02 } = store[perfKey(africaSprint)];
  const mixed = { ...legacy, [perfKey(africaSprint)]: v02 };
  assert.deepEqual(totalsOf(v02), { runs: 2, answered: 20, firstTry: 18 });
  const o = overview(mixed);
  assert.equal(o.games, 5);                        // 3 legacy + 2 Sprint runs
  assert.equal(o.countriesAnswered, 3 * 12 + 20);  // every completed run answered every country
  assert.equal(o.accuracyRuns, 2);                 // only the runs with answers on record
  assert.equal(o.accuracy, 90);
  // And a new run adds to the rebuilt totals.
  const next = addRun(v02, run(africaSprint, ten(0), 30_000, 24)).performance;
  assert.deepEqual(next.totals, { runs: 3, answered: 30, firstTry: 28 });
});

test('stats survive a save and reload, and corrupt storage gives empty stats instead of an error', () => {
  const data = new Map<string, string>();
  const ls = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  savePerformance(store, ls);
  assert.deepEqual(overview(loadPerformance(ls)), overview(store));
  data.set('atlas-performance-v2', '{"oops":');
  assert.equal(overview(loadPerformance(ls)).games, 0);
});
