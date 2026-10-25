// 10-Country Sprint: 10 countries, one clock, one score to beat. The round itself uses the normal rules (scoring.ts);
// this module only draws the ten and compares a finished run with the player's previous bests. Pure, so it is tested.
import { SPRINT_SIZE } from './challenges.ts';
import type { Performance, RunSummary } from './records.ts';
import { pickRound } from './round.ts';
import type { NewBests } from './scoring.ts';

// A Sprint is always exactly SPRINT_SIZE countries. A pool too small for that is reported, never shortened, so every
// Sprint record means the same thing.
export type SprintPlan = { ok: true; queue: string[] } | { ok: false; available: number };
export function planSprint(pool: string[], random: () => number = Math.random): SprintPlan {
  const unique = [...new Set(pool)];
  return unique.length < SPRINT_SIZE ? { ok: false, available: unique.length } : { ok: true, queue: pickRound(unique, SPRINT_SIZE, random) };
}

// The bests a finished run is compared with: the record as it stood before this run, or null for the first run.
export type PersonalBests = { score: number; accuracy: number; fastestMs: number; longestStreak: number; fewestMistakes: number; runs: number };
export const bestsOf = (p: Performance | undefined): PersonalBests | null =>
  p ? { score: p.bestScore, accuracy: p.bestAccuracy, fastestMs: p.fastestMs, longestStreak: p.longestStreak, fewestMistakes: p.fewestMistakes, runs: p.runs } : null;

// Whether a finished run set a new personal record: the best run by rank, or a higher score. Never on a first run (that
// is a first record). The results banner and the victory sound both use this, so they always agree, and it is one
// answer however many stats improved, so there is only ever one celebration.
export const isNewRecord = (before: PersonalBests | null, bests: NewBests | null) => before !== null && !!bests && (bests.run || bests.score);

// One line of the results comparison. `better` is true when this run beat the previous best (never on a first run,
// which is a first record instead); `delta` is this run minus the previous best, in the stat's own unit.
export type Comparison = { stat: 'score' | 'accuracy' | 'time' | 'streak' | 'mistakes'; value: number; best: number | null; better: boolean; delta: number | null };
export function compareWithBests(run: Pick<RunSummary, 'score' | 'accuracy' | 'ms' | 'streak' | 'mistakes'>, before: PersonalBests | null): Comparison[] {
  const row = (stat: Comparison['stat'], value: number, best: number | undefined, higherIsBetter: boolean): Comparison => ({
    stat, value, best: best ?? null,
    better: best !== undefined && (higherIsBetter ? value > best : value < best),
    delta: best === undefined ? null : value - best,
  });
  return [
    row('score', run.score, before?.score, true),
    row('accuracy', run.accuracy, before?.accuracy, true),
    row('time', run.ms, before?.fastestMs, false),
    row('streak', run.streak, before?.longestStreak, true),
    row('mistakes', run.mistakes, before?.fewestMistakes, false),
  ];
}
