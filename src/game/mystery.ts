// Mystery Country: find a hidden country by guessing; each wrong guess shows how close it is (distance.ts). The rules,
// the heat colours, search and the choice of mystery, as pure functions tested with `npm test`. Its own scoring:
// fewer guesses is better, then faster. No points, no streaks.
import { normalize } from './names.ts';
import { elapsed, pauseClock, resumeClock, type Clock } from './scoring.ts';
import type { RosterEntry } from '../data/roster.ts';

// `unlimited`: a fresh random mystery after each one. `daily` (prepared, not offered yet): one mystery per UTC date,
// the same for everyone, with its own records.
export type MysteryMode = 'unlimited' | 'daily';
export type MysteryGuess = { id: string; km: number | null; via: 'click' | 'type' };   // km null: shape missing
export type Mystery = {
  answer: string;
  mode: MysteryMode;
  guesses: MysteryGuess[];   // in the order made, the solving guess last
  phase: 'playing' | 'solved';
  clock: Clock;
};
export type MysteryOutcome = 'solved' | 'miss' | 'duplicate' | 'ignored';

export const newMystery = (answer: string, now: number, mode: MysteryMode = 'unlimited'): Mystery =>
  ({ answer, mode, guesses: [], phase: 'playing', clock: { accumulated: 0, since: now } });

// One guess, clicked or typed: the same function either way. A country already guessed is a `duplicate`: it changes
// nothing, so it never adds to the count or makes a sound. Nothing is accepted after the solve or while paused.
export function guessMystery(m: Mystery, id: string, km: number | null, via: MysteryGuess['via'], now: number): { mystery: Mystery; outcome: MysteryOutcome } {
  if (m.phase !== 'playing' || m.clock.since === null) return { mystery: m, outcome: 'ignored' };
  if (m.guesses.some(g => g.id === id)) return { mystery: m, outcome: 'duplicate' };
  if (id === m.answer) {
    return { mystery: { ...m, guesses: [...m.guesses, { id, km: 0, via }], phase: 'solved', clock: pauseClock(m.clock, now) }, outcome: 'solved' };
  }
  return { mystery: { ...m, guesses: [...m.guesses, { id, km, via }] }, outcome: 'miss' };
}

export const pauseMystery = (m: Mystery, now: number): Mystery => ({ ...m, clock: pauseClock(m.clock, now) });
export const resumeMystery = (m: Mystery, now: number): Mystery => (m.phase === 'solved' ? m : { ...m, clock: resumeClock(m.clock, now) });

// The wrong guesses, and the closest of them (the first one on a tie).
export const missesOf = (m: Pick<Mystery, 'guesses' | 'answer'>) => m.guesses.filter(g => g.id !== m.answer);
export function closestOf(guesses: MysteryGuess[]): MysteryGuess | null {
  let best: MysteryGuess | null = null;
  for (const g of guesses) if (g.km !== null && (best === null || g.km < best.km!)) best = g;
  return best;
}

export type MysteryStats = { guesses: number; closest: MysteryGuess | null; elapsedMs: number; solved: boolean };
export const mysteryStats = (m: Mystery, now: number): MysteryStats =>
  ({ guesses: m.guesses.length, closest: closestOf(missesOf(m)), elapsedMs: elapsed(m.clock, now), solved: m.phase === 'solved' });

// How each guess compared with the ones before it: the closest yet, or not. Shown in the history.
export type Trend = 'closest' | 'farther' | 'solved';
export function trendsOf(m: Pick<Mystery, 'guesses' | 'answer'>): Trend[] {
  let best = Infinity;
  return m.guesses.map(g => {
    if (g.id === m.answer) return 'solved';
    const km = g.km ?? Infinity, t: Trend = km < best ? 'closest' : 'farther';
    best = Math.min(best, km);
    return t;
  });
}

// The history in either order: newest first, or closest first (ties keep guess order). Each entry keeps its number.
export function historyOf(guesses: MysteryGuess[], order: 'latest' | 'closest') {
  const list = guesses.map((g, i) => ({ ...g, n: i + 1 }));
  return order === 'latest' ? list.reverse() : list.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || a.n - b.n);
}

// ---- Heat -----------------------------------------------------------------------------------------------------------
// How hot a guess is, 1 (touching) to 0 (HEAT_FAR km or more), on a log scale so nearby distances are easy to tell
// apart: 0 km → 1, 250 km → 0.83, 1,000 km → 0.61, 3,000 km → 0.38, 8,000 km → 0.15.
export const HEAT_FAR = 15000;
const HEAT_KNEE = 250;
export const heatOf = (km: number | null) => (km === null ? 0 : Math.max(0, Math.min(1, 1 - Math.log1p(km / HEAT_KNEE) / Math.log1p(HEAT_FAR / HEAT_KNEE))));
// Pale rose (far) to deep red (very close). GlobeView interpolates the same stops on the map, so a history swatch is
// always the colour of its country on the globe.
export const HEAT_STOPS: [number, string][] = [[0, '#f4dde0'], [0.25, '#ecb0b6'], [0.5, '#e07680'], [0.75, '#c93b48'], [1, '#a10f20']];
export function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const i = Math.min(HEAT_STOPS.length - 2, HEAT_STOPS.findIndex(([s], k) => x <= HEAT_STOPS[k + 1]?.[0]));
  const [s0, c0] = HEAT_STOPS[i], [s1, c1] = HEAT_STOPS[i + 1], f = (x - s0) / (s1 - s0);
  const rgb = (h: string) => [1, 3, 5].map(j => parseInt(h.slice(j, j + 2), 16));
  const a = rgb(c0), b = rgb(c1);
  return `#${a.map((v, j) => Math.round(v + (b[j] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

// 1234.5 → "1,235 km"; 0 → "0 km".
export const formatKm = (km: number | null) => (km === null ? '—' : `${Math.round(km).toLocaleString('en-US')} km`);

// ---- Search -----------------------------------------------------------------------------------------------------------
// Countries matching what the player has typed, best first: an exact name or alias, then names that start with it,
// then names with a word that starts with it, then names containing it. Spaces are ignored for exact and starting
// matches, so "cote d ivoire" finds Côte d'Ivoire and "guineabissau" finds Guinea-Bissau. `alias` is set when only an alias matched
// ("East Timor" found by "timor-leste"), so the list can show why it matched.
export type Suggestion = { entry: RosterEntry; alias?: string; rank: number };
export function searchCountries(query: string, entries: RosterEntry[], limit = 6): Suggestion[] {
  const q = normalize(query), qc = q.replace(/ /g, '');
  if (!q) return [];
  const out: Suggestion[] = [];
  for (const entry of entries) {
    let best: Suggestion | null = null;
    for (const [i, name] of [entry.name, ...entry.aliases].entries()) {
      const n = normalize(name), nc = n.replace(/ /g, '');
      const rank = n === q || nc === qc ? 0 : n.startsWith(q) || nc.startsWith(qc) ? 1 : n.split(' ').some(w => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : -1;
      // The country's own name wins a tie with an alias.
      if (rank >= 0 && (!best || rank < best.rank)) best = { entry, rank, alias: i === 0 ? undefined : name };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name)).slice(0, limit);
}

// ---- Choosing the mystery -----------------------------------------------------------------------------------------------
// Uniformly at random from the pool, avoiding the most recent answers (up to RECENT, and never more than half the pool),
// so the same country never comes up twice in a row while any other is left.
export const RECENT = 10;
export function pickMystery(pool: string[], recent: string[], random: () => number = Math.random): string | null {
  const unique = [...new Set(pool)];
  if (!unique.length) return null;
  const avoid = new Set(recent.slice(0, Math.min(RECENT, Math.floor(unique.length / 2))));
  const open = unique.filter(id => !avoid.has(id));
  const from = open.length ? open : unique;
  return from[Math.floor(random() * from.length)];
}
export const rememberRecent = (recent: string[], answer: string) => [answer, ...recent.filter(id => id !== answer)].slice(0, RECENT);

// Daily Mystery (prepared for later): the same country for everyone on a UTC date, from the date and the pool alone.
export const utcDate = (d: Date) => d.toISOString().slice(0, 10);
export function dailyMystery(pool: string[], date: string): string | null {
  const sorted = [...new Set(pool)].sort();
  if (!sorted.length) return null;
  let h = 0x811c9dc5;
  for (const ch of `atlas-daily:${date}:${sorted.join(',')}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return sorted[(h >>> 0) % sorted.length];
}

// ---- Ranking --------------------------------------------------------------------------------------------------------------
// Positive when `a` ranks above `b`: fewer guesses, then faster.
export const compareMysteryRuns = (a: { guesses: number; ms: number }, b: { guesses: number; ms: number }) => b.guesses - a.guesses || b.ms - a.ms;
