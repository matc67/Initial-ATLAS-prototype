// Phase 4: Explore navigation for regions, and region records for Explore and Progress. Phase 5: the United States.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { subdivisionChallenge, subdivisionKey, versionOf } from './challenges.ts';
import { afterRound, backToCountry, clickCountry, clickNothing, hasRegions, openRegions, selectRegion, toWorld, WORLD } from './exploreNav.ts';
import { addRun, perfKey, toGameRun } from './records.ts';
import { completedCount, regionRecords, statusOf } from './regionRecords.ts';
import { FEEDBACK } from './feedback.ts';
import { nameMatches, normalize } from './names.ts';
import { guess, maxScoreFor, newRound, statsOf } from './scoring.ts';
import { CATALOG } from './stats.ts';
import { decodeSubdivisions, playableIds, subdivisionPlayables, type SubdivisionIndex } from '../data/subdivisions.ts';

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

// ---- Phase 5: the United States on the same systems, from its data alone ----------------------------------------------
const usa = decodeSubdivisions('USA', index.countries.USA, read(index.countries.USA.file));
const usIds = playableIds(usa);

test('United States: Find and Name the State, Sprint and all 50, with records apart from Canada and from countries', () => {
  const rows = regionRecords({}, 'USA', index.countries.USA);
  assert.deepEqual(rows.map(x => [x.mode, x.kind, x.size, x.maxScore]), [
    ['find', 'sprint', 10, 1400], ['find', 'full', 50, maxScoreFor(50)], ['name', 'sprint', 10, 1400], ['name', 'full', 50, maxScoreFor(50)],
  ]);
  const canKeys = new Set(regionRecords({}, 'CAN', index.countries.CAN).map(x => x.key));
  for (const x of rows) { assert.ok(!canKeys.has(x.key)); assert.ok(!CATALOG.some(c => c.key === x.key)); assert.match(x.key, /^usa-admin1-/); }
  // The game builds the same keys as Progress, from the 50 states (never Washington, DC).
  for (const mode of ['find', 'name'] as const) for (const kind of ['sprint', 'full'] as const) {
    const c = subdivisionChallenge('USA', 'United States', mode, kind, usIds);
    assert.equal(perfKey(c), subdivisionKey('USA', mode, kind, index.countries.USA.unitsVersion));
    assert.ok(!c.targetIds.includes('admin1:USA:DC'));
  }
  assert.equal(usIds.length, 50);
});

test('United States: a perfect 50-state run, and typed names', () => {
  let r = newRound(usIds, 0);
  usIds.forEach((id, i) => { r = guess(r, id, (i + 1) * 1000).round; });
  const s = statsOf(r, 50_000);
  assert.deepEqual([s.score, s.maxScore, s.perfect], [maxScoreFor(50), maxScoreFor(50), true]);
  const places = subdivisionPlayables(usa), p = (code: string) => places.get(`admin1:USA:${code}`)!;
  for (const [code, typed] of [['NY', 'new york'], ['NY', 'New York State'], ['HI', 'Hawaiʻi'], ['HI', 'hawaii'], ['WA', 'Washington'], ['WV', 'west virginia'], ['MA', 'Commonwealth of Massachusetts']]) assert.ok(nameMatches(p(code), typed), typed);
  // Two-letter postal codes are not names, and the federal district is never an answer.
  for (const typed of ['NY', 'CA', 'Washington DC', 'District of Columbia', 'Puerto Rico', 'Virginia Beach']) assert.ok(![...places.values()].some(u => nameMatches(u, typed)), typed);
});

test('United States: the note for Washington, DC in a round names nothing', () => {
  const note = FEEDBACK.units.notPlayed(index.countries.USA.count, index.countries.USA.terms.plural);
  assert.equal(note, 'That is not one of the 50 states in this game.');
  const names = usa.units.features.flatMap(u => [u.properties.name, ...u.properties.aliases]).map(normalize);
  assert.ok(!names.some(n => ` ${normalize(note)} `.includes(` ${n} `)));
});

test('Explore navigation works the same for the United States, and between two countries with regions', () => {
  const n = selectRegion(openRegions(WORLD, 'USA'), 'admin1:USA:HI');
  assert.deepEqual(n, { country: 'USA', regions: { country: 'USA', unit: 'admin1:USA:HI' } });
  // Washington, DC can be selected in Explore (it is named there), though it is never asked.
  assert.equal(selectRegion(n, 'admin1:USA:DC').regions?.unit, 'admin1:USA:DC');
  assert.deepEqual(clickCountry(n, 'CAN'), { country: 'CAN', regions: null });
  assert.deepEqual(openRegions(clickCountry(n, 'CAN'), 'CAN'), afterRound('CAN'));
  assert.equal(hasRegions(index, 'USA'), true);
});
