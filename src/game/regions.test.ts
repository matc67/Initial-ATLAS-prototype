// Phase 4: Explore navigation for regions, and region records for Explore and Progress.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { subdivisionChallenge, subdivisionKey, versionOf } from './challenges.ts';
import { afterRound, backToCountry, clickCountry, clickNothing, hasRegions, openRegions, selectRegion, toWorld, WORLD } from './exploreNav.ts';
import { addRun, perfKey, toGameRun } from './records.ts';
import { completedCount, regionRecords, statusOf } from './regionRecords.ts';
import { guess, newRound } from './scoring.ts';
import { CATALOG } from './stats.ts';
import { decodeSubdivisions, type SubdivisionIndex } from '../data/subdivisions.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
const index = read('admin1/index.json') as SubdivisionIndex;
const can = decodeSubdivisions('CAN', index.countries.CAN, read(index.countries.CAN.file));
const ids = can.units.features.map(u => u.properties.id);

test('Explore: world → country → regions → a region → back, as the player clicks', () => {
  let n = clickCountry(WORLD, 'CAN');
  assert.deepEqual(n, { country: 'CAN', regions: null });
  n = openRegions(n, 'CAN');
  assert.deepEqual(n, { country: 'CAN', regions: { country: 'CAN', unit: null } });
  n = selectRegion(n, 'admin1:CAN:ON');
  assert.equal(n.regions?.unit, 'admin1:CAN:ON');
  // Clicking it again in the list clears it; on the globe it stays selected.
  assert.equal(selectRegion(n, 'admin1:CAN:ON', true).regions?.unit, null);
  assert.equal(selectRegion(n, 'admin1:CAN:ON').regions?.unit, 'admin1:CAN:ON');
  // The ocean clears the region and stays in the regions view, with the country still selected.
  assert.deepEqual(clickNothing(n), { country: 'CAN', regions: { country: 'CAN', unit: null } });
  // A click on the same country (a gap between regions) changes nothing.
  assert.equal(clickCountry(n, 'CAN'), n);
  // Back to the country's panel, still selected; or out to the world.
  assert.deepEqual(backToCountry(n), { country: 'CAN', regions: null });
  assert.deepEqual(toWorld(n), WORLD);
});

test('Explore: another country leaves the regions view and opens that country; the ocean closes a country', () => {
  const inRegions = selectRegion(openRegions(WORLD, 'CAN'), 'admin1:CAN:QC');
  assert.deepEqual(clickCountry(inRegions, 'USA'), { country: 'USA', regions: null });
  assert.deepEqual(clickNothing({ country: 'USA', regions: null }), WORLD);
  // After a regions round (× or "Back to Canada"): that country's regions, nothing selected.
  assert.deepEqual(afterRound('CAN'), { country: 'CAN', regions: { country: 'CAN', unit: null } });
  // Opening regions from another country's panel moves there.
  assert.deepEqual(openRegions({ country: 'USA', regions: null }, 'CAN'), { country: 'CAN', regions: { country: 'CAN', unit: null } });
});

test('which countries show regions: data that is enabled; development builds also show the rest', () => {
  const idx = { countries: { CAN: { enabled: true }, XYZ: { enabled: false } } };
  assert.equal(hasRegions(idx, 'CAN'), true);
  assert.equal(hasRegions(idx, 'XYZ'), false);
  assert.equal(hasRegions(idx, 'XYZ', true), true);
  assert.equal(hasRegions(idx, 'FRA'), false);    // no data: the panel shows "not available yet"
  assert.equal(hasRegions(null, 'CAN'), false);   // index not loaded (or failed): nothing is offered
  assert.equal(hasRegions(index, 'CAN'), true);
});

test("the index's unit-list fingerprint matches the built file, so record keys match the game's", () => {
  assert.equal(index.countries.CAN.unitsVersion, versionOf(ids));
  for (const mode of ['find', 'name'] as const) for (const kind of ['sprint', 'full'] as const) {
    assert.equal(subdivisionKey('CAN', mode, kind, index.countries.CAN.unitsVersion), perfKey(subdivisionChallenge('CAN', 'Canada', mode, kind, ids)));
  }
});

test('region records: per country, mode and length, with best score, time, accuracy and completion', () => {
  const meta = index.countries.CAN;
  // One completed Find the Region Sprint.
  const c = subdivisionChallenge('CAN', 'Canada', 'find', 'sprint', ids);
  let r = newRound(ids.slice(0, 10), 0);
  ids.slice(0, 10).forEach((id, i) => { r = guess(r, id, (i + 1) * 1000).round; });
  const store = { [perfKey(c)]: addRun(undefined, toGameRun(r, c, 10_000)).performance };
  const rows = regionRecords(store, 'CAN', meta);
  assert.deepEqual(rows.map(x => [x.mode, x.kind, x.size, x.maxScore, !!x.performance]), [
    ['find', 'sprint', 10, 1400, true], ['find', 'full', 13, 1700, false],
    ['name', 'sprint', 10, 1400, false], ['name', 'full', 13, 1700, false],
  ]);
  const best = rows[0].performance!;
  assert.deepEqual([best.bestScore, best.bestAccuracy, best.fastestMs], [1400, 100, 10_000]);
  assert.equal(statusOf(rows[0]), 'Completed 1 time · 1 perfect');
  assert.equal(statusOf(rows[1]), 'Not played yet');
  assert.equal(completedCount(rows), 1);
  // Keys carry the scoring version and never collide with country records.
  for (const x of rows) { assert.match(x.key, /\.sc2$/); assert.ok(!CATALOG.some(cc => cc.key === x.key)); }
  // A record for a different list of regions (an older build) is kept in the store but not shown as current.
  const old = { [subdivisionKey('CAN', 'find', 'sprint', '12-old')]: store[perfKey(c)] };
  assert.equal(regionRecords(old, 'CAN', meta).filter(x => x.performance).length, 0);
});

test('a country with fewer than 10 regions offers only the full challenges', () => {
  const rows = regionRecords({}, 'XYZ', { count: 7, unitsVersion: '7-abc' });
  assert.deepEqual(rows.map(x => [x.mode, x.kind, x.size]), [['find', 'full', 7], ['name', 'full', 7]]);
});
