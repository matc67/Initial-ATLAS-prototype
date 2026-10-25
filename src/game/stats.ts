// Player stats for the Progress screen, worked out from the stored records only: nothing is estimated or made up.
// All-time totals count every completed run in every challenge; records compare runs of one challenge (same area,
// country set, mode, kind and challenge version) only.
import { AREAS, type Area, type CountrySet } from '../data/countries.ts';
import { countryChallenge, sprintChallenge, type ChallengeKind, type GameMode } from './challenges.ts';
import { countriesIn, perfKey, totalsOf, type Performance, type PerformanceStore, type RunSummary } from './records.ts';

export type ChallengeRef = { area: Area; set: CountrySet; mode: GameMode; kind: ChallengeKind; id: string; key: string };

// Every challenge the game offers, with the storage key of its current version.
export const CATALOG: ChallengeRef[] = AREAS.flatMap(area => (['200', '195'] as const).flatMap(set => (['find', 'name'] as const).flatMap(mode =>
  (['sprint', 'full'] as const).map(kind => {
    const c = kind === 'sprint' ? sprintChallenge(area, set, mode) : countryChallenge(area, set, mode);
    return { area, set, mode, kind, id: c.id, key: perfKey(c) };
  }))));
const BY_ID = new Map(CATALOG.map(c => [c.id, c]));
export const refOf = (p: Performance) => BY_ID.get(p.challengeId);
// Whether a record was made under the current rules (country list and scoring). Older records stay readable and count
// towards all-time totals, but their scores are not compared with current ones.
export const isCurrent = (p: Performance) => refOf(p)?.key === perfKey({ id: p.challengeId, version: p.version });

export type Overview = {
  games: number; sprints: number; perfect: number;
  bestSprintScore: number | null; bestStreak: number | null;
  countriesAnswered: number;
  accuracy: number | null;     // first-try accuracy over `accuracyRuns` runs (all runs whose answers are on record)
  accuracyRuns: number;
};

export function overview(store: PerformanceStore): Overview {
  const all = Object.values(store);
  const sprints = all.filter(p => refOf(p)?.kind === 'sprint');
  const currentSprints = sprints.filter(isCurrent);
  const totals = all.map(totalsOf);
  const answered = totals.reduce((n, t) => n + t.answered, 0);
  return {
    games: all.reduce((n, p) => n + p.runs, 0),
    sprints: sprints.reduce((n, p) => n + p.runs, 0),
    perfect: all.reduce((n, p) => n + p.perfectRuns, 0),
    bestSprintScore: currentSprints.length ? Math.max(...currentSprints.map(p => p.bestScore)) : null,
    bestStreak: all.length ? Math.max(...all.map(p => p.longestStreak)) : null,
    // Every completed run answers every country in it, and all runs of one record have the same size.
    countriesAnswered: all.reduce((n, p) => n + p.runs * countriesIn(p.best), 0),
    accuracy: answered ? (totals.reduce((n, t) => n + t.firstTry, 0) / answered) * 100 : null,
    accuracyRuns: totals.reduce((n, t) => n + t.runs, 0),
  };
}

// The record for each area under one filter, in the order of AREAS; `performance` is missing where nothing was played.
export type RecordFilter = { kind: ChallengeKind; mode: GameMode; set: CountrySet };
export function recordsFor(store: PerformanceStore, f: RecordFilter): { ref: ChallengeRef; performance?: Performance }[] {
  return CATALOG.filter(c => c.kind === f.kind && c.mode === f.mode && c.set === f.set).map(ref => ({ ref, performance: store[ref.key] }));
}

// Recent Sprints across every area and mode, newest first, each with the best of its own challenge to compare with.
// `earlier` marks a run from a record made under earlier rules (before streak bonuses), so it is not read as a current score.
export type RecentRun = { ref: ChallengeRef; run: RunSummary; best: RunSummary; isBest: boolean; earlier: boolean };
export function recentSprints(store: PerformanceStore, limit = 12): RecentRun[] {
  return Object.values(store)
    .flatMap(p => { const ref = refOf(p); return ref?.kind === 'sprint' ? p.history.map(run => ({ ref, run, best: p.best, isBest: run.runId === p.best.runId, earlier: !isCurrent(p) })) : []; })
    .sort((a, b) => b.run.at.localeCompare(a.run.at))
    .slice(0, limit);
}
