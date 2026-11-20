// Shareable City Rush results. Pure: the text and the link are built from plain values, so they are tested, and nothing
// in them gives away an answer. The link only opens City Rush on the same country.
import { durationLabel, formatClock, formatCoverage, rushName, type RushMode } from './cityRush.ts';

// The country's flag as an emoji, from its ISO 3166-1 alpha-2 code (two regional-indicator letters). Fine in shared text,
// even though the app itself draws flags as images (emoji flags do not render on Windows).
export const flagEmoji = (iso2: string) => (/^[A-Za-z]{2}$/.test(iso2) ? String.fromCodePoint(...[...iso2.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : '');

// The link a result shares: the site's own address (wherever it is deployed) with the country to play. Never the answers.
export const RUSH_PARAM = 'rush';
export function challengeUrl(origin: string, base: string, country: string): string {
  const path = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${path}?${RUSH_PARAM}=${encodeURIComponent(country)}`;
}
// The country a shared link asks for, if it is a well-formed roster id.
export function challengeFrom(search: string): string | null {
  const v = new URLSearchParams(search).get(RUSH_PARAM);
  return v && /^[A-Z]{3}$/.test(v) ? v : null;
}

// `coverage` is City Population Coverage in percent (cityRush.coverageOf).
export type ShareInput = { countryName: string; iso2: string; mode: RushMode; coverage: number; count: number; durationMs: number | null; elapsedMs: number; url: string };
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function shareText(s: ShareInput): string {
  const flag = flagEmoji(s.iso2), timed = s.mode === 'timed' && s.durationMs !== null;
  return [
    timed ? 'ATLAS · CITY RUSH' : 'ATLAS · CITY EXPLORER',
    `${s.countryName}${flag ? ` ${flag}` : ''}`,
    `${formatCoverage(s.coverage)} City Population Coverage`,
    `${plural(s.count, 'city', 'cities')} discovered`,
    timed ? `${rushName(s.durationMs)} · ${durationLabel(s.durationMs!)}` : `${formatClock(s.elapsedMs)} exploring`,
    '',
    timed ? 'Think you can beat me?' : 'How much can you name?',
    s.url,
  ].join('\n');
}
