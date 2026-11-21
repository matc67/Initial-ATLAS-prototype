// The words and numbers on a share card, and where they go: pure, so every mode's card is tested without a browser
// (components/shareCard.ts draws it). Each result type says what it is best at: City Rush its coverage, a round its
// score, a mystery how few guesses it took. Nothing on a card gives away an answer to a game a friend could play.
import { durationLabel, formatClock, formatCoverage, formatPeople, rushName } from './cityRush.ts';
import { formatTime } from './scoring.ts';
import type { GameMode } from './challenges.ts';

export type ShareResult =
  | { kind: 'rush'; durationMs: number | null; place: string; iso2: string; coverage: number; people: number; cities: number; elapsedMs: number }
  | { kind: 'round'; sprint: boolean; mode: GameMode; place: string; iso2: string | null; units: string; score: number; maxScore: number; firstTry: number; total: number; mistakes: number; elapsedMs: number; regions: boolean; strip: StripCell[] }
  | { kind: 'mystery'; set: '200' | '195'; guesses: number; elapsedMs: number; heat: string[] };
// One answer of a Sprint, as a coloured square: first try, later try, or missed / shown.
export type StripCell = 'first' | 'retry' | 'missed';

export type CardStat = { value: string; label: string };
export type CardContent = {
  eyebrow: string;       // "CITY RUSH · 10 MINUTES"
  place: string;         // "Canada", "Europe", "Mystery Country"
  iso2: string | null;   // a flag beside the place
  big: string;           // "42.8%", "1,250", "4"
  bigLabel: string;      // "city population coverage"
  stats: CardStat[];     // two or three
  strip: string[] | null;// colours of a row of squares (a Sprint's answers, a mystery's guesses)
  invite: string;        // "Can you beat 42.8% in 10 minutes?"
  inviteShort: string;   // the same, shorter, for when the place has a long name
  alt: string;           // the whole card as one sentence, for screen readers and the image's alt text
};

const MODE_NAME: { [M in GameMode]: string } = { find: 'Find it', name: 'Name it', flag: 'Flags' };
export const STRIP_COLOR: { [C in StripCell]: string } = { first: '#4ade80', retry: '#ffcf5c', missed: '#ff6b6b' };
const n = (v: number) => v.toLocaleString('en-US');

export function cardContent(r: ShareResult): CardContent {
  if (r.kind === 'rush') {
    const timed = r.durationMs !== null, big = formatCoverage(r.coverage);
    const c: Omit<CardContent, 'alt'> = {
      eyebrow: timed ? `${rushName(r.durationMs)} · ${durationLabel(r.durationMs!)}`.toUpperCase() : 'CITY EXPLORER',
      place: r.place, iso2: r.iso2, big, bigLabel: 'city population coverage',
      stats: [
        { value: n(r.cities), label: r.cities === 1 ? 'city named' : 'cities named' },
        { value: formatPeople(r.people), label: 'people found' },
        timed ? { value: durationLabel(r.durationMs!).replace(' minutes', ' min').replace(' minute', ' min'), label: 'on the clock' } : { value: formatClock(r.elapsedMs), label: 'exploring' },
      ],
      strip: null,
      invite: timed ? `Can you beat ${big} in ${durationLabel(r.durationMs!)}?` : `How much of ${r.place} can you name?`,
      inviteShort: timed ? `Can you beat ${big}?` : 'How much can you name?',
    };
    return { ...c, alt: altOf(c) };
  }
  if (r.kind === 'round') {
    const what = r.regions ? `${r.units.toUpperCase()}` : MODE_NAME[r.mode].toUpperCase();
    const c: Omit<CardContent, 'alt'> = {
      eyebrow: `${r.sprint ? 'SPRINT' : 'FULL CHALLENGE'} · ${what}${r.regions ? ` · ${MODE_NAME[r.mode].toUpperCase()}` : ''}`,
      place: r.place, iso2: r.iso2, big: n(r.score), bigLabel: `points of ${n(r.maxScore)}`,
      stats: [
        { value: `${r.firstTry}/${r.total}`, label: 'first try' },
        { value: n(r.mistakes), label: r.mistakes === 1 ? 'mistake' : 'mistakes' },
        { value: formatTime(r.elapsedMs), label: 'time' },
      ],
      strip: r.strip.length && r.strip.length <= 20 ? r.strip.map(s => STRIP_COLOR[s]) : null,
      invite: `Can you beat ${n(r.score)} points?`,
      inviteShort: `Can you beat ${n(r.score)}?`,
    };
    return { ...c, alt: altOf(c) };
  }
  const c: Omit<CardContent, 'alt'> = {
    eyebrow: `MYSTERY COUNTRY · ${r.set === '195' ? 'CLASSIC 195' : '200 COUNTRIES'}`,
    place: 'Mystery solved', iso2: null, big: n(r.guesses), bigLabel: r.guesses === 1 ? 'guess · solved first try' : 'guesses to solve it',
    stats: [{ value: formatTime(r.elapsedMs), label: 'time' }, { value: n(Math.max(0, r.guesses - 1)), label: r.guesses === 2 ? 'wrong guess' : 'wrong guesses' }],
    strip: r.heat.length && r.heat.length <= 20 ? r.heat : null,
    invite: `Can you solve one in fewer than ${n(r.guesses)}?`,
    inviteShort: `Fewer than ${n(r.guesses)}?`,
  };
  return { ...c, alt: altOf(c) };
}

// The text that goes with the card (and alone where images cannot be shared): what was played, the result, the dare
// and the link. Plain text, no emoji.
export const shareMessage = (c: CardContent, link: string) =>
  [`ATLAS · ${c.place}`, `${c.big} ${c.bigLabel} · ${titleCase(c.eyebrow)}`, c.invite, link].join('\n');
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s·]+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

const altOf = (c: Omit<CardContent, 'alt'>) =>
  `ATLAS result card. ${c.eyebrow.toLowerCase().replace(/(^|· )\w/g, s => s.toUpperCase())}, ${c.place}: ${c.big} ${c.bigLabel}. ${c.stats.map(s => `${s.value} ${s.label}`).join(', ')}. ${c.invite}`;

// ---- Layout --------------------------------------------------------------------------------------------------------------
// A 1200×630 card (the size link previews and chat apps show best), drawn at 1.5× for sharp text. The text column is on
// the left, the globe on the right. `measure` gives a text's width at a font (canvas in the browser, an estimate in tests).
export const CARD = { w: 1200, h: 630, scale: 1.5, x: 72, column: 500 } as const;
export type Measure = (text: string, font: string) => number;
export type Font = { weight: number; size: number; family: 'display' | 'body'; tracking?: number };
export type TextItem = { text: string; x: number; y: number; font: Font; color: 'ink' | 'ink2' | 'ink3' | 'accent' | 'gold' };
export type CardLayout = { texts: TextItem[]; flag: { x: number; y: number; w: number; h: number; iso2: string } | null; strip: { x: number; y: number; size: number; gap: number; colors: string[] } | null; dividers: { x: number; y: number; h: number }[] };
export const fontCss = (f: Font) => `${f.weight} ${f.size}px ${f.family === 'display' ? '"Space Grotesk"' : '"DM Sans"'}, system-ui, sans-serif`;

// Splits text into at most `lines` lines that fit `max`, shortening the last with an ellipsis if it still does not fit.
export function wrapText(text: string, max: number, measure: Measure, font: string, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean), out: string[] = [];
  let row = '';
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (row && measure(next, font) > max) { out.push(row); row = w; } else row = next;
  }
  if (row) out.push(row);
  if (out.length <= lines) return out.map(l => ellipsize(l, max, measure, font));
  return [...out.slice(0, lines - 1), ellipsize(out.slice(lines - 1).join(' '), max, measure, font)];
}
function ellipsize(text: string, max: number, measure: Measure, font: string): string {
  if (measure(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, font) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function layoutCard(c: CardContent, measure: Measure, site: string): CardLayout {
  const { x, column } = CARD, texts: TextItem[] = [];
  // The brand (the renderer draws a small globe before it).
  texts.push({ text: 'ATLAS', x: x + 40, y: 88, font: { weight: 700, size: 24, family: 'display', tracking: 7 }, color: 'ink' });
  // The eyebrow under the brand row.
  texts.push({ text: c.eyebrow, x, y: 150, font: { weight: 700, size: 17, family: 'body', tracking: 2.4 }, color: 'accent' });
  // The place: one or two lines, the size stepping down until it fits; a flag before it when there is one.
  const flag = c.iso2 ? { x, y: 176, w: 56, h: 42, iso2: c.iso2 } : null;
  const placeX = flag ? x + flag.w + 18 : x, placeMax = column - (placeX - x);
  let size = 54, lines: string[] = [];
  for (; size >= 34; size -= 4) {
    const font = fontCss({ weight: 600, size, family: 'display' });
    lines = wrapText(c.place, placeMax, measure, font, 2);
    if (lines.length === 1 || size <= 40) break;
  }
  const lineH = Math.round(size * 1.08);
  lines.forEach((t, i) => texts.push({ text: t, x: placeX, y: 214 + i * lineH, font: { weight: 600, size, family: 'display' }, color: 'ink' }));
  const afterPlace = 214 + (lines.length - 1) * lineH;
  // The big number, sized to the column.
  let big = 112;
  while (big > 60 && measure(c.big, fontCss({ weight: 700, size: big, family: 'display' })) > column) big -= 6;
  const bigY = afterPlace + 22 + big;
  texts.push({ text: c.big, x: x - 4, y: bigY, font: { weight: 700, size: big, family: 'display' }, color: 'gold' });
  const label = wrapText(c.bigLabel, column, measure, fontCss({ weight: 500, size: 22, family: 'body' }), 1)[0];
  texts.push({ text: label, x, y: bigY + 34, font: { weight: 500, size: 22, family: 'body' }, color: 'ink2' });
  // The stats in a row, separated by hairlines; their width shared out evenly.
  const statsY = bigY + 88, cell = column / c.stats.length, dividers: CardLayout['dividers'] = [];
  c.stats.forEach((s, i) => {
    const sx = x + i * cell + (i ? 22 : 0), w = cell - (i ? 22 : 0) - 8;
    if (i) dividers.push({ x: x + i * cell, y: statsY - 30, h: 52 });
    let vs = 34;
    while (vs > 20 && measure(s.value, fontCss({ weight: 600, size: vs, family: 'display' })) > w) vs -= 2;
    texts.push({ text: s.value, x: sx, y: statsY, font: { weight: 600, size: vs, family: 'display' }, color: 'ink' });
    texts.push({ text: wrapText(s.label.toUpperCase(), w, measure, fontCss({ weight: 700, size: 12, family: 'body', tracking: 1.6 }), 1)[0], x: sx, y: statsY + 22, font: { weight: 700, size: 12, family: 'body', tracking: 1.6 }, color: 'ink3' });
  });
  // A row of squares (Sprint answers, mystery guesses), when there is room for one.
  const stripY = statsY + 44;
  const strip = c.strip && stripY + 22 < 520 ? { x, y: stripY, size: Math.min(22, Math.floor((column + 6) / c.strip.length) - 6), gap: 6, colors: c.strip } : null;
  // The invitation and the site, at the foot of the column.
  const inviteFont = fontCss({ weight: 600, size: 24, family: 'display' });
  const invite = measure(c.invite, inviteFont) <= column ? c.invite : wrapText(c.inviteShort, column, measure, inviteFont, 1)[0];
  texts.push({ text: invite, x, y: 560, font: { weight: 600, size: 24, family: 'display' }, color: 'ink' });
  texts.push({ text: site, x, y: 596, font: { weight: 600, size: 17, family: 'body', tracking: 1 }, color: 'accent' });
  return { texts, flag, strip, dividers };
}
