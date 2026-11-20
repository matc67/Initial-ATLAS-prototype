// City Rush: how much of a country's city population can you name? Pure rules, no map or storage; times are epoch ms
// (Date.now()), so a run saved before a refresh carries on with the same clock.
//
//   timed     a fixed time: 3, 5, 10 or 20 minutes (Quick, Classic, Extended, Marathon). The clock never pauses: it runs to a deadline, so a refresh, a hidden
//             tab or a long look at another app all spend the same time. Scores are comparable because of this.
//   explorer  no clock to beat. Active time is counted (paused while the tab is hidden), and progress is kept per
//             country until the player resets it.
//
// The score is people: each city found adds its population (cityMatch.awards, which never counts a city's districts
// twice). Coverage is that score over the population of every city a guess can claim (CityBook.total): both come from the
// same processed list, so it is the share of the dataset's city population, never of the national population.
export type RushMode = 'timed' | 'explorer';
// Timed durations, in seconds. Records, bests and Cities You Missed are all kept per duration: a 20-minute run never
// competes with a 5-minute one. Extended (10 minutes) is the recommended start.
export const DURATIONS = [180, 300, 600, 1200] as const;
export type Duration = (typeof DURATIONS)[number];
export const DEFAULT_DURATION: Duration = 600;
export const DURATION_NAMES: { [s in Duration]: string } = { 180: 'Quick Rush', 300: 'Classic Rush', 600: 'Extended Rush', 1200: 'Marathon Rush' };
export const isDuration = (s: unknown): s is Duration => (DURATIONS as readonly unknown[]).includes(s);
// The name of a run's mode: "Extended Rush", or "City Explorer" without a clock.
export const rushName = (durationMs: number | null) =>
  durationMs === null ? 'City Explorer' : DURATION_NAMES[Math.round(durationMs / 1000) as Duration] ?? 'City Rush';
// Coverage milestones, in percent.
export const MILESTONES = [10, 25, 50, 75, 90] as const;

export type Rush = {
  country: string;
  version: string;                  // the country's city data version (CityFile.version)
  mode: RushMode;
  durationMs: number | null;        // timed only
  startedAt: number;                // epoch ms
  // Explorer active time: `accumulated` ms, plus the time since `since` while it runs. Timed runs keep since = startedAt.
  clock: { accumulated: number; since: number | null };
  found: string[];                  // city ids, in the order found
  foundAt: number[];                // ms into the run at which each was found
  phase: 'playing' | 'done';
  endedAt: number | null;
};
export type RushOutcome = 'new' | 'duplicate' | 'unknown' | 'empty' | 'over';

export function newRush(country: string, version: string, mode: RushMode, now: number, duration: number = DEFAULT_DURATION): Rush {
  return {
    country, version, mode, durationMs: mode === 'timed' ? duration * 1000 : null, startedAt: now,
    clock: { accumulated: 0, since: now }, found: [], foundAt: [], phase: 'playing', endedAt: null,
  };
}

export const deadlineOf = (r: Rush) => (r.durationMs === null ? Infinity : r.startedAt + r.durationMs);
// Time left in a timed run, never below 0. Explorer runs have no limit.
export const remainingMs = (r: Rush, now: number) => (r.durationMs === null ? Infinity : Math.max(0, deadlineOf(r) - (r.endedAt ?? now)));
// Time played: for a timed run, capped at its duration; for an explorer run, active time only.
export function elapsedMs(r: Rush, now: number): number {
  if (r.durationMs !== null) return Math.max(0, Math.min(r.endedAt ?? now, deadlineOf(r)) - r.startedAt);
  const end = r.endedAt ?? now;
  return r.clock.accumulated + (r.clock.since === null ? 0 : Math.max(0, end - r.clock.since));
}
export const isExpired = (r: Rush, now: number) => r.durationMs !== null && now >= deadlineOf(r);

// One typed guess, already looked up: `city` is the id findCity returned, or null when nothing matched.
// A guess arriving at or after the deadline counts for nothing, even if the screen had not caught up yet.
export function guessRush(r: Rush, typed: string, city: string | null, now: number): { rush: Rush; outcome: RushOutcome } {
  if (r.phase !== 'playing' || isExpired(r, now)) return { rush: r, outcome: 'over' };
  if (!typed.trim()) return { rush: r, outcome: 'empty' };
  if (!city) return { rush: r, outcome: 'unknown' };
  if (r.found.includes(city)) return { rush: r, outcome: 'duplicate' };
  return { rush: { ...r, found: [...r.found, city], foundAt: [...r.foundAt, elapsedMs(r, now)] }, outcome: 'new' };
}

// Ends a run. A timed run ends at its deadline at the latest, however late the end is noticed (a tab reopened later).
export function finishRush(r: Rush, now: number): Rush {
  if (r.phase === 'done') return r;
  const end = r.durationMs === null ? now : Math.min(now, deadlineOf(r));
  const clock = r.durationMs === null && r.clock.since !== null ? { accumulated: r.clock.accumulated + Math.max(0, end - r.clock.since), since: null } : r.clock;
  return { ...r, clock, phase: 'done', endedAt: end };
}

// Explorer only: the clock stops while the tab is hidden or the player is elsewhere. A timed run ignores both.
export function pauseRush(r: Rush, now: number): Rush {
  if (r.mode !== 'explorer' || r.phase !== 'playing' || r.clock.since === null) return r;
  return { ...r, clock: { accumulated: r.clock.accumulated + Math.max(0, now - r.clock.since), since: null } };
}
export function resumeRush(r: Rush, now: number): Rush {
  if (r.mode !== 'explorer' || r.phase !== 'playing' || r.clock.since !== null) return r;
  return { ...r, clock: { ...r.clock, since: now } };
}

// Coverage in percent: people found over the people that can be found. 0 when there is nothing to find.
export const coverageOf = (people: number, total: number) => (total > 0 ? Math.min(100, (people / total) * 100) : 0);
// The highest milestone a guess has just crossed (one big city can cross several: only the top one is shown).
export function milestoneCrossed(before: number, after: number): number | null {
  const crossed = MILESTONES.filter(m => before < m && after >= m);
  return crossed.length ? crossed[crossed.length - 1] : null;
}
// "42.8%"; below 1%, two decimals; never "100.0%" before every person is found, and never "0.00%" once someone is.
export function formatCoverage(pct: number): string {
  if (pct <= 0) return '0%';
  if (pct >= 100) return '100%';
  if (pct < 0.01) return '<0.01%';
  const s = pct < 1 ? pct.toFixed(2) : pct.toFixed(1);
  return `${s === '100.0' ? '99.9' : s}%`;
}
// "2.79M", "132K", "950": compact for the HUD and shares; exact figures use exactPeople.
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
export const formatPeople = (n: number) => COMPACT.format(Math.max(0, Math.round(n)));
export const exactPeople = (n: number) => Math.max(0, Math.round(n)).toLocaleString('en-US');

// "4:59", or "1:02:03" past an hour (explorer). A countdown rounds up, so it shows 0:00 only when time is really up.
export function formatClock(ms: number, countdown = false): string {
  const s = Math.max(0, countdown ? Math.ceil(ms / 1000 - 1e-9) : Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export const durationLabel = (ms: number) => { const m = Math.round(ms / 60000); return `${m} minute${m === 1 ? '' : 's'}`; };
