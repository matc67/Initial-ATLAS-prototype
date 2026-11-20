// City Rush region borders: which countries have them, the player's toggle, and what the globe is given (from the same
// reviewed files as the Regions game).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeSubdivisions, type SubdivisionIndex } from '../data/subdivisions.ts';
import { REGIONS_KEY, loadShowRegions, regionsAvailable, regionsShown, rushRegionsOf, saveShowRegions } from './rushRegions.ts';

const dir = new URL('../../public/data/admin1/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) as SubdivisionIndex;
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

test('borders are available exactly for countries with reviewed subdivision files', () => {
  for (const id of ['CAN', 'USA', 'AUS', 'BRA', 'DEU', 'FRA', 'IND', 'JPN', 'MEX', 'NGA']) assert.equal(regionsAvailable(index, id), true, id);
  for (const id of ['GBR', 'CHN', 'ITA', 'SGP']) assert.equal(regionsAvailable(index, id), false, `${id}: nothing is approximated`);
  assert.equal(regionsAvailable(null, 'CAN'), false, 'before the index loads');
  assert.equal(regionsAvailable(index, null), false);
  assert.equal(regionsAvailable({ countries: { ...index.countries, CAN: { ...index.countries.CAN, enabled: false } } }, 'CAN'), false);
});

test('the toggle is on by default, remembered, and never draws what is not there', () => {
  const s = new MemoryStorage();
  assert.equal(loadShowRegions(s), true);
  saveShowRegions(false, s);
  assert.equal(s.getItem(REGIONS_KEY), 'off');
  assert.equal(loadShowRegions(s), false);
  saveShowRegions(true, s);
  assert.equal(loadShowRegions(s), true);
  assert.equal(loadShowRegions(null), true);
  assert.equal(regionsShown(true, true), true);
  assert.equal(regionsShown(false, true), false);
  assert.equal(regionsShown(true, false), false);
});

test('Canada: all 13 provinces and territories, named, with their internal borders', () => {
  const meta = index.countries.CAN;
  const set = decodeSubdivisions('CAN', meta, JSON.parse(readFileSync(new URL('CAN.topo.json', dir), 'utf8')));
  const r = rushRegionsOf(set);
  assert.equal(r.labels.length, 13);
  const names = r.labels.map(l => l.name);
  for (const n of ['Ontario', 'Quebec', 'Alberta', 'British Columbia', 'Nunavut', 'Yukon', 'Northwest Territories', 'Prince Edward Island']) assert.ok(names.includes(n), n);
  assert.ok(r.borders.features.length > 0, 'internal borders');
  for (const l of r.labels) {
    const [w, s, e, n] = l.box;
    assert.ok(w < e && s < n, `${l.name} extent`);
    assert.ok(l.at[0] >= w - 1 && l.at[0] <= e + 1 && l.at[1] >= s - 1 && l.at[1] <= n + 1, `${l.name} label inside its extent`);
  }
});
