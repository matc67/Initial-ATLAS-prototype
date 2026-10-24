import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addRun, HISTORY_LIMIT, loadPerformance, longestStreak, migrateRecordsV1, perfKey, savePerformance, summarize, toGameRun, type GameRun } from './records.ts';
import { countryChallenge, countryIds, versionOf } from './challenges.ts';
import { guess, newRound, reveal, next, type Attempt } from './scoring.ts';

const hit = (id: string): Attempt => ({ id, points: 100, mistakes: 0, wrongIds: [], hint: false });
const miss = (id: string, wrong: string[]): Attempt => ({ id, points: [100, 50, 25][wrong.length] ?? 10, mistakes: wrong.length, wrongIds: wrong, hint: false });
const hinted = (id: string): Attempt => ({ id, points: 0, mistakes: 0, wrongIds: [], hint: true });
let n = 0;
const run = (results: Attempt[], ms: number, challengeId = 'africa-countries-find', version = 'v'): GameRun =>
  ({ id: `r${++n}`, challengeId, version, completedAt: `2026-10-${String(10 + (n % 20)).padStart(2, '0')}T12:00:00Z`, activeTimeMs: ms, results });
const perfect = (ms: number) => run([hit('A'), hit('B'), hit('C'), hit('D')], ms);

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

test('a run summary is derived from its per-country results', () => {
  const s = summarize(run([hit('A'), miss('B', ['X', 'Y']), hinted('C'), hit('D'), hit('E')], 61_000));
  assert.deepEqual([s.score, s.maxScore, s.accuracy, s.mistakes, s.missed, s.hints, s.streak, s.perfect, s.ms], [325, 500, 60, 2, 2, 1, 2, false, 61_000]);
  assert.equal(longestStreak([hit('A'), hit('B'), miss('C', ['X']), hit('D')]), 2);
  assert.equal(summarize(perfect(1000)).perfect, true);
});

test('a completed round becomes a run with its active time and results', () => {
  let r = newRound(['A', 'B'], 0);
  r = guess(r, 'B', 1000).round;             // wrong on A
  r = guess(r, 'A', 2000).round;
  r = next(reveal(r, 3000), 3000);           // Show me on B ends the round
  const g = toGameRun(r, countryChallenge('Africa', '200', 'find'), 9000, '2026-10-23T00:00:00Z');
  assert.equal(g.activeTimeMs, 3000);        // the clock stopped when the round ended
  assert.deepEqual(g.results.map(a => [a.id, a.points, a.hint]), [['A', 50, false], ['B', 0, true]]);
  assert.equal(g.challengeId, 'africa-countries-find');
});

test('accuracy outranks speed; a faster run with equal accuracy and score sets a new best run', () => {
  const slowPerfect = perfect(25 * 60_000), fastSloppy = run([hit('A'), miss('B', ['X']), hit('C'), hit('D')], 5 * 60_000), fastPerfect = perfect(20 * 60_000);
  let p = addRun(undefined, slowPerfect).performance;
  const sloppy = addRun(p, fastSloppy);
  assert.equal(sloppy.bests.run, false);
  assert.equal(sloppy.bests.time, true);                 // still the fastest time on its own…
  assert.equal(sloppy.performance.best.runId, slowPerfect.id); // …but not the best run
  assert.equal(sloppy.performance.fastestMs, 5 * 60_000);
  p = sloppy.performance;
  const faster = addRun(p, fastPerfect);
  assert.equal(faster.bests.run, true);
  assert.equal(faster.performance.best.runId, fastPerfect.id);
  assert.equal(faster.performance.bestRun?.id, fastPerfect.id);
  assert.equal(faster.performance.latestRun?.id, fastPerfect.id);
  assert.equal(faster.performance.runs, 3);
  assert.equal(faster.performance.perfectRuns, 2);
  assert.equal(faster.performance.fewestMistakes, 0);
});

test('latest and best are kept separately; history is newest first and capped', () => {
  let p = addRun(undefined, perfect(60_000)).performance;
  const worse = run([miss('A', ['X']), hit('B'), hit('C'), hit('D')], 30_000);
  p = addRun(p, worse).performance;
  assert.equal(p.latestRun?.id, worse.id);
  assert.notEqual(p.bestRun?.id, worse.id);
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) p = addRun(p, perfect(70_000 + i)).performance;
  assert.equal(p.history.length, HISTORY_LIMIT);
  assert.equal(p.history[0].ms, 70_000 + HISTORY_LIMIT + 4);
  assert.equal(p.runs, HISTORY_LIMIT + 7);
});

test('records are separate per challenge and per country list', () => {
  const world = countryChallenge('World', '200', 'find'), africa = countryChallenge('Africa', '200', 'find');
  const classic = countryChallenge('World', '195', 'find'), named = countryChallenge('World', '200', 'name');
  assert.equal(new Set([world, africa, classic, named].map(perfKey)).size, 4);
  assert.equal(world.id, 'world-countries-find');
  assert.equal(world.targetIds.length, 200);
  assert.equal(classic.targetIds.length, 195);
  assert.equal(countryChallenge('Americas', '200', 'find').targetIds.length,
    countryIds('North America', '200').length + countryIds('South America', '200').length);
  // The version follows the list of countries, not its order.
  assert.equal(versionOf(['A', 'B']), versionOf(['B', 'A']));
  assert.notEqual(versionOf(['A', 'B']), versionOf(['A', 'C']));
});

test('storage round-trips, survives corrupt data, and keeps version 1 records without inventing runs', () => {
  const m = memory();
  const store = { k: addRun(undefined, perfect(1000)).performance };
  savePerformance(store, m);
  assert.deepEqual(loadPerformance(m), store);
  m.setItem('atlas-performance-v2', '{not json');
  assert.deepEqual(loadPerformance(m), {});
  m.setItem('atlas-performance-v2', JSON.stringify({ bad: { runs: 'x' }, k: store.k }));
  assert.deepEqual(Object.keys(loadPerformance(m)), ['k']);
  assert.deepEqual(loadPerformance(null), {});

  const legacy = memory();
  legacy.setItem('atlas-progress-v2', JSON.stringify({ SDN: { attempts: 3, firstTry: 2, lastSeen: '' } }));
  legacy.setItem('atlas-records-v1', JSON.stringify({
    '200|find|South America': { runs: 2, perfectRuns: 1, bestScore: 1200, bestAccuracy: 100, fewestMistakes: 0, fastestMs: 17_000, longestStreak: 12, best: { score: 1200, maxScore: 1200, accuracy: 100, mistakes: 0, ms: 20_000, streak: 12, perfect: true }, review: [], at: '2026-10-22T00:00:00Z' },
    'junk': 5,
  }));
  const migrated = loadPerformance(legacy);
  const sa = migrated[perfKey(countryChallenge('South America', '200', 'find'))];
  assert.equal(Object.keys(migrated).length, 1);
  assert.deepEqual([sa.runs, sa.bestScore, sa.fastestMs, sa.best.score], [2, 1200, 17_000, 1200]);
  assert.equal(sa.bestRun, undefined);   // no per-country results existed, so none are made up
  assert.deepEqual(sa.history, []);
  assert.equal(sa.best.hints, undefined);
  // Mastery counts are not turned into records.
  assert.ok(!Object.values(migrated).some(p => p.challengeId.includes('SDN')));
  assert.deepEqual(migrateRecordsV1({}), {});
});
