// Records of a country's region challenges, for Explore and Progress. Pure: built from the subdivision records store and
// the country's index entry alone, so nothing needs to load the country's geometry. Keys come from stable ids and the
// scoring version (subdivisionKey), never from names. See docs/subdivisions.md, Phase 4.
import { subdivisionKey, subdivisionKinds, SPRINT_SIZE, type ChallengeKind, type GameMode } from './challenges.ts';
import { maxScoreFor } from './scoring.ts';
import type { Performance, PerformanceStore } from './records.ts';

export type RegionRecord = {
  mode: GameMode; kind: ChallengeKind;
  key: string;                       // the records key of the challenge's current version
  size: number;                      // questions in a run
  maxScore: number;
  performance?: Performance;         // missing when never completed
};

// Every challenge a country offers (Sprint only with 10 or more regions), each with its record if any.
export function regionRecords(store: PerformanceStore, countryId: string, meta: { count: number; unitsVersion: string }): RegionRecord[] {
  return (['find', 'name'] as const).flatMap(mode => subdivisionKinds(meta.count).map(kind => {
    const key = subdivisionKey(countryId, mode, kind, meta.unitsVersion), size = kind === 'sprint' ? SPRINT_SIZE : meta.count;
    return { mode, kind, key, size, maxScore: maxScoreFor(size), performance: store[key] };
  }));
}

// A record's completion status, in words.
export function statusOf(r: RegionRecord): string {
  const p = r.performance;
  if (!p) return 'Not played yet';
  const runs = `Completed ${p.runs} ${p.runs === 1 ? 'time' : 'times'}`;
  return p.perfectRuns ? `${runs} · ${p.perfectRuns} perfect` : runs;
}

// How many of a country's challenges have been completed at least once: "2 of 4 challenges completed".
export const completedCount = (rows: RegionRecord[]) => rows.filter(r => r.performance).length;
