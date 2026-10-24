import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ancestors, baseEntities, cityEntity, continentId, countryEntityId, indexEntities, WORLD_ID } from './entities.ts';
import type { PlacesFile } from './places.ts';
import { ROSTER } from './roster.ts';
import { matchCities } from '../game/names.ts';

const places = JSON.parse(readFileSync(new URL('../../public/data/places.json', import.meta.url), 'utf8')) as PlacesFile;

test('every entity id is unique and every parent exists', () => {
  const all = [...baseEntities(), ...Object.values(places.countries).flatMap(p => p.cities.map(cityEntity))];
  const index = indexEntities(all);
  assert.equal(index.size, all.length);
  for (const e of all) if (e.id !== WORLD_ID) assert.ok(index.has(e.parentId ?? ''), `${e.id} has no parent ${e.parentId}`);
  assert.equal(all.filter(e => e.type === 'country').length, ROSTER.length);
});

test('ids are stable and the hierarchy runs city → country → continent → world', () => {
  const ottawa = places.countries.CAN.cities.find(c => c.name === 'Ottawa')!;
  const index = indexEntities([...baseEntities(), cityEntity(ottawa)]);
  assert.match(cityEntity(ottawa).id, /^city:ne:\d+$/);
  assert.deepEqual(ancestors(cityEntity(ottawa).id, index).map(e => e.id), [countryEntityId('CAN'), continentId('North America'), WORLD_ID]);
  assert.equal(index.get(countryEntityId('JPN'))?.parentId, 'continent:asia');
});

test('every country has a capital or a note explaining why none is listed', () => {
  for (const r of ROSTER) {
    const p = places.countries[r.id];
    assert.ok(p, `${r.id} missing from places.json`);
    assert.ok(p.cities.some(c => c.capital) || p.note, `${r.id} has no capital and no note`);
    for (const c of p.cities) assert.equal(c.country, r.id);
  }
  assert.deepEqual(places.countries.ZAF.cities.filter(c => c.capital).map(c => c.capital), ['executive', 'legislative', 'judicial']);
  assert.ok(!places.countries.FRA.cities.some(c => c.lng < -11), 'France lists only its European cities');
});

test('city names match in context: accents, aliases, and no cross-country matches', () => {
  const canada = places.countries.CAN.cities;
  assert.deepEqual(matchCities('montreal', canada).map(c => c.name), ['Montréal']);
  assert.deepEqual(matchCities('  TORONTO ', canada).map(c => c.name), ['Toronto']);
  assert.deepEqual(matchCities('Paris', canada), []);
  assert.deepEqual(matchCities('', canada), []);
  // The same name in two places is returned twice, so the caller can treat it as ambiguous.
  const twins = [{ name: 'Victoria', aliases: [] }, { name: 'Victoria', aliases: [] }];
  assert.equal(matchCities('victoria', twins).length, 2);
});
