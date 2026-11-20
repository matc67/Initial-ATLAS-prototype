// Cities You Missed: what each completed City Rush teaches for the next one. Pure rules first, then storage.
//
//   missed       after a completed run, the five largest cities that could have been named and were not
//   learned      in a later run (same country and mode), naming one of those five: a quiet "Learned!" and nothing more.
//                No bonus: the city scores exactly what it always scores.
//   improvement  this run against the previous completed one: coverage, remembered cities and the people they brought
//
// Only completed runs count: a timed run that ran out or was finished early, or a City Explorer map the player finished.
// An abandoned or restarted run changes nothing here. Saved by stable city id, never by name, and checked against the
// current data before use.
import { awards, type CityBook } from './cityMatch.ts';
import { coverageOf, type RushMode } from './cityRush.ts';

export const MISSED_COUNT = 5;
const idNum = (id: string) => Number(id.slice(3)) || 0;

// The cities a missed list may name: those a guess can claim, with a population, that are not listed inside a larger
// city (Brooklyn's people are New York City's), and that would still add people now.
export function missedCities(book: CityBook, found: string[], n = MISSED_COUNT): string[] {
  const got = new Set(found);
  const base = awards(book, found).reduce((a, b) => a + b, 0);
  const adds = (id: string) => awards(book, [...found, id]).reduce((a, b) => a + b, 0) - base;
  return [...book.reachable]
    .map(id => book.cities.get(id)!)
    .filter(c => !got.has(c.id) && c.population > 0 && !(c.partOf && book.cities.has(c.partOf)))
    .sort((a, b) => b.population - a.population || idNum(a.id) - idNum(b.id))
    .filter(c => !book.parts.has(c.id) || adds(c.id) > 0)
    .slice(0, n)
    .map(c => c.id);
}

// The last completed run of one country in one mode.
export type LastRun = {
  country: string; mode: RushMode; version: string;
  durationMs: number | null;  // timed runs: their duration (each has its own history); City Explorer: null
  runId: string;              // the run's start time: a run is recorded once, even if its end is noticed twice
  people: number; total: number; cities: number;
  missed: string[];           // up to five city ids, largest first
  at: string;
};
// One history per country and mode, and per duration for timed runs: "CAN:timed-600", "CAN:explorer".
export const learningKey = (country: string, durationMs: number | null) =>
  `${country}:${durationMs === null ? 'explorer' : `timed-${Math.round(durationMs / 1000)}`}`;

// The previous run's missed cities that the current data still has and can score, as a set.
export const missedBefore = (prev: LastRun | undefined, book: CityBook): Set<string> =>
  new Set((prev?.missed ?? []).filter(id => book.reachable.has(id)));

export type Improvement = {
  current: number;                // coverage, percent
  previous: number | null;        // null when the data changed since (another denominator: not comparable)
  delta: number | null;           // percentage points
  remembered: number; of: number; // previously missed cities named this time, of those still in the data
  recovered: number;              // the people those cities added this time
};
// This run against the previous completed one. Null when there is none.
export function improvementOf(prev: LastRun | undefined, book: CityBook, version: string, found: string[]): Improvement | null {
  if (!prev) return null;
  const before = missedBefore(prev, book), gains = awards(book, found);
  const current = coverageOf(gains.reduce((a, b) => a + b, 0), book.total);
  const comparable = prev.version === version && prev.total === book.total;
  const previous = comparable ? coverageOf(prev.people, prev.total) : null;
  let remembered = 0, recovered = 0;
  found.forEach((id, i) => { if (before.has(id)) { remembered++; recovered += gains[i]; } });
  return { current, previous, delta: previous === null ? null : current - previous, remembered, of: before.size, recovered };
}

// The record a completed run leaves for the next one.
export function lastRunOf(r: { country: string; mode: RushMode; version: string; durationMs: number | null; startedAt: number; found: string[] }, book: CityBook, at = new Date().toISOString()): LastRun {
  return {
    country: r.country, mode: r.mode, version: r.version, durationMs: r.mode === 'timed' ? r.durationMs : null, runId: String(r.startedAt),
    people: awards(book, r.found).reduce((a, b) => a + b, 0), total: book.total, cities: r.found.length,
    missed: missedCities(book, r.found), at,
  };
}

// "+9.3 points", "−3.1 points", "no change": neutral either way.
export function formatDelta(points: number): string {
  const r = Math.round(points * 10) / 10;
  if (r === 0) return 'no change';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} point${Math.abs(r) === 1 ? '' : 's'}`;
}

// ---- Storage --------------------------------------------------------------------------------------------------------------
export const LEARNING_KEY = 'atlas-city-rush-learning-v1';
export type LearningStore = { [key: string]: LastRun };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validLastRun(v: unknown): LastRun | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<LastRun>;
  if (typeof r.country !== 'string' || !/^[A-Z]{3}$/.test(r.country) || (r.mode !== 'timed' && r.mode !== 'explorer')
    || typeof r.version !== 'string' || typeof r.runId !== 'string' || !isNum(r.people) || !isNum(r.total) || !isNum(r.cities)
    || !Array.isArray(r.missed)) return null;
  const missed = [...new Set(r.missed.filter((x): x is string => typeof x === 'string' && /^gn:\d+$/.test(x)))].slice(0, MISSED_COUNT);
  // Before durations, every timed run was 5 minutes: an entry without one is a Classic Rush.
  const durationMs = r.mode === 'explorer' ? null : isNum(r.durationMs) && r.durationMs > 0 ? r.durationMs : 300_000;
  return { country: r.country, mode: r.mode, version: r.version, durationMs, runId: r.runId, people: Math.max(0, r.people), total: Math.max(0, r.total), cities: Math.max(0, r.cities), missed, at: typeof r.at === 'string' ? r.at : '' };
}
export function loadLearning(from: Storage | null = storage()): LearningStore {
  let v: unknown = null;
  try { v = JSON.parse(from?.getItem(LEARNING_KEY) || 'null'); } catch { return {}; }
  if (!v || typeof v !== 'object') return {};
  const out: LearningStore = {};
  // Keyed by what the entry says, so an entry saved before durations ("CAN:timed") is kept as Classic Rush's.
  for (const r of Object.values(v)) { const ok = validLastRun(r); if (ok) out[learningKey(ok.country, ok.durationMs)] = ok; }
  return out;
}
export function saveLearning(s: LearningStore, to: Storage | null = storage()) {
  try { to?.setItem(LEARNING_KEY, JSON.stringify(s)); } catch { /* kept for this visit */ }
}
export const withLastRun = (s: LearningStore, r: LastRun): LearningStore => ({ ...s, [learningKey(r.country, r.durationMs)]: r });
