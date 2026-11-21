import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARD, cardContent, layoutCard, shareMessage, wrapText, type ShareResult } from './shareCard.ts';

// Text widths as a browser would roughly measure them: about 0.56 em per character at the font's size.
const measure = (text: string, font: string) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.56;
const SITE = 'atlasxp.netlify.app';
const rush: ShareResult = { kind: 'rush', durationMs: 600_000, place: 'Canada', iso2: 'CA', coverage: 42.8, people: 14_480_000, cities: 140, elapsedMs: 600_000 };
const sprint: ShareResult = { kind: 'round', sprint: true, mode: 'find', place: 'Europe', iso2: null, units: 'countries', score: 1250, maxScore: 1400, firstTry: 7, total: 10, mistakes: 3, elapsedMs: 74_000, regions: false, strip: ['first', 'first', 'retry', 'first', 'missed', 'first', 'first', 'retry', 'first', 'first'] };
const mystery: ShareResult = { kind: 'mystery', set: '200', guesses: 5, elapsedMs: 96_000, heat: ['#f4dde0', '#ecb0b6', '#e07680', '#c93b48', '#4ade80'] };
const texts = (r: ShareResult) => layoutCard(cardContent(r), measure, SITE).texts.map(t => t.text);

test('a City Rush card carries the real result: coverage, cities, people, length', () => {
  const c = cardContent(rush);
  assert.equal(c.eyebrow, 'CLASSIC RUSH · 10 MINUTES');
  assert.equal(c.big, '42.8%');
  assert.deepEqual(c.stats.map(s => s.value), ['140', '14.5M', '10 min']);
  assert.equal(c.invite, 'Can you beat 42.8% in 10 minutes?');
  const t = texts(rush);
  for (const v of ['ATLAS', 'Canada', '42.8%', '140', '14.5M', SITE]) assert.ok(t.includes(v), v);
  assert.match(c.alt, /Canada: 42\.8% city population coverage\. 140 cities named/);
});

test('City Explorer shows time explored, not a clock length', () => {
  const c = cardContent({ ...rush, durationMs: null, elapsedMs: 754_000 });
  assert.equal(c.eyebrow, 'CITY EXPLORER');
  assert.deepEqual(c.stats[2], { value: '12:34', label: 'exploring' });
  assert.equal(c.invite, 'How much of Canada can you name?');
});

test('a round card shows the score, first-try answers and a strip of every answer', () => {
  const c = cardContent(sprint);
  assert.equal(c.eyebrow, 'SPRINT · FIND IT');
  assert.equal(c.big, '1,250');
  assert.equal(c.bigLabel, 'points of 1,400');
  assert.deepEqual(c.stats.map(s => s.value), ['7/10', '3', '1:14']);
  assert.equal(c.strip!.length, 10);
  assert.equal(new Set(c.strip).size, 3);
  // A Full challenge of 54 countries has no strip (too many squares), but the same numbers.
  assert.equal(cardContent({ ...sprint, sprint: false, total: 54, strip: Array(54).fill('first') }).strip, null);
  // A Regions round names the country's own units.
  assert.equal(cardContent({ ...sprint, regions: true, units: 'provinces and territories', place: 'Canada', iso2: 'CA' }).eyebrow, 'SPRINT · PROVINCES AND TERRITORIES · FIND IT');
});

test('a mystery card never names the answer', () => {
  const c = cardContent(mystery);
  assert.equal(c.big, '5');
  assert.equal(c.place, 'Mystery solved');
  assert.equal(c.iso2, null);
  assert.equal(c.invite, 'Can you solve one in fewer than 5?');
  assert.equal(c.strip!.length, 5);
});

test('long names wrap to two lines inside the column, and the invitation shortens', () => {
  const long: ShareResult = { ...rush, durationMs: null, place: 'Saint Vincent and the Grenadines', iso2: 'VC' };
  const l = layoutCard(cardContent(long), measure, SITE);
  const place = l.texts.filter(t => t.font.family === 'display' && t.font.weight === 600 && t.y > 190 && t.y < 300);
  assert.equal(place.length, 2);
  assert.equal(place.map(t => t.text).join(' '), 'Saint Vincent and the Grenadines');
  for (const t of l.texts) assert.ok(measure(t.text, `${t.font.size}px`) <= CARD.column + 60, `${t.text} fits`);
  assert.ok(l.texts.some(t => t.text === 'How much can you name?'));
  // Everything stays on the card.
  for (const t of l.texts) assert.ok(t.y > 0 && t.y < CARD.h, t.text);
});

test('wrapText never exceeds its lines and ends with an ellipsis when it must', () => {
  const font = '40px';
  assert.deepEqual(wrapText('Canada', 300, measure, font, 2), ['Canada']);
  const w = wrapText('The Democratic Republic of the Congo and some more words', 300, measure, font, 2);
  assert.equal(w.length, 2);
  assert.ok(w[1].endsWith('…'));
  for (const line of w) assert.ok(measure(line, font) <= 300);
});

test('the shared text names the result, the dare and the link, with no emoji', () => {
  const m = shareMessage(cardContent(rush), 'https://atlasxp.netlify.app/?rush=CAN&t=600&beat=42.8');
  assert.equal(m, 'ATLAS · Canada\n42.8% city population coverage · Classic Rush · 10 Minutes\nCan you beat 42.8% in 10 minutes?\nhttps://atlasxp.netlify.app/?rush=CAN&t=600&beat=42.8');
  assert.ok(!/\p{Extended_Pictographic}/u.test(m));
});
