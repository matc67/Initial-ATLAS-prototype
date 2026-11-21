// Challenge a friend: a link that opens the same game (mode, country or area, length) with a score to beat. Pure, so it
// is tested. What a link carries is public by design and never more than this: no answers, no cities or countries the
// player named, no name. A target is only ever shown: it never enters the player's own records, which are written by the
// normal rules of the run they play.
//
//   City Rush      ?rush=CAN&t=600&beat=42.8&v=<data version>     t: seconds, or x for City Explorer
//   Rounds         ?play=sprint&area=europe&mode=find&set=200&beat=1250&v=<challenge version>   play: sprint | full
//   Regions        ?play=regions-sprint&country=CAN&mode=find&beat=900&v=<challenge version>    regions-full too
//   Mystery        ?play=mystery&set=200&beat=4                    beat: guesses (fewer is better)
//
// The plain ?rush=CAN of earlier releases still opens City Rush on that country, with nothing to beat.
import { AREAS, type Area, type CountrySet } from '../data/countries.ts';
import { DURATIONS, DURATION_NAMES, type Duration } from './cityRush.ts';
import { GAME_MODES, type ChallengeKind, type GameMode } from './challenges.ts';

export type Challenge =
  | { kind: 'rush'; country: string; durationS: number | null; target: number | null; version: string | null }
  | { kind: 'round'; round: ChallengeKind; area: Area; mode: GameMode; set: CountrySet; target: number; version: string | null }
  | { kind: 'regions'; round: ChallengeKind; country: string; mode: 'find' | 'name'; target: number; version: string | null }
  | { kind: 'mystery'; set: CountrySet; target: number };

const slug = (a: string) => a.toLowerCase().replace(/[^a-z]+/g, '-');
const AREA_BY_SLUG = new Map<string, Area>(AREAS.map(a => [slug(a), a]));
const COUNTRY = /^[A-Z]{3}$/, VERSION = /^[\w.-]{1,48}$/;
const MAX_POINTS = 1_000_000, MAX_GUESSES = 250;

// The link for a challenge, on this site wherever it is deployed.
export function challengeLink(origin: string, base: string, c: Challenge): string {
  const q = new URLSearchParams();
  if (c.kind === 'rush') {
    q.set('rush', c.country);
    if (c.target !== null) {
      q.set('t', c.durationS === null ? 'x' : String(c.durationS));
      q.set('beat', c.target.toFixed(1));
      if (c.version) q.set('v', c.version);
    }
  } else if (c.kind === 'round') {
    q.set('play', c.round); q.set('area', slug(c.area)); q.set('mode', c.mode); q.set('set', c.set); q.set('beat', String(Math.round(c.target)));
    if (c.version) q.set('v', c.version);
  } else if (c.kind === 'regions') {
    q.set('play', `regions-${c.round}`); q.set('country', c.country); q.set('mode', c.mode); q.set('beat', String(Math.round(c.target)));
    if (c.version) q.set('v', c.version);
  } else {
    q.set('play', 'mystery'); q.set('set', c.set); q.set('beat', String(Math.round(c.target)));
  }
  const path = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${path}?${q.toString()}`;
}

export type Parsed = { challenge: Challenge } | { invalid: string } | null;

// A challenge from a page's query string: null when the page was not opened from a challenge link, `invalid` (with the
// reason, for the console) when it was but the link is broken or tampered with.
export function parseChallenge(search: string): Parsed {
  const q = new URLSearchParams(search);
  const rush = q.get('rush'), play = q.get('play');
  if (rush === null && play === null) return null;
  const bad = (why: string) => ({ invalid: why });
  const version = () => { const v = q.get('v'); return v && VERSION.test(v) ? v : null; };
  const int = (name: string, min: number, max: number) => { const s = q.get(name); if (s === null || !/^\d{1,7}$/.test(s)) return null; const n = Number(s); return n >= min && n <= max ? n : null; };

  if (rush !== null) {
    if (!COUNTRY.test(rush)) return bad('country');
    if (!q.has('beat')) return { challenge: { kind: 'rush', country: rush, durationS: null, target: null, version: null } };
    const t = q.get('t'), beat = q.get('beat')!;
    const durationS = t === 'x' ? null : t !== null && (DURATIONS as readonly number[]).includes(Number(t)) && /^\d+$/.test(t) ? Number(t) : undefined;
    if (durationS === undefined) return bad('length');
    if (!/^\d{1,3}(\.\d)?$/.test(beat) || Number(beat) > 100) return bad('target');
    return { challenge: { kind: 'rush', country: rush, durationS, target: Number(beat), version: version() } };
  }
  if (play === 'sprint' || play === 'full') {
    const area = AREA_BY_SLUG.get(q.get('area') ?? ''), mode = q.get('mode') as GameMode, set = q.get('set'), target = int('beat', 0, MAX_POINTS);
    if (!area) return bad('area');
    if (!GAME_MODES.includes(mode)) return bad('mode');
    if (set !== '200' && set !== '195') return bad('set');
    if (target === null) return bad('target');
    return { challenge: { kind: 'round', round: play, area, mode, set, target, version: version() } };
  }
  if (play === 'regions-sprint' || play === 'regions-full') {
    const country = q.get('country') ?? '', mode = q.get('mode'), target = int('beat', 0, MAX_POINTS);
    if (!COUNTRY.test(country)) return bad('country');
    if (mode !== 'find' && mode !== 'name') return bad('mode');
    if (target === null) return bad('target');
    return { challenge: { kind: 'regions', round: play === 'regions-sprint' ? 'sprint' : 'full', country, mode, target, version: version() } };
  }
  if (play === 'mystery') {
    const set = q.get('set'), target = int('beat', 1, MAX_GUESSES);
    if (set !== '200' && set !== '195') return bad('set');
    if (target === null) return bad('target');
    return { challenge: { kind: 'mystery', set, target } };
  }
  return bad('game');
}

// The query a challenge link adds, removed from the address once read (so a refresh does not ask again).
export const CHALLENGE_PARAMS = ['rush', 't', 'beat', 'v', 'play', 'area', 'mode', 'set', 'country'];
export function withoutChallenge(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of CHALLENGE_PARAMS) q.delete(k);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// How a result compares with a challenge's target. Fewer is better for a mystery; more for everything else. A tie
// counts as meeting the challenge, not beating it.
export type Outcome = { verdict: 'beat' | 'tied' | 'short'; gap: number };
export function outcomeOf(c: Challenge, result: number): Outcome | null {
  if (c.kind === 'rush' && c.target === null) return null;
  const target = c.target!;
  const better = c.kind === 'mystery' ? target - result : result - target;
  const gap = Math.abs(c.kind === 'rush' ? Math.round((result - target) * 10) / 10 : result - target);
  return { verdict: better > 1e-9 && gap > 0 ? 'beat' : gap === 0 ? 'tied' : 'short', gap };
}

// Whether the target was set on the same data and rules as the game the friend will play. When not (a city list or
// country list changed since), the target is still shown, with a note that the two are not strictly comparable.
export const comparable = (c: Challenge, currentVersion: string | null) =>
  c.kind === 'mystery' || (c.kind === 'rush' && c.target === null) || c.version === null || currentVersion === null || c.version === currentVersion;

// What a challenge asks, in words: the game ("Extended Rush · Canada") and the goal ("Beat 42.8% city population
// coverage in 10 minutes"). `place` is the country's or area's name as the game shows it.
const MODE_WORDS: { [M in GameMode]: string } = { find: 'Find it', name: 'Name it', flag: 'Flags' };
export function challengeText(c: Challenge, place: string): { title: string; goal: string } {
  const pts = (n: number) => `${n.toLocaleString('en-US')} point${n === 1 ? '' : 's'}`;
  if (c.kind === 'rush') {
    const game = c.durationS === null ? 'City Explorer' : DURATION_NAMES[c.durationS as Duration];
    if (c.target === null) return { title: `City Rush · ${place}`, goal: 'Name its cities and cover as many of its people as you can.' };
    return { title: `${game} · ${place}`, goal: `Beat ${c.target.toFixed(1)}% city population coverage${c.durationS === null ? '' : ` in ${c.durationS / 60} minutes`}.` };
  }
  if (c.kind === 'round') return { title: `${c.round === 'sprint' ? 'Sprint' : 'Full challenge'} · ${MODE_WORDS[c.mode]} · ${place}`, goal: `Beat ${pts(c.target)}.` };
  if (c.kind === 'regions') return { title: `Regions · ${MODE_WORDS[c.mode]} · ${place}`, goal: `Beat ${pts(c.target)} in a ${c.round === 'sprint' ? 'Sprint' : 'Full challenge'}.` };
  return { title: `Mystery Country · ${c.set === '195' ? 'Classic 195' : '200 countries'}`, goal: c.target === 1 ? 'Solve a mystery first try.' : `Solve a mystery in fewer than ${c.target} guesses.` };
}
