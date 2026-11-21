// City Rush records and saved progress, kept in this browser. Pure functions first, then storage. Every load checks what
// it reads and drops anything that does not look right (hand-edited, corrupted or from an older format), never failing.
//
//   bests     one record per country, duration and data version: the most people found in one timed run (more cities
//             breaks a tie). Coverage follows from it: the denominator is fixed by the data version.
//   explorer  per country: the cities found so far, so City Explorer carries on where the player left it.
//   active    the timed run in progress (at most one), so a refresh resumes it with the same deadline, never a new one.
import { DEFAULT_DURATION, elapsedMs, inMenu, isDuration, type Duration, type Rush } from './cityRush.ts';

export type TimedRecord = {
  country: string; durationMs: number; version: string;
  total: number;            // the people that can be found (the coverage denominator) in this version
  runs: number;
  best: number; bestCities: number; bestAt: string;        // people
  latest: number; latestCities: number; latestAt: string;
  history: number[];        // people per run, newest first, up to HISTORY_LIMIT
};
export const HISTORY_LIMIT = 20;
export type TimedStore = { [key: string]: TimedRecord };
// Records are kept per data version: if a country's city list changes, older records stay but are not compared.
export const timedKey = (country: string, durationMs: number, version: string) => `${country}:${Math.round(durationMs / 1000)}@${version}`;

export type TimedResult = { record: TimedRecord; first: boolean; newBest: boolean; before: number | null };
// `people` is the run's score (cityMatch.awards summed) and `total` the country's findable population.
export function addTimedRun(prev: TimedRecord | undefined, r: Rush, people: number, total: number, at = new Date().toISOString()): TimedResult {
  if (r.durationMs === null) throw new Error('addTimedRun: not a timed run');
  const n = r.found.length;
  if (!prev) return {
    record: {
      country: r.country, durationMs: r.durationMs, version: r.version, total, runs: 1,
      best: people, bestCities: n, bestAt: at, latest: people, latestCities: n, latestAt: at, history: [people],
    },
    first: true, newBest: false, before: null,
  };
  const newBest = people > prev.best || (people === prev.best && n > prev.bestCities);
  return {
    record: {
      ...prev, total, runs: prev.runs + 1, latest: people, latestCities: n, latestAt: at, history: [people, ...prev.history].slice(0, HISTORY_LIMIT),
      ...(newBest ? { best: people, bestCities: n, bestAt: at } : {}),
    },
    first: false, newBest, before: prev.best,
  };
}

// ---- Saved runs ---------------------------------------------------------------------------------------------------------------
export type SavedRun = { country: string; version: string; startedAt: number; durationMs: number | null; ms: number; found: string[]; foundAt: number[]; updatedAt: number };
export const toSaved = (r: Rush, now: number): SavedRun =>
  ({ country: r.country, version: r.version, startedAt: r.startedAt, durationMs: r.durationMs, ms: elapsedMs(r, now), found: r.found, foundAt: r.foundAt, updatedAt: now });

// A saved run back as a Rush, keeping only the cities the country's current data can still score (an older data version
// may have dropped some). `valid` is the set of reachable city ids (CityBook.reachable).
export function restoreRun(s: SavedRun, valid: Set<string>, version: string, now: number): Rush {
  const keep = s.found.map((k, i) => [k, s.foundAt[i] ?? 0] as const).filter(([k]) => valid.has(k));
  const seen = new Set<string>(), found: string[] = [], foundAt: number[] = [];
  for (const [k, t] of keep) if (!seen.has(k)) { seen.add(k); found.push(k); foundAt.push(t); }
  const timed = s.durationMs !== null;
  return {
    country: s.country, version, mode: timed ? 'timed' : 'explorer', durationMs: s.durationMs, startedAt: s.startedAt,
    // A timed run's clock is its deadline; an explorer run picks up its active time and starts counting again now.
    clock: timed ? { accumulated: 0, since: s.startedAt } : { accumulated: s.ms, since: now },
    found, foundAt, phase: 'playing', endedAt: null,
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
export function validSaved(v: unknown): SavedRun | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<SavedRun>;
  if (typeof s.country !== 'string' || !/^[A-Z]{3}$/.test(s.country) || typeof s.version !== 'string' || !isNum(s.startedAt) || !isNum(s.ms)
    || !(s.durationMs === null || (isNum(s.durationMs) && s.durationMs > 0)) || !isStrings(s.found)) return null;
  const foundAt = Array.isArray(s.foundAt) ? s.foundAt.map(x => (isNum(x) ? Math.max(0, x) : 0)) : s.found.map(() => 0);
  return { country: s.country, version: s.version, startedAt: s.startedAt, durationMs: s.durationMs, ms: Math.max(0, s.ms), found: s.found, foundAt, updatedAt: isNum(s.updatedAt) ? s.updatedAt : s.startedAt };
}
function validTimedStore(v: unknown): TimedStore {
  if (!v || typeof v !== 'object') return {};
  const ok = (r: Partial<TimedRecord>) => !!r && typeof r.country === 'string' && isNum(r.durationMs) && typeof r.version === 'string'
    && isNum(r.total) && isNum(r.runs) && isNum(r.best) && isNum(r.bestCities) && isNum(r.latest) && isNum(r.latestCities) && Array.isArray(r.history);
  return Object.fromEntries(Object.entries(v as TimedStore).filter(([, r]) => ok(r)));
}

// ---- Storage --------------------------------------------------------------------------------------------------------------------
// v2: runs store city ids and records store people (v1, never released, stored names and city counts).
export const BESTS_KEY = 'atlas-city-rush-bests-v2';
export const EXPLORER_KEY = 'atlas-city-rush-explorer-v2';
export const ACTIVE_KEY = 'atlas-city-rush-active-v2';
export type ExplorerStore = { last: string | null; countries: { [country: string]: SavedRun } };

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (from: Storage | null, key: string): unknown => { try { return JSON.parse(from?.getItem(key) || 'null'); } catch { return null; } };
const write = (to: Storage | null, key: string, v: unknown) => { try { if (v === null) to?.removeItem(key); else to?.setItem(key, JSON.stringify(v)); } catch { /* storage blocked or full: kept for this visit */ } };

export const loadTimedStore = (from: Storage | null = storage()): TimedStore => validTimedStore(read(from, BESTS_KEY));
export const saveTimedStore = (s: TimedStore, to: Storage | null = storage()) => write(to, BESTS_KEY, s);

export function loadExplorer(from: Storage | null = storage()): ExplorerStore {
  const v = read(from, EXPLORER_KEY) as Partial<ExplorerStore> | null;
  const countries: ExplorerStore['countries'] = {};
  if (v?.countries && typeof v.countries === 'object') for (const [id, s] of Object.entries(v.countries)) {
    const ok = validSaved(s);
    if (ok && ok.country === id && ok.durationMs === null) countries[id] = ok;
  }
  return { last: typeof v?.last === 'string' && countries[v.last] ? v.last : null, countries };
}
export const saveExplorer = (s: ExplorerStore, to: Storage | null = storage()) => write(to, EXPLORER_KEY, s);
export const withExplorerRun = (s: ExplorerStore, run: SavedRun): ExplorerStore => ({ last: run.country, countries: { ...s.countries, [run.country]: run } });
export function withoutExplorerRun(s: ExplorerStore, country: string): ExplorerStore {
  const { [country]: _gone, ...rest } = s.countries;
  return { last: s.last === country ? null : s.last, countries: rest };
}

// The mode last chosen on the setup screen: one of the menu's durations, or 'explorer'; Classic (10 minutes) until one is
// chosen. A choice saved before v1.2 of a length no longer in the menu (5 or 20 minutes) becomes Classic.
export type RushChoice = Duration | 'explorer';
export const CHOICE_KEY = 'atlas-city-rush-choice-v1';
export function loadChoice(from: Storage | null = storage()): RushChoice {
  let v: string | null = null;
  try { v = from?.getItem(CHOICE_KEY) ?? null; } catch { /* default */ }
  if (v === 'explorer') return 'explorer';
  const n = Number(v);
  return isDuration(n) && inMenu(n) ? n : DEFAULT_DURATION;
}
// The country last chosen on the setup screen, so coming back to City Rush from the menu opens on it.
export const COUNTRY_KEY = 'atlas-city-rush-country-v1';
export function loadLastCountry(from: Storage | null = storage()): string | null {
  try { const v = from?.getItem(COUNTRY_KEY) ?? null; return v && /^[A-Z]{3}$/.test(v) ? v : null; } catch { return null; }
}
export const saveLastCountry = (id: string, to: Storage | null = storage()) => { try { to?.setItem(COUNTRY_KEY, id); } catch { /* kept for this visit */ } };
export const saveChoice = (c: RushChoice, to: Storage | null = storage()) => { try { to?.setItem(CHOICE_KEY, String(c)); } catch { /* kept for this visit */ } };

export function loadActive(from: Storage | null = storage()): SavedRun | null {
  const s = validSaved(read(from, ACTIVE_KEY));
  return s && s.durationMs !== null ? s : null;
}
export const saveActive = (s: SavedRun | null, to: Storage | null = storage()) => write(to, ACTIVE_KEY, s);
