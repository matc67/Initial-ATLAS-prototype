// Run with `npm test` (Node's built-in test runner; no extra dependencies).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareRuns, formatTime, guess, newRound, next, pause, pointsFor, resume, reveal, reviewOf, statsOf, typedGuess,
  type Round,
} from './scoring.ts';

const Q = ['SDN', 'TCD', 'NER', 'BEN'];
// Plays a list of clicks, 1 second apart so none counts as a repeat of the previous click.
function play(clicks: string[], r: Round = newRound(Q, 0), t0 = 1000): Round {
  return clicks.reduce((round, id, i) => guess(round, id, t0 + i * 1000).round, r);
}

test('points by attempt: 100, 50, 25, then 10; Show me 0', () => {
  assert.deepEqual([0, 1, 2, 3, 7].map(m => pointsFor(m, false)), [100, 50, 25, 10, 10]);
  assert.equal(pointsFor(0, true), 0);
  assert.equal(statsOf(play(['SDN']), 2000).score, 100);
  assert.equal(statsOf(play(['TCD', 'SDN']), 3000).score, 50);
  assert.equal(statsOf(play(['TCD', 'NER', 'SDN']), 4000).score, 25);
  assert.equal(statsOf(play(['TCD', 'NER', 'BEN', 'TCD', 'SDN']), 6000).score, 10);
});

test('the Sudan example: 2 mistakes, 1 country missed, 25 points, streak reset', () => {
  const r = play(['TCD', 'NER', 'SDN']);
  const s = statsOf(r, 5000);
  assert.equal(s.totalMistakes, 2);
  assert.equal(s.countriesMissed, 1);
  assert.equal(s.firstTryCorrect, 0);
  assert.equal(s.score, 25);
  assert.equal(r.streak, 0);
  assert.deepEqual(r.answers[0].wrongIds, ['TCD', 'NER']);
});

test('several mistakes on one country count as one missed country', () => {
  const s = statsOf(play(['TCD', 'NER', 'BEN', 'SDN', 'TCD']), 9000);
  assert.equal(s.totalMistakes, 3);
  assert.equal(s.countriesMissed, 1);
  assert.equal(s.firstTryCorrect, 1); // TCD, the second question, was found first try
});

test('first-try accuracy, with a placeholder before anything is completed', () => {
  assert.equal(statsOf(newRound(Q, 0), 0).accuracy, null);
  const s = statsOf(play(['SDN', 'NER', 'TCD', 'NER', 'BEN']), 9000);
  assert.equal(s.completed, 4);
  assert.equal(s.firstTryCorrect, 3);
  assert.equal(s.accuracy, 75);
});

test('a wrong guess resets the streak at once; first-try answers build it; the longest is kept', () => {
  let r = play(['SDN', 'TCD']);
  assert.equal(r.streak, 2);
  r = guess(r, 'BEN', 10_000).round; // wrong, on NER
  assert.equal(r.streak, 0);
  assert.equal(r.best, 2);
  r = guess(r, 'NER', 11_000).round; // correct after a mistake: no streak
  assert.equal(r.streak, 0);
  r = guess(r, 'BEN', 12_000).round;
  assert.equal(r.streak, 1);
  assert.equal(r.best, 2);
});

test('completed countries, repeated clicks and paused rounds are ignored', () => {
  let r = play(['SDN']); // SDN completed, now asking TCD
  const before = statsOf(r, 3000).totalMistakes;
  assert.equal(guess(r, 'SDN', 5000).outcome, 'ignored');
  // The same wrong country clicked twice within 300 ms is one mistake; clicked again later it is a second one.
  r = guess(r, 'NER', 6000).round;
  assert.equal(guess(r, 'NER', 6100).outcome, 'ignored');
  r = guess(r, 'NER', 6100).round;
  assert.equal(statsOf(r, 7000).totalMistakes, before + 1);
  r = guess(r, 'NER', 7000).round;
  assert.equal(statsOf(r, 8000).totalMistakes, before + 2);
  // While paused nothing counts.
  const p = pause(r, 9000);
  assert.equal(guess(p, 'TCD', 9500).outcome, 'ignored');
});

test('a double-click on the right country awards points once and is no mistake on the next question', () => {
  let r = newRound(Q, 0);
  r = guess(r, 'SDN', 1000).round;
  const second = guess(r, 'SDN', 1080);
  assert.equal(second.outcome, 'ignored');
  const s = statsOf(second.round, 2000);
  assert.equal(s.score, 100);
  assert.equal(s.totalMistakes, 0);
  assert.equal(second.round.index, 1);
});

test('Show me: 0 points, streak reset, not first try, listed for review, not a mistake', () => {
  let r = play(['SDN']);
  r = guess(r, 'NER', 5000).round; // one wrong guess on TCD
  r = reveal(r, 6000);
  assert.equal(r.phase, 'revealed');
  assert.equal(r.streak, 0);
  r = next(r, 7000);
  const s = statsOf(r, 7000);
  assert.equal(s.score, 100);
  assert.equal(s.hintsUsed, 1);
  assert.equal(s.totalMistakes, 1);
  assert.equal(s.countriesMissed, 1);
  assert.deepEqual(reviewOf(r).map(a => [a.id, a.hint, a.points]), [['TCD', true, 0]]);
  // Show me before any guess counts no mistake.
  const early = reveal(newRound(Q, 0), 500);
  assert.equal(statsOf(early, 600).totalMistakes, 0);
});

test('the timer counts only running time and does not change points', () => {
  let r = newRound(Q, 0);
  r = pause(r, 10_000);           // 10 s played
  r = resume(r, 70_000);          // 60 s away
  r = guess(r, 'SDN', 75_000).round;
  assert.equal(statsOf(r, 80_000).elapsedMs, 20_000);
  assert.equal(statsOf(r, 80_000).score, 100);
  const slow = guess(newRound(Q, 0), 'SDN', 500_000).round;
  assert.equal(statsOf(slow, 500_000).score, 100);
});

test('the clock stops when the last country is found', () => {
  const r = play(['SDN', 'TCD', 'NER', 'BEN']);
  assert.equal(r.phase, 'done');
  assert.equal(statsOf(r, 4000).elapsedMs, statsOf(r, 999_000).elapsedMs);
});

test('perfect runs need every country first try, no mistakes and no Show me', () => {
  assert.equal(statsOf(play(['SDN', 'TCD', 'NER', 'BEN']), 9000).perfect, true);
  assert.equal(statsOf(play(['SDN', 'TCD', 'BEN', 'NER', 'BEN']), 9000).perfect, false);
  let r = play(['SDN', 'TCD', 'NER']);
  r = next(reveal(r, 8000), 8000);
  assert.equal(r.phase, 'done');
  assert.equal(statsOf(r, 9000).perfect, false);
});

test('a new round starts from zero', () => {
  const s = statsOf(newRound(Q, 50_000), 60_000);
  assert.deepEqual([s.score, s.completed, s.totalMistakes, s.longestStreak, s.elapsedMs], [0, 0, 0, 0, 10_000]);
});

test('Name it: wrong typed answers are mistakes; the right one completes the country', () => {
  let r = newRound(Q, 0);
  r = typedGuess(r, 'Chad', false, 1000).round;
  r = typedGuess(r, 'Sudan', true, 2000).round;
  const s = statsOf(r, 3000);
  assert.equal(s.score, 50);
  assert.equal(s.totalMistakes, 1);
  assert.equal(r.index, 1);
});

test('runs rank by accuracy, then score, then fewer mistakes, then time', () => {
  const run = (o: Partial<Parameters<typeof compareRuns>[0]>) => ({ score: 400, maxScore: 400, accuracy: 100, mistakes: 0, ms: 90_000, streak: 4, perfect: true, ...o });
  // A fast but less accurate run never outranks a more accurate one.
  assert.ok(compareRuns(run({}), run({ accuracy: 75, score: 350, mistakes: 1, ms: 20_000 })) > 0);
  assert.ok(compareRuns(run({ accuracy: 75, score: 300 }), run({ accuracy: 75, score: 250, ms: 1000 })) > 0);
  assert.ok(compareRuns(run({ accuracy: 75, score: 300, mistakes: 1 }), run({ accuracy: 75, score: 300, mistakes: 3, ms: 1000 })) > 0);
  // Equal on everything else: the faster run ranks higher.
  assert.ok(compareRuns(run({ ms: 20 * 60_000 }), run({ ms: 25 * 60_000 })) > 0);
  assert.equal(compareRuns(run({}), run({})), 0);
});

test('time format', () => {
  assert.deepEqual([42_000, 272_000, 1_127_000, 14_709_000].map(formatTime), ['0:42', '4:32', '18:47', '4:05:09']);
});
