import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARKER_REACH_PX, markerActive, resolvePick, ringRadiusAt, type PickInput } from './pick.ts';

const base: PickInput = { land: null, landIsSmall: false, halo: null, markers: [], ringRadius: 6, reach: MARKER_REACH_PX };
const pick = (p: Partial<PickInput>) => resolvePick({ ...base, ...p });

test('plain land and plain ocean', () => {
  assert.deepEqual(pick({ land: 'GIN' }), { kind: 'country', id: 'GIN' });
  assert.deepEqual(pick({}), { kind: 'none' });
});

test('a visible ring wins over the big country underneath it (Vatican City over Italy)', () => {
  assert.deepEqual(pick({ land: 'ITA', markers: [{ id: 'VAT', px: 3 }] }), { kind: 'country', id: 'VAT' });
});

test('near a ring’s edge over another country’s land, the click is too close to call (Qatar under Bahrain’s ring)', () => {
  assert.deepEqual(pick({ land: 'QAT', markers: [{ id: 'BHR', px: 4.5 }] }), { kind: 'ambiguous', ids: ['BHR', 'QAT'] });
  // At the ring's centre it is the ring; over the sea, the whole ring counts.
  assert.deepEqual(pick({ land: 'QAT', markers: [{ id: 'BHR', px: 2 }] }), { kind: 'country', id: 'BHR' });
  assert.deepEqual(pick({ markers: [{ id: 'BHR', px: 5 }] }), { kind: 'country', id: 'BHR' });
});

test('outside the visible ring, a neighbour’s actual land is never taken by a ring’s reach', () => {
  assert.deepEqual(pick({ land: 'ITA', markers: [{ id: 'VAT', px: 10 }] }), { kind: 'country', id: 'ITA' });
  // Over the sea, the reach still helps.
  assert.deepEqual(pick({ markers: [{ id: 'NRU', px: 12 }] }), { kind: 'country', id: 'NRU' });
  assert.deepEqual(pick({ markers: [{ id: 'NRU', px: MARKER_REACH_PX + 1 }].filter(m => m.px <= MARKER_REACH_PX) }), { kind: 'none' });
});

test('a small country’s own land always wins, even under a neighbour’s ring', () => {
  assert.deepEqual(pick({ land: 'LCA', landIsSmall: true, markers: [{ id: 'VCT', px: 2 }, { id: 'LCA', px: 5 }] }), { kind: 'country', id: 'LCA' });
});

test('a halo counts over water but never over another country’s land (Singapore beside Johor)', () => {
  assert.deepEqual(pick({ halo: 'SGP' }), { kind: 'country', id: 'SGP' });
  assert.deepEqual(pick({ land: 'MYS', halo: 'SGP' }), { kind: 'country', id: 'MYS' });
});

test('the nearest ring wins; rings too close to call are reported, not guessed', () => {
  assert.deepEqual(pick({ markers: [{ id: 'KNA', px: 2 }, { id: 'ATG', px: 9 }] }), { kind: 'country', id: 'KNA' });
  assert.deepEqual(pick({ markers: [{ id: 'KNA', px: 4 }, { id: 'ATG', px: 5 }] }), { kind: 'ambiguous', ids: ['KNA', 'ATG'] });
  // The same input in a different order gives the same answer.
  assert.deepEqual(pick({ markers: [{ id: 'ATG', px: 5 }, { id: 'KNA', px: 4 }] }), { kind: 'ambiguous', ids: ['KNA', 'ATG'] });
});

test('ring sizes follow the zoom; rings take clicks until zoom 6.5', () => {
  assert.equal(ringRadiusAt(1), 5.5);
  assert.equal(ringRadiusAt(5), 8);
  assert.equal(ringRadiusAt(9), 8);
  assert.equal(markerActive(4), true);
  assert.equal(markerActive(6), true);
  assert.equal(markerActive(7), false);
});
