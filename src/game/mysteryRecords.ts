// Mystery Country records and the game in progress, kept in this browser, apart from every other mode's records.
// Records are per country set and mode (unlimited or daily) and per version of the pool, like other challenges.
import { versionOf } from './challenges.ts';
import { compareMysteryRuns, missesOf, closestOf, type Mystery, type MysteryGuess, type MysteryMode } from './mystery.ts';
import type { CountrySet } from '../data/countries.ts';

export type MysteryChallenge = { id: string; version: string; set: CountrySet; mode: MysteryMode };
export const mysteryChallenge = (set: CountrySet, pool: string[], mode: MysteryMode = 'unlimited'): MysteryChallenge =>
  ({ id: `mystery${mode === 'daily' ? '-daily' : ''}-${set === '195' ? 'classic' : '200'}`, version: `m1-${versionOf(pool)}`, set, mode });
export const mysteryKey = (c: Pick<MysteryChallenge, 'id' | 'version'>) => `${c.id}@${c.version}`;

// One finished or abandoned puzzle. `guesses` counts the solving guess; `date` is the UTC date of a daily mystery.
export type MysteryRun = {
  id: string; at: string; answer: string; solved: boolean;
  guesses: number; ms: number; closest: { id: string; km: number } | null;
  sequence: MysteryGuess[]; date?: string;
};
export type MysteryRecord = {
  challengeId: string; version: string;
  solved: number; abandoned: number;
  totalGuesses: number;          // over solved puzzles, for the average
  fewest: number | null; fastestMs: number | null;
  best: MysteryRun | null;       // fewest guesses, then fastest
  discovered: string[];          // distinct countries solved
  history: MysteryRun[];         // newest first, up to HISTORY
};
export type MysteryStore = { [key: string]: MysteryRecord };
export const HISTORY = 30;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export function toMysteryRun(m: Mystery, ms: number, at = new Date().toISOString(), date?: string): MysteryRun {
  const c = closestOf(missesOf(m));
  return {
    id: newId(), at, answer: m.answer, solved: m.phase === 'solved', guesses: m.guesses.length, ms,
    closest: c && c.km !== null ? { id: c.id, km: c.km } : null, sequence: m.guesses, ...(date ? { date } : {}),
  };
}

export type MysteryBests = { guesses: boolean; time: boolean; run: boolean };
// Folds a run into its record. Abandoned runs are counted but never become bests. `bests` is null for a first solve.
export function addMysteryRun(prev: MysteryRecord | undefined, c: Pick<MysteryChallenge, 'id' | 'version'>, run: MysteryRun): { record: MysteryRecord; bests: MysteryBests | null } {
  const r: MysteryRecord = prev ?? { challengeId: c.id, version: c.version, solved: 0, abandoned: 0, totalGuesses: 0, fewest: null, fastestMs: null, best: null, discovered: [], history: [] };
  const history = [run, ...r.history].slice(0, HISTORY);
  if (!run.solved) return { record: { ...r, abandoned: r.abandoned + 1, history }, bests: null };
  const first = r.solved === 0;
  const bests: MysteryBests = {
    guesses: r.fewest !== null && run.guesses < r.fewest,
    time: r.fastestMs !== null && run.ms < r.fastestMs,
    run: !!r.best && compareMysteryRuns({ guesses: run.guesses, ms: run.ms }, r.best) > 0,
  };
  return {
    record: {
      ...r, solved: r.solved + 1, totalGuesses: r.totalGuesses + run.guesses,
      fewest: r.fewest === null ? run.guesses : Math.min(r.fewest, run.guesses),
      fastestMs: r.fastestMs === null ? run.ms : Math.min(r.fastestMs, run.ms),
      best: !r.best || bests.run ? run : r.best,
      discovered: r.discovered.includes(run.answer) ? r.discovered : [...r.discovered, run.answer],
      history,
    },
    bests: first ? null : bests,
  };
}
// A genuine new personal best: a better run than the previous best (never on a first solve).
export const isMysteryRecord = (b: MysteryBests | null) => !!b?.run;
export const averageGuesses = (r: MysteryRecord) => (r.solved ? r.totalGuesses / r.solved : null);

// ---- Storage --------------------------------------------------------------------------------------------------------------
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const RECORDS = 'atlas-mystery-v1', ACTIVE = 'atlas-mystery-active-v1', RECENT_KEY = 'atlas-mystery-recent-v1';

export function loadMysteryStore(from: Storage | null = storage()): MysteryStore {
  try {
    const v = JSON.parse(from?.getItem(RECORDS) || '{}');
    if (!v || typeof v !== 'object') return {};
    return Object.fromEntries(Object.entries(v as MysteryStore).filter(([, r]) => r && typeof r.solved === 'number' && Array.isArray(r.history)));
  } catch { return {}; }
}
export function saveMysteryStore(s: MysteryStore, to: Storage | null = storage()) {
  try { to?.setItem(RECORDS, JSON.stringify(s)); } catch { /* storage blocked or full: lasts for this visit */ }
}

// The puzzle in progress, so a refresh carries on where it was. The answer is stored lightly encoded, so a glance at
// storage does not give it away (it is not security: the game runs in the player's own browser).
export type ActiveMystery = { key: string; set: CountrySet; mode: MysteryMode; answer: string; guesses: MysteryGuess[]; ms: number; date?: string };
const SALT = 'atlas-mystery';
export const encodeAnswer = (id: string) => [...id].map((ch, i) => (ch.charCodeAt(0) ^ SALT.charCodeAt(i % SALT.length)).toString(16).padStart(2, '0')).join('');
export const decodeAnswer = (code: string) => (code.match(/../g) ?? []).map((h, i) => String.fromCharCode(parseInt(h, 16) ^ SALT.charCodeAt(i % SALT.length))).join('');

export function saveActive(a: ActiveMystery | null, to: Storage | null = storage()) {
  try {
    if (!a) to?.removeItem(ACTIVE);
    else to?.setItem(ACTIVE, JSON.stringify({ ...a, answer: encodeAnswer(a.answer) }));
  } catch { /* lasts for this visit */ }
}
// The saved puzzle, if it is still playable: its answer must be in `valid` (the current pool for its set).
export function loadActive(valid: (set: CountrySet) => Set<string>, from: Storage | null = storage()): ActiveMystery | null {
  try {
    const v = JSON.parse(from?.getItem(ACTIVE) || 'null');
    if (!v || (v.set !== '200' && v.set !== '195') || !Array.isArray(v.guesses) || typeof v.ms !== 'number') return null;
    const answer = decodeAnswer(String(v.answer)), pool = valid(v.set);
    if (!pool.has(answer)) return null;
    const guesses = (v.guesses as MysteryGuess[]).filter(g => g && typeof g.id === 'string' && g.id !== answer && pool.has(g.id));
    return { key: String(v.key), set: v.set, mode: v.mode === 'daily' ? 'daily' : 'unlimited', answer, guesses, ms: Math.max(0, v.ms), ...(v.date ? { date: String(v.date) } : {}) };
  } catch { return null; }
}

export function loadRecent(from: Storage | null = storage()): string[] {
  try { const v = JSON.parse(from?.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
}
export function saveRecent(r: string[], to: Storage | null = storage()) { try { to?.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* ok */ } }
