// Streak bonuses (scoring version 2): the rules, the maximum scores, and that play, results and records all agree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryChallenge, countryIds, sprintChallenge } from './challenges.ts';
import { answerEvent, celebration, FEEDBACK, flameTier, nextAttempt } from './feedback.ts';
import { addRun, migrateRecordsV1, perfKey, summarize, toGameRun, type GameRun } from './records.ts';
import {
  bonusAt, bonusesOf, guess, maxBonusFor, maxScoreFor, milestoneAt, newRound, next, pause, resume, reveal, scoreOf, statsOf,
  streaksOf, STREAK_MILESTONES, type Attempt, type Round,
} from './scoring.ts';
import { overview, recentSprints, recordsFor } from './stats.ts';
import { ROSTER } from '../data/roster.ts';
import { normalize } from './names.ts';

const hit = (id: string): Attempt => ({ id, points: 100, mistakes: 0, wrongIds: [], hint: false });
const miss = (id: string): Attempt => ({ id, points: 50, mistakes: 1, wrongIds: ['X'], hint: false });
const hinted = (id: string): Attempt => ({ id, points: 0, mistakes: 0, wrongIds: [], hint: true });
const hits = (n: number, p = 'C') => Array.from({ length: n }, (_, i) => hit(`${p}${i}`));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `Q${i}`);

// Plays the first `count` questions of a round: `plan[i]` is how question i goes: 0 = first try, n = n wrong guesses
// first, 'hint' = Show me.
function play(queue: string[], plan: (number | 'hint')[] = [], count = queue.length): { round: Round; now: number } {
  let r = newRound(queue, 0), t = 0;
  queue.slice(0, count).forEach((target, i) => {
    const p = plan[i] ?? 0;
    if (p === 'hint') { r = next(reveal(r, (t += 1000)), t); return; }
    for (let k = 0; k < p; k++) r = guess(r, `WRONG${k}`, (t += 1000)).round;
    r = guess(r, target, (t += 1000)).round;
  });
  return { round: r, now: t };
}

test('milestones: +50 at 3, +100 at 5, +250 at 10, +500 at 20, +1,500 at 50, +4,000 at 100', () => {
  assert.deepEqual(STREAK_MILESTONES.map(m => [m.streak, m.bonus]), [[3, 50], [5, 100], [10, 250], [20, 500], [50, 1500], [100, 4000]]);
  assert.deepEqual([1, 2, 3, 4, 5, 9, 10, 11, 20, 50, 99, 100, 101].map(bonusAt), [0, 0, 50, 0, 100, 0, 250, 0, 500, 1500, 0, 4000, 0]);
  assert.equal(milestoneAt(4), undefined);
  assert.equal(milestoneAt(10)?.bonus, 250);
});

test('streaks count first-try answers only; a wrong guess, Show me or a later attempt resets them', () => {
  assert.deepEqual(streaksOf([hit('A'), hit('B'), miss('C'), hit('D'), hinted('E'), hit('F')]), [1, 2, 0, 1, 0, 1]);
  // In a live round, a wrong guess breaks the streak at once, before the country is found.
  let r = play(ids(4), [0, 0], 2).round;
  assert.equal(r.streak, 2);
  r = guess(r, 'WRONG', 99_000).round;
  assert.equal(r.streak, 0);
  r = guess(r, 'Q2', 100_000).round;                   // found on the 2nd attempt: no streak
  assert.equal(r.streak, 0);
  r = reveal(guess(r, 'Q3', 101_000).round, 102_000);  // Q3 found first try (streak 1), then nothing left
  assert.equal(r.best, 2);
  const shown = play(ids(3), [0, 'hint', 0]).round;
  assert.deepEqual(streaksOf(shown.answers), [1, 0, 1]);
});

test('a perfect 10 earns 1,000 base + 50 + 100 + 250 = 1,400; the Sprint maximum is 1,400', () => {
  const { round, now } = play(ids(10));
  const s = statsOf(round, now);
  assert.deepEqual([s.base, s.bonus, s.score, s.maxScore], [1000, 400, 1400, 1400]);
  assert.equal(maxScoreFor(10), 1400);
  assert.equal(sprintChallenge('World', '200', 'find').size, 10);
  assert.deepEqual(bonusesOf(round.answers), [0, 0, 50, 0, 100, 0, 0, 0, 0, 250]);
});

test('each milestone pays once per continuous streak, and again after the streak breaks', () => {
  // 3 first try, a miss, 3 first try: +50 twice. 4 and 6 in a row pay nothing extra.
  assert.equal(scoreOf([...hits(3), miss('M'), ...hits(3, 'D')]).bonus, 100);
  assert.equal(scoreOf(hits(4)).bonus, 50);
  assert.equal(scoreOf(hits(6)).bonus, 150);
  // Show me breaks it too.
  assert.equal(scoreOf([...hits(5), hinted('H'), ...hits(5, 'D')]).bonus, 300);
});

test('Full Challenge bonuses: long streaks reach the bigger milestones', () => {
  assert.equal(maxBonusFor(54), 50 + 100 + 250 + 500 + 1500);
  assert.equal(maxScoreFor(54), 5400 + 2400);
  assert.equal(maxScoreFor(200), 20_000 + 6400);
  assert.equal(maxScoreFor(2), 200);
  // 25 in a row, a miss, then 12 in a row.
  const results = [...hits(25), miss('M'), ...hits(12, 'D')];
  assert.deepEqual(scoreOf(results), { base: 3750, bonus: 900 + 400, total: 5050 });
  // A live round gives the same.
  const { round, now } = play(ids(38), [...Array(25).fill(0), 1]);
  assert.equal(statsOf(round, now).score, 5050);
  assert.equal(statsOf(round, now).longestStreak, 25);
});

test('the score saved for a run is the score shown during play and on the results screen', () => {
  const c = countryChallenge('Africa', '200', 'find');
  for (const plan of [[], [0, 0, 1, 0, 0, 0, 0, 0], [2, 'hint', 0, 0, 0, 0, 0, 3, 0, 0, 0] as (number | 'hint')[]]) {
    const { round, now } = play(c.targetIds, plan);
    const s = statsOf(round, now), run = toGameRun(round, c, now), saved = summarize(run);
    assert.equal(run.scoring, 2);
    assert.deepEqual([saved.score, saved.base, saved.bonus, saved.maxScore, saved.streak], [s.score, s.base, s.bonus, s.maxScore, s.longestStreak]);
    assert.equal(s.base + s.bonus, s.score);
    assert.equal(addRun(undefined, run).performance.bestScore, s.score);
  }
});

test('runs saved before streak bonuses keep their original score and stay readable', () => {
  const old: GameRun = { id: 'old', challengeId: 'africa-sprint-find', version: 's10-x', completedAt: '2026-10-01T00:00:00Z', activeTimeMs: 30_000, results: hits(10) };
  const s = summarize(old);
  assert.deepEqual([s.score, s.bonus, s.maxScore, s.countries], [1000, 0, 1000, 10]);
  assert.equal(maxScoreFor(10, 1), 1000);
  // A v0.2 summary has no base/bonus/countries fields; the records still read it.
  const { base: _b, bonus: _o, countries: _c, ...v02 } = s;
  const perf = addRun(undefined, old).performance;
  const legacy = { ...perf, best: v02, history: [v02], latest: v02, totals: undefined };
  assert.equal(overview({ k: legacy }).countriesAnswered, 10);
});

test('scoring versions are kept apart: old scores are never ranked against new ones', () => {
  const sprint = sprintChallenge('Africa', '200', 'find'), full = countryChallenge('Africa', '200', 'find');
  assert.notEqual(sprint.version, sprint.earlierVersion);
  assert.notEqual(full.version, full.earlierVersion);
  assert.ok(sprint.version.endsWith('.sc2') && full.version.endsWith('.sc2'));
  // A record made before bonuses (stored under the earlier version) and a new one.
  const oldRun: GameRun = { id: 'o', challengeId: sprint.id, version: sprint.earlierVersion, completedAt: '2026-10-01T00:00:00Z', activeTimeMs: 20_000, results: hits(10) };
  const newRun: GameRun = { id: 'n', challengeId: sprint.id, version: sprint.version, scoring: 2, completedAt: '2026-10-24T00:00:00Z', activeTimeMs: 40_000, results: [miss('A'), ...hits(9)] };
  const store = {
    [perfKey({ id: sprint.id, version: sprint.earlierVersion })]: addRun(undefined, oldRun).performance,
    [perfKey(sprint)]: addRun(undefined, newRun).performance,
  };
  const o = overview(store);
  assert.equal(o.games, 2);                            // all-time totals count both
  assert.equal(o.bestSprintScore, 50 + 900 + 150);     // but only the current record's score is a best
  const shown = recordsFor(store, { kind: 'sprint', mode: 'find', set: '200' }).find(r => r.ref.area === 'Africa')!;
  assert.equal(shown.performance?.bestScore, 1100);
  assert.deepEqual(recentSprints(store).map(r => [r.run.score, r.earlier]), [[1100, false], [1000, true]]);
  // Version 1 records are migrated to the earlier version, never mixed into the current record.
  const v1 = migrateRecordsV1({ '200|find|Africa': { runs: 1, perfectRuns: 1, bestScore: 5400, bestAccuracy: 100, fewestMistakes: 0, fastestMs: 1, longestStreak: 54, best: { score: 5400, maxScore: 5400, accuracy: 100, mistakes: 0, ms: 1, streak: 54, perfect: true }, at: '2026-10-01T00:00:00Z' } });
  assert.deepEqual(Object.keys(v1), [perfKey({ id: full.id, version: full.earlierVersion })]);
  assert.equal(countryIds('Africa', '200').length, full.targetIds.length);
});

test('answer feedback: points and bonus on a correct answer, next-attempt points on a wrong one', () => {
  let r = play(ids(5), [0, 0], 2).round;
  const third = guess(r, 'Q2', 50_000);
  assert.deepEqual(answerEvent(r, third.round, third.outcome), { kind: 'correct', points: 100, bonus: 50, milestone: { streak: 3, bonus: 50 }, streak: 3 });
  r = third.round;
  const wrong = guess(r, 'WRONG', 51_000);
  assert.deepEqual(answerEvent(r, wrong.round, wrong.outcome), { kind: 'wrong', nextPoints: 50, lostStreak: 3 });
  const again = guess(wrong.round, 'WRONG2', 52_000);
  assert.deepEqual(answerEvent(wrong.round, again.round, again.outcome), { kind: 'wrong', nextPoints: 25, lostStreak: 0 });
  const late = guess(again.round, 'Q3', 53_000);
  assert.deepEqual(answerEvent(again.round, late.round, late.outcome), { kind: 'correct', points: 25, bonus: 0, milestone: undefined, streak: 0 });
  assert.equal(nextAttempt(50), 'Next attempt · 50 pts');
});

test('ignored clicks give no feedback and never break a streak', () => {
  let r = play(ids(4), [0, 0], 2).round;
  // A repeat of the same click within 300 ms, a completed country, and any click while paused.
  const repeat = guess(guess(r, 'Q2', 10_000).round, 'Q2', 10_100);
  assert.equal(repeat.outcome, 'ignored');
  assert.equal(answerEvent(r, repeat.round, repeat.outcome), null);
  const done = guess(r, 'Q0', 20_000);
  assert.deepEqual([done.outcome, done.round.streak], ['ignored', 2]);
  const paused = pause(r, 30_000);
  const click = guess(paused, 'WRONG', 31_000);
  assert.deepEqual([click.outcome, click.round.streak, click.round.wrong.length], ['ignored', 2, 0]);
  // The clock does not run while paused.
  r = resume(paused, 90_000);
  assert.equal(statsOf(r, 91_000).elapsedMs, statsOf(paused, 30_000).elapsedMs + 1000);
});

test('celebrations grow with the streak and never name a country', () => {
  const c = STREAK_MILESTONES.map(celebration);
  assert.deepEqual(c.map(x => [x.title, x.detail]), [
    ['3 in a row!', '+50 bonus'], ['On fire!', '+100 bonus'], ['Unstoppable!', '+250 bonus'],
    ['Incredible streak!', '+500 bonus'], ['Legendary!', '+1,500 bonus'], ['World class!', '+4,000 bonus'],
  ]);
  assert.deepEqual(c.map(x => x.tier), [1, 2, 3, 4, 4, 4]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 10, 40].map(flameTier), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const names = ROSTER.flatMap(r => [r.name, ...r.aliases]).map(normalize);
  for (const m of c.flatMap(x => [x.title, x.detail])) assert.ok(!names.some(n => ` ${normalize(m)} `.includes(` ${n} `)), m);
});

test('a correct answer moves to the next question at once: feedback never holds up the round', () => {
  const r = newRound(ids(3), 0);
  const g = guess(r, 'Q0', 1000);
  assert.deepEqual([g.outcome, g.round.index, g.round.phase], ['correct', 1, 'asking']);
  // The next question can be answered straight away, even 1 ms later.
  assert.equal(guess(g.round, 'Q1', 1001).outcome, 'correct');
  // And a wrong answer allows an immediate retry.
  const w = guess(r, 'Q2', 1000);
  assert.deepEqual([w.outcome, guess(w.round, 'Q0', 1001).outcome], ['wrong', 'correct']);
});

test('wrong-answer feedback never names a country', () => {
  const names = ROSTER.flatMap(r => [r.name, ...r.aliases]).map(normalize);
  for (const m of [FEEDBACK.wrong, ...[100, 50, 25, 10].map(nextAttempt), 'Streak lost']) {
    assert.ok(!names.some(n => ` ${normalize(m)} `.includes(` ${n} `)), m);
  }
  // The wrong event carries points and the lost streak only: no id of what was clicked.
  const r = newRound(ids(2), 0), g = guess(r, 'FRA', 1000);
  assert.deepEqual(Object.keys(answerEvent(r, g.round, g.outcome)!).sort(), ['kind', 'lostStreak', 'nextPoints']);
});
