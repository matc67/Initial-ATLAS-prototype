import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEEDBACK } from './feedback.ts';
import { AREAS } from '../data/countries.ts';
import { ROSTER } from '../data/roster.ts';
import { normalize } from './names.ts';

test('no Play-mode message can name a country', () => {
  // The area being played is named on purpose; take it out before looking for country names ("America" is an alias of
  // the United States, and "North America" is not a clue).
  const messages = [FEEDBACK.wrong, FEEDBACK.ocean, FEEDBACK.notInGame, FEEDBACK.notInSet, FEEDBACK.tooClose,
    ...AREAS.map(a => FEEDBACK.outsideArea(a === 'World' ? 'The World' : a).replace(a, ''))];
  const names = ROSTER.flatMap(r => [r.name, ...r.aliases]).map(normalize);
  for (const m of messages) {
    const text = ` ${normalize(m)} `;
    const hit = names.find(n => text.includes(` ${n} `));
    assert.equal(hit, undefined, `“${m}” contains “${hit}”`);
  }
  assert.equal(FEEDBACK.wrong, 'Incorrect — try again.');
});
