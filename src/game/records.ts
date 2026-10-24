// Completed runs and personal records, per challenge, kept in this browser. Pure functions first, then storage.
// Only completed full challenges are recorded: a quick round or an abandoned run never touches these records.
import { compareRuns, elapsed, isFirstTry, MAX_POINTS, type Attempt, type NewBests, type Round, type RunRecord } from './scoring.ts';
import { countryChallenge, type GameMode, type GeographyChallenge } from './challenges.ts';
import type { Area, CountrySet } from '../data/countries.ts';

// One completed run. Everything else (score, accuracy, streak…) is derived from `results`, which are in the order asked.
export type GameRun = {
  id: string;
  challengeId: string;
  version: string;          // the challenge version it was played against
  completedAt: string;      // ISO date
  activeTimeMs: number;
  results: Attempt[];       // one per country: points, mistakes, the wrong guesses, Show me
};
// A run's headline numbers, kept for history and charts even after the full run is dropped.
// `hints` is unknown (absent) only for a best run carried over from version 1 records.
export type RunSummary = RunRecord & { runId: string; at: string; missed: number; hints?: number };

export type Performance = {
  challengeId: string; version: string;
  runs: number; perfectRuns: number;
  bestScore: number; bestAccuracy: number; fewestMistakes: number; fastestMs: number; longestStreak: number;
  best: RunSummary;             // the best run by rank: accuracy, then score, then fewer mistakes, then faster
  latest?: RunSummary;
  // Full runs, for the Progress globe. Missing for records carried over from before per-country results were saved.
  bestRun?: GameRun; latestRun?: GameRun;
  history: RunSummary[];        // newest first, up to HISTORY_LIMIT
  // Running totals over every run counted so far, for all-time stats that the capped history cannot give. Added in
  // v0.2.2: older records start from their history (see totalsOf), so `runs` can be lower than the record's run count.
  totals?: Totals;
};
export type Totals = { runs: number; answered: number; firstTry: number };
export const HISTORY_LIMIT = 30;
export type PerformanceStore = { [key: string]: Performance };
// Records are kept per challenge *version*: if the country list changes, older records stay but are not compared.
export const perfKey = (c: Pick<GeographyChallenge, 'id' | 'version'>) => `${c.id}@${c.version}`;

export function longestStreak(results: Attempt[]): number {
  let best = 0, run = 0;
  for (const a of results) { run = isFirstTry(a) ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

export function summarize(run: GameRun): RunSummary {
  const r = run.results, first = r.filter(isFirstTry).length, mistakes = r.reduce((n, a) => n + a.mistakes, 0), hints = r.filter(a => a.hint).length;
  return {
    runId: run.id, at: run.completedAt,
    score: r.reduce((n, a) => n + a.points, 0), maxScore: r.length * MAX_POINTS,
    accuracy: r.length ? (first / r.length) * 100 : 0, mistakes, missed: r.length - first, hints,
    ms: run.activeTimeMs, streak: longestStreak(r), perfect: r.length > 0 && first === r.length && mistakes === 0 && hints === 0,
  };
}

const NO_TOTALS: Totals = { runs: 0, answered: 0, firstTry: 0 };
const answeredIn = (s: RunSummary) => Math.round(s.maxScore / MAX_POINTS);
const addTotals = (t: Totals, s: RunSummary): Totals => ({ runs: t.runs + 1, answered: t.answered + answeredIn(s), firstTry: t.firstTry + answeredIn(s) - s.missed });
// A record's totals: kept since v0.2.2, or rebuilt from the runs its history still holds. Runs older than the history
// (and records carried over from v1, which kept no runs) are not counted, and `runs` says how many were.
export const totalsOf = (p: Performance): Totals => p.totals ?? p.history.reduce(addTotals, NO_TOTALS);

// Folds a completed run into its challenge's record. Each best is kept separately, so the fastest time can come from a
// different run than the best score.
export function addRun(prev: Performance | undefined, run: GameRun): { performance: Performance; bests: NewBests } {
  const s = summarize(run);
  if (!prev) return {
    performance: {
      challengeId: run.challengeId, version: run.version, runs: 1, perfectRuns: s.perfect ? 1 : 0,
      bestScore: s.score, bestAccuracy: s.accuracy, fewestMistakes: s.mistakes, fastestMs: s.ms, longestStreak: s.streak,
      best: s, latest: s, bestRun: run, latestRun: run, history: [s], totals: addTotals(NO_TOTALS, s),
    },
    bests: { score: true, accuracy: true, mistakes: true, time: true, streak: true, run: true },
  };
  const bests: NewBests = {
    score: s.score > prev.bestScore, accuracy: s.accuracy > prev.bestAccuracy, mistakes: s.mistakes < prev.fewestMistakes,
    time: s.ms < prev.fastestMs, streak: s.streak > prev.longestStreak, run: compareRuns(s, prev.best) > 0,
  };
  return {
    performance: {
      ...prev, runs: prev.runs + 1, perfectRuns: prev.perfectRuns + (s.perfect ? 1 : 0),
      bestScore: Math.max(prev.bestScore, s.score), bestAccuracy: Math.max(prev.bestAccuracy, s.accuracy),
      fewestMistakes: Math.min(prev.fewestMistakes, s.mistakes), fastestMs: Math.min(prev.fastestMs, s.ms),
      longestStreak: Math.max(prev.longestStreak, s.streak),
      best: bests.run ? s : prev.best, bestRun: bests.run ? run : prev.bestRun,
      latest: s, latestRun: run, history: [s, ...prev.history].slice(0, HISTORY_LIMIT), totals: addTotals(totalsOf(prev), s),
    },
    bests,
  };
}

const newRunId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const toGameRun = (r: Round, c: GeographyChallenge, now: number, at = new Date().toISOString()): GameRun =>
  ({ id: newRunId(), challengeId: c.id, version: c.version, completedAt: at, activeTimeMs: elapsed(r.clock, now), results: r.answers });

// ---- Storage --------------------------------------------------------------------------------------------------------------
const KEY = 'atlas-performance-v2';
const LEGACY_RECORDS = 'atlas-records-v1';
// The old per-country mastery counts ('atlas-progress-v2') are left in storage untouched and are not read: one first-try
// answer is not proof of knowing a country, so they are not turned into performance records.

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

// Loads the store, carrying over records saved by the previous version (one aggregate per "set|mode|area", no runs).
export function loadPerformance(from: Storage | null = storage()): PerformanceStore {
  if (!from) return {};
  try {
    const raw = from.getItem(KEY);
    if (raw) return validStore(JSON.parse(raw));
    const legacy = JSON.parse(from.getItem(LEGACY_RECORDS) || '{}');
    return migrateRecordsV1(legacy);
  } catch { return {}; }
}

export function savePerformance(store: PerformanceStore, to: Storage | null = storage()) {
  try { to?.setItem(KEY, JSON.stringify(store)); } catch { /* storage blocked or full: records last for this visit only */ }
}

// Drops entries that do not look like records (hand-edited or corrupted storage) instead of failing on them later.
function validStore(v: unknown): PerformanceStore {
  if (!v || typeof v !== 'object') return {};
  const ok = (p: Partial<Performance>) => typeof p.challengeId === 'string' && typeof p.runs === 'number' && !!p.best && typeof p.best.score === 'number' && Array.isArray(p.history);
  return Object.fromEntries(Object.entries(v as PerformanceStore).filter(([, p]) => p && ok(p)));
}

type LegacyRecords = { runs: number; perfectRuns: number; bestScore: number; bestAccuracy: number; fewestMistakes: number; fastestMs: number; longestStreak: number; best: RunRecord; at: string };
// Version 1 records were saved only for completed full challenges, so their numbers are real results and are kept. They
// stored no per-country results or run list, so the Progress globe and run history start with the next run.
export function migrateRecordsV1(old: { [key: string]: LegacyRecords }): PerformanceStore {
  const out: PerformanceStore = {};
  for (const [key, r] of Object.entries(old ?? {})) {
    const [set, mode, area] = key.split('|');
    if (!r?.best || typeof r.runs !== 'number' || !['200', '195'].includes(set) || !['find', 'name'].includes(mode)) continue;
    const c = countryChallenge(area as Area, set as CountrySet, mode as GameMode);
    if (!c.targetIds.length) continue;
    out[perfKey(c)] = {
      challengeId: c.id, version: c.version, runs: r.runs, perfectRuns: r.perfectRuns,
      bestScore: r.bestScore, bestAccuracy: r.bestAccuracy, fewestMistakes: r.fewestMistakes, fastestMs: r.fastestMs, longestStreak: r.longestStreak,
      best: { ...r.best, runId: 'legacy', at: r.at, missed: Math.round(c.targetIds.length * (1 - r.best.accuracy / 100)) }, history: [],
    };
  }
  return out;
}
