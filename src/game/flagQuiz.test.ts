// Flags mode: the country round engine with a flag as the question, its own records, and the look-alike flags.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GAME_MODES, countryChallenge, interactionOf, sprintChallenge } from './challenges.ts';
import { FEEDBACK } from './feedback.ts';
import { FLAG_TWINS, flagTwinOf, isFlagTwin } from './flagQuiz.ts';
import { normalize } from './names.ts';
import { perfKey } from './records.ts';
import { guess, newRound, statsOf } from './scoring.ts';
import { CATALOG, recordsFor } from './stats.ts';
import { ROSTER } from '../data/roster.ts';

const byId = new Map(ROSTER.map(r => [r.id, r]));

test('Flags is a third country mode: clicked on the globe, with its own challenge ids and records keys', () => {
  assert.deepEqual(GAME_MODES, ['find', 'name', 'flag']);
  assert.equal(interactionOf('flag'), 'map-click');
  const full = countryChallenge('World', '200', 'flag'), sprint = sprintChallenge('Europe', '195', 'flag');
  assert.deepEqual([full.id, full.size, full.interaction, full.name], ['world-countries-flag', 200, 'map-click', 'World flags']);
  assert.deepEqual([sprint.id, sprint.size, sprint.kind], ['europe-sprint-classic-flag', 10, 'sprint']);
  // The same countries as Find it, so the same list fingerprint, but never the same record.
  const find = countryChallenge('World', '200', 'find');
  assert.equal(full.version, find.version);
  assert.notEqual(perfKey(full), perfKey(find));
  // Progress lists a Flags record for every area, set and kind.
  const flagRefs = CATALOG.filter(c => c.mode === 'flag');
  assert.equal(flagRefs.length, 8 * 2 * 2);
  assert.ok(flagRefs.every(c => !CATALOG.some(o => o !== c && o.key === c.key)));
  assert.equal(recordsFor({}, { kind: 'sprint', mode: 'flag', set: '200' }).length, 8);
});

test('a Flags run is scored like any other: a perfect Sprint is 1,400', () => {
  const ids = countryChallenge('Africa', '200', 'flag').targetIds.slice(0, 10);
  let r = newRound(ids, 0);
  ids.forEach((id, i) => { r = guess(r, id, (i + 1) * 1000).round; });
  assert.equal(statsOf(r, 10_000).score, 1400);
});

test('look-alike flags pair real countries both ways, and only those pairs', () => {
  for (const [a, b] of FLAG_TWINS) {
    assert.ok(byId.get(a) && byId.get(b), `${a}/${b} not in the roster`);
    assert.equal(flagTwinOf(a), b); assert.equal(flagTwinOf(b), a);
    assert.ok(isFlagTwin(a, b) && isFlagTwin(b, a));
  }
  assert.equal(isFlagTwin('IDN', 'POL'), false);   // Poland is white over red: told apart at a glance
  assert.equal(isFlagTwin('IDN', 'IDN'), false);
  assert.equal(flagTwinOf('FRA'), undefined);
});

test('the twins really look alike in the artwork ATLAS shows: the same bands, colours within a shade', () => {
  const svg = (id: string) => readFileSync(new URL(`../../public/flags/${byId.get(id)!.iso2.toLowerCase()}.svg`, import.meta.url), 'utf8');
  // Each band's colour, in drawing position (by where its path starts), whatever order the file lists them in.
  const fills = (id: string) => [...svg(id).matchAll(/fill="(#[0-9a-f]{3,6})" d="M([\d.]+)[ ,]([\d.]+)/gi)]
    .sort((x, y) => Number(x[2]) - Number(y[2]) || Number(x[3]) - Number(y[3])).map(m => m[1].toLowerCase());
  const rgb = (h: string) => (h.length === 4 ? [...h.slice(1)].map(c => parseInt(c + c, 16)) : [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  for (const [a, b] of FLAG_TWINS) {
    const fa = fills(a), fb = fills(b);
    assert.ok(fa.length >= 2 && fa.length === fb.length, `${a}/${b}`);
    // Bands in the same order; each colour pair no further apart than 64 per channel.
    fa.forEach((c, i) => assert.ok(rgb(c).every((v, k) => Math.abs(v - rgb(fb[i])[k]) <= 64), `${a} ${c} vs ${b} ${fb[i]}`));
  }
});

test('the look-alike note never names the clicked country or its flag', () => {
  const names = ROSTER.flatMap(r => [r.name, ...r.aliases]).map(normalize);
  assert.ok(!names.some(n => ` ${normalize(FEEDBACK.sameFlag)} `.includes(` ${n} `)));
});
