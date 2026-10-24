import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS } from '../data/countries.ts';
import { ROSTER } from '../data/roster.ts';
import { SPRINT_SIZE, countryChallenge, countryIds, sprintChallenge } from './challenges.ts';
import { addRun, loadPerformance, perfKey, savePerformance, summarize, toGameRun } from './records.ts';
import { guess, newRound, next, pause, resume, reveal, statsOf } from './scoring.ts';
import { bestsOf, compareWithBests, planSprint } from './sprint.ts';

// A small seeded generator (mulberry32), so random draws are repeatable in tests.
const seeded = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const byId = new Map(ROSTER.map(r => [r.id, r]));

// Plays a whole Sprint: `plan[i]` is how question i goes: 0 = first try, n = n wrong guesses first, 'hint' = Show me.
function playSprint(queue: string[], plan: (number | 'hint')[] = [], step = 1000) {
  let r = newRound(queue, 0), t = 0;
  const wrongFor = (target: string) => queue.find(id => id !== target && !r.answers.some(a => a.id === id))!;
  for (let i = 0; i < queue.length; i++) {
    const p = plan[i] ?? 0, target = queue[i];
    if (p === 'hint') { r = next(reveal(r, (t += step)), t); continue; }
    for (let k = 0; k < p; k++) r = guess(r, wrongFor(target), (t += step)).round;
    r = guess(r, target, (t += step)).round;
  }
  return { round: r, now: t };
}

test('every Sprint is exactly 10 unique countries from the chosen area and country set', () => {
  for (const area of AREAS) for (const set of ['200', '195'] as const) {
    const pool = countryIds(area, set);
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planSprint(pool, seeded(seed));
      assert.equal(plan.ok, true, `${area} ${set}`);
      if (!plan.ok) continue;
      assert.equal(plan.queue.length, SPRINT_SIZE);
      assert.equal(new Set(plan.queue).size, SPRINT_SIZE);
      for (const id of plan.queue) assert.ok(pool.includes(id), `${id} is not in ${area} (${set})`);
    }
  }
  // Classic 195 Sprints never draw the five extra ATLAS countries.
  const classic = new Set(Array.from({ length: 50 }, (_, s) => planSprint(countryIds('World', '195'), seeded(s + 1))).flatMap(p => (p.ok ? p.queue : [])));
  for (const id of ['XKX', 'KOS', 'TWN', 'SAH', 'GRL', 'PRI']) assert.equal(classic.has(id), false, `${id} drawn in a Classic 195 Sprint`);
  assert.ok([...classic].every(id => byId.get(id)?.status === 'un-member' || byId.get(id)?.status === 'un-observer'));
});

test('replays draw a fresh random ten; every country can come up', () => {
  const pool = countryIds('Africa', '200');
  const draws = Array.from({ length: 30 }, (_, s) => planSprint(pool, seeded(s + 100))).map(p => (p.ok ? p.queue.join() : ''));
  assert.ok(new Set(draws).size >= 29, 'replays should almost never repeat');
  const seen = new Set(Array.from({ length: 200 }, (_, s) => planSprint(pool, seeded(s + 1))).flatMap(p => (p.ok ? p.queue : [])));
  assert.equal(seen.size, pool.length);
  // Order is shuffled too, not just the choice.
  const a = planSprint(pool, seeded(7)), b = planSprint(pool, seeded(8));
  assert.ok(a.ok && b.ok && a.queue.join() !== b.queue.join());
});

test('a pool smaller than 10 is reported, not shortened', () => {
  assert.deepEqual(planSprint(['A', 'B', 'C']), { ok: false, available: 3 });
  assert.deepEqual(planSprint(['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']), { ok: false, available: 9 });
  const ten = planSprint(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  assert.ok(ten.ok && ten.queue.length === 10);
});

test('Sprint scoring: 1,000 for a perfect run, normal points otherwise', () => {
  const plan = planSprint(countryIds('Europe', '200'), seeded(3));
  assert.ok(plan.ok);
  const perfect = playSprint(plan.queue);
  const s = statsOf(perfect.round, perfect.now);
  assert.deepEqual([perfect.round.phase, s.score, s.maxScore, s.accuracy, s.perfect, s.longestStreak], ['done', 1000, 1000, 100, true, 10]);
  // 2nd, 3rd and 5th attempts plus one Show me: 100×6 + 50 + 25 + 10 + 0 = 685.
  const mixed = playSprint(plan.queue, [0, 1, 0, 2, 0, 4, 0, 'hint', 0, 0]);
  const m = statsOf(mixed.round, mixed.now);
  assert.deepEqual([m.score, m.firstTryCorrect, m.totalMistakes, m.hintsUsed, m.perfect, m.longestStreak], [685, 6, 7, 1, false, 2]);
});

test('the Sprint clock counts active time only and stops at the tenth country', () => {
  const plan = planSprint(countryIds('Asia', '200'), seeded(5));
  assert.ok(plan.ok);
  let r = newRound(plan.queue, 0);
  for (let i = 0; i < 5; i++) r = guess(r, plan.queue[i], (i + 1) * 1000).round;  // 5 s
  r = pause(r, 5000);
  r = resume(r, 65_000);                                                           // a minute away
  for (let i = 5; i < 10; i++) r = guess(r, plan.queue[i], 65_000 + (i - 4) * 1000).round;
  assert.equal(r.phase, 'done');
  assert.equal(statsOf(r, 999_999).elapsedMs, 10_000);
});

test('Sprint records: kept apart from Full Challenge records and per area, set and mode', () => {
  const ids = [
    sprintChallenge('Africa', '200', 'find'), sprintChallenge('Africa', '195', 'find'), sprintChallenge('Africa', '200', 'name'),
    sprintChallenge('Europe', '200', 'find'), countryChallenge('Africa', '200', 'find'),
  ].map(perfKey);
  assert.equal(new Set(ids).size, ids.length);
  const sprint = sprintChallenge('Africa', '200', 'find');
  assert.deepEqual([sprint.kind, sprint.size, sprint.id], ['sprint', 10, 'africa-sprint-find']);
  assert.equal(countryChallenge('Africa', '200', 'find').kind, 'full');
});

test('personal bests update run by run, with accuracy ranked before speed', () => {
  const c = sprintChallenge('Africa', '200', 'find');
  const plan = planSprint(c.targetIds, seeded(11));
  assert.ok(plan.ok);
  const run = (p: (number | 'hint')[], step: number) => { const g = playSprint(plan.queue, p, step); return toGameRun(g.round, c, g.now, '2026-10-24T10:00:00Z'); };
  const first = addRun(undefined, run([0, 1], 3000));                 // 950, 2 s slower per step
  assert.equal(bestsOf(undefined), null);
  const before = bestsOf(first.performance)!;
  const fastSloppy = run([1, 1, 1], 500);
  const cmp = compareWithBests(summarize(fastSloppy), before);
  const at = (stat: string) => cmp.find(r => r.stat === stat)!;
  assert.equal(at('time').better, true);
  assert.equal(at('score').better, false);
  assert.equal(at('score').delta, 850 - 950);
  const second = addRun(first.performance, fastSloppy);
  assert.equal(second.bests.run, false);                              // faster, but less accurate: not the best run
  assert.equal(second.performance.fastestMs, fastSloppy.activeTimeMs); // still the fastest time
  const third = addRun(second.performance, run([], 400));             // perfect and fastest
  assert.deepEqual([third.bests.run, third.bests.score, third.performance.perfectRuns, third.performance.runs], [true, true, 1, 3]);
  assert.equal(third.performance.bestScore, 1000);
  // First run: nothing to beat, so no line reports "better".
  assert.ok(compareWithBests(summarize(run([], 400)), null).every(r => !r.better && r.best === null));
});

test('Sprint records persist through storage next to existing Full Challenge records', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  // An existing store with a Full Challenge record.
  const full = countryChallenge('Oceania', '200', 'find');
  const fullRun = playSprint(full.targetIds);
  const saved = { [perfKey(full)]: addRun(undefined, toGameRun(fullRun.round, full, fullRun.now)).performance };
  savePerformance(saved, store);
  // A Sprint is added the way the app does it: load, add, save.
  const sprint = sprintChallenge('Oceania', '200', 'find');
  const plan = planSprint(sprint.targetIds, seeded(2));
  assert.ok(plan.ok);
  const g = playSprint(plan.queue);
  const loaded = loadPerformance(store);
  savePerformance({ ...loaded, [perfKey(sprint)]: addRun(loaded[perfKey(sprint)], toGameRun(g.round, sprint, g.now)).performance }, store);
  const after = loadPerformance(store);
  assert.deepEqual(after[perfKey(full)], saved[perfKey(full)]);       // untouched
  assert.equal(after[perfKey(sprint)].bestScore, 1000);
  assert.equal(after[perfKey(sprint)].best.maxScore, 1000);
  assert.equal(after[perfKey(sprint)].latestRun?.results.length, 10);
});
