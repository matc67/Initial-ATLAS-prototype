// Checks every country in the built subdivision data (public/data/admin1) the same way, so a new country is validated by
// its data alone; then the United States in detail. Canada's own detailed checks are in subdivisions.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import { feature } from 'topojson-client';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { PROFILES, validateProfile } from './admin1Profiles.ts';
import { decodeSubdivisions, describeCount, isPlayable, neighboursOf, playableIds, subdivisionPlayables, type SubdivisionIndex, type SubdivisionSet } from './subdivisions.ts';
import { distanceKm, type LngLat } from '../game/geo.ts';
import { versionOf } from '../game/challenges.ts';
import { nameMatches, normalize } from '../game/names.ts';

const read = (f: string) => readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8');
const index = JSON.parse(read('admin1/index.json')) as SubdivisionIndex;
const countryTopo = JSON.parse(read('countries.topo.json')) as Topology<{ countries: GeometryCollection }>;
const countryShapes = (feature(countryTopo, countryTopo.objects.countries) as FeatureCollection).features;
const country = (id: string) => countryShapes.find(f => f.properties?.id === id) as GeoJSON.Feature<Polygon | MultiPolygon>;
const topos = Object.fromEntries(Object.entries(index.countries).map(([id, meta]) => [id, JSON.parse(read(meta.file))]));
const sets: { [id: string]: SubdivisionSet } = Object.fromEntries(Object.entries(index.countries).map(([id, meta]) => [id, decodeSubdivisions(id, meta, topos[id])]));
const ids = Object.keys(index.countries);
const at = (set: SubdivisionSet, p: LngLat) => set.units.features.filter(u => turf.booleanPointInPolygon(p, u)).map(u => u.properties.code);

test('every country: the profile and the built file agree, with stable ids and the declared counts', () => {
  assert.ok(ids.includes('CAN') && ids.includes('USA'));
  for (const id of ids) {
    const p = PROFILES.find(x => x.country === id)!, set = sets[id], meta = index.countries[id];
    assert.deepEqual(validateProfile(p, Object.keys(p.units)), [], id);
    const units = set.units.features;
    assert.equal(units.length, Object.keys(p.units).length, id);
    for (const u of units) {
      assert.equal(u.properties.id, `admin1:${id}:${u.properties.code}`);
      assert.equal(u.properties.country, id);
      assert.ok(u.properties.name && u.properties.kind && u.properties.km2 > 0, u.properties.id);
      assert.ok(['Polygon', 'MultiPolygon'].includes(u.geometry.type));
    }
    assert.equal(new Set(units.map(u => u.properties.id)).size, units.length, `${id}: duplicate ids`);
    // The index counts playable units only, and record keys follow exactly those.
    assert.equal(meta.count, playableIds(set).length, id);
    assert.equal(meta.unitsVersion, versionOf(playableIds(set)), id);
    for (const [kind, n] of Object.entries(p.expect ?? {})) assert.equal(meta.kinds[kind], n, `${id} ${kind}`);
    assert.deepEqual((meta.others ?? []).map(o => o.id), units.filter(u => !isPlayable(u)).map(u => u.properties.id));
    assert.deepEqual(meta.flags, [], `${id} has build flags to review`);
  }
});

test('every country: names and aliases match exactly one unit', () => {
  for (const id of ids) {
    const all = sets[id].units.features.flatMap(u => [u.properties.name, ...u.properties.aliases].map(n => [normalize(n), u.properties.code] as const));
    for (const [n, code] of all) assert.ok(!all.some(([m, c]) => m === n && c !== code), `${id}: "${n}" is ambiguous`);
  }
});

test('every country: units cover the country map exactly, without holes or overlaps, and inside its bounds', () => {
  for (const id of ids) {
    const units = sets[id].units.features, shape = country(id);
    const total = units.reduce((n, u) => n + turf.area(u), 0), area = turf.area(shape);
    assert.ok(Math.abs(total - area) / area < 0.0005, `${id}: units ${total / 1e6} km² vs country ${area / 1e6} km²`);
    for (const u of units) for (const p of u.geometry.type === 'Polygon' ? [u.geometry.coordinates] : u.geometry.coordinates) assert.equal(p.length, 1, `${u.properties.id} has a hole`);
    let overlap = 0;
    neighboursOf(topos[id]).forEach((ns, i) => ns.filter(j => j > i).forEach(j => { const x = turf.intersect(turf.featureCollection([units[i], units[j]])); overlap += x ? turf.area(x) / 1e6 : 0; }));
    assert.ok(overlap < 1, `${id}: overlap ${overlap} km²`);
  }
});

test('every country: each unit is selectable at its label point, and neighbours never share a colour', () => {
  for (const id of ids) {
    const set = sets[id], units = set.units.features;
    for (const u of units) assert.deepEqual(at(set, u.properties.label), [u.properties.code], u.properties.id);
    neighboursOf(topos[id]).forEach((ns, i) => ns.filter(j => j !== i).forEach(j => assert.notEqual(units[i].properties.color, units[j].properties.color, `${units[i].properties.id}–${units[j].properties.id}`)));
  }
});

test('every country: 1 km either side of its internal borders lies in two different units', () => {
  for (const id of ids) {
    const set = sets[id], shape = country(id);
    let checked = 0;
    for (const line of set.borders.features.flatMap(f => f.geometry.coordinates)) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1] as LngLat, b = line[i] as LngLat, km = turf.distance(a, b);
        if (km < 3 || (km < 20 && i % 9)) continue;
        const mid = turf.midpoint(a, b), bearing = turf.bearing(a, b);
        const side = (d: number) => turf.destination(mid, 1, bearing + d).geometry.coordinates as LngLat;
        if (!turf.booleanPointInPolygon(side(90), shape) || !turf.booleanPointInPolygon(side(-90), shape)) continue;
        const [l, r] = [at(set, side(90)), at(set, side(-90))];
        assert.equal(l.length, 1, `${id} ${side(90)}`);
        assert.equal(r.length, 1, `${id} ${side(-90)}`);
        assert.notEqual(l[0], r[0], `${id}: both sides of the border at ${mid.geometry.coordinates} are ${l[0]}`);
        checked++;
      }
    }
    assert.ok(checked > 100, `${id}: only ${checked} border points checked`);
  }
});

test('every country: framing keeps every playable unit in view, and each unit frame holds its label', () => {
  for (const id of ids) {
    const meta = index.countries[id], set = sets[id];
    for (const u of set.units.features.filter(isPlayable)) {
      assert.ok(distanceKm(meta.frame.center, u.properties.label) <= meta.frame.radiusKm, `${u.properties.id} is outside ${id}'s frame`);
      assert.ok(distanceKm(u.properties.frame.center, u.properties.label) <= u.properties.frame.radiusKm, `${u.properties.id}'s label is outside its frame`);
    }
  }
});

// ---- United States ------------------------------------------------------------------------------------------------------
const us = sets.USA;
const USPS = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

test('United States: exactly the 50 states are played, under their USPS codes', () => {
  const meta = index.countries.USA;
  assert.deepEqual([meta.enabled, meta.count, meta.kinds], [true, 50, { State: 50 }]);
  assert.equal(describeCount(meta), '50 states');
  assert.deepEqual(playableIds(us).map(x => x.split(':')[2]).sort(), [...USPS].sort());
  for (const u of us.units.features.filter(isPlayable)) {
    assert.equal(u.properties.kind, 'State');
    assert.equal(u.properties.src.iso, `US-${u.properties.code}`);
    assert.match(u.properties.src.wikidata ?? '', /^Q\d+$/);
  }
});

test('United States: Washington, DC is drawn and named, never asked; territories are not part of it', () => {
  const dc = us.byId.get('admin1:USA:DC')!;
  assert.deepEqual([dc.properties.name, dc.properties.kind, dc.properties.playable], ['District of Columbia', 'Federal district', false]);
  assert.ok(dc.properties.note && /not a state/.test(dc.properties.note));
  assert.deepEqual(index.countries.USA.others?.map(o => o.id), ['admin1:USA:DC']);
  // Never a round target, so never in a challenge or its records key.
  assert.ok(!subdivisionPlayables(us).has('admin1:USA:DC'));
  assert.ok(!playableIds(us).includes('admin1:USA:DC'));
  // Its land is its own, not Maryland's or Virginia's.
  assert.deepEqual(at(us, [-77.0365, 38.8977]), ['DC']);       // the White House
  assert.deepEqual(at(us, [-77.0910, 38.8816]), ['VA']);       // Arlington
  assert.deepEqual(at(us, [-76.9378, 38.9897]), ['MD']);       // College Park
  // "Washington" is the state; the district only answers to its own names.
  const places = subdivisionPlayables(us);
  assert.ok(nameMatches(places.get('admin1:USA:WA')!, 'Washington'));
  assert.ok(![...places.values()].some(p => nameMatches(p, 'Washington, DC') || nameMatches(p, 'District of Columbia')));
  // Puerto Rico and the other territories are outside the United States' country shape, so in no unit.
  for (const p of [[-66.1, 18.4], [144.79, 13.45], [-64.93, 18.34], [-170.7, -14.28], [145.75, 15.19]] as LngLat[]) assert.deepEqual(at(us, p), [], `${p}`);
});

test('United States: places land in the right state, Alaska, Hawaii and islands included', () => {
  const places: [string, LngLat, string][] = [
    ['Anchorage', [-149.9, 61.22], 'AK'], ['Juneau, Mendenhall Valley', [-134.55, 58.38], 'AK'], ['Fairbanks', [-147.72, 64.84], 'AK'], ['Kodiak Island', [-153.5, 57.5], 'AK'],
    ['Unalaska, Aleutians', [-166.8, 53.85], 'AK'], ['Adak, Aleutians', [-176.65, 51.88], 'AK'], ['Attu, across 180°', [173.2, 52.9], 'AK'], ['Utqiaġvik', [-156.79, 71.29], 'AK'],
    ['Honolulu, Oʻahu', [-157.86, 21.31], 'HI'], ['Hilo, Big Island', [-155.09, 19.72], 'HI'], ['Kauaʻi', [-159.5, 22.05], 'HI'], ['Maui', [-156.33, 20.8], 'HI'],
    ['Key West', [-81.78, 24.556], 'FL'], ['Miami', [-80.3, 25.8], 'FL'], ['Nantucket', [-70.1, 41.28], 'MA'], ["Martha's Vineyard", [-70.6, 41.4], 'MA'],
    ['Long Island', [-73.2, 40.8], 'NY'], ['Manhattan', [-73.97, 40.78], 'NY'], ['Jersey City', [-74.07, 40.72], 'NJ'], ['Upper Peninsula', [-87.4, 46.5], 'MI'],
    ['Outer Banks, Kitty Hawk', [-75.738, 36.141], 'NC'], ['Providence', [-71.41, 41.82], 'RI'], ['Block Island', [-71.58, 41.17], 'RI'], ['Dover', [-75.52, 39.16], 'DE'],
    ['Kansas City, Missouri', [-94.55, 39.1], 'MO'], ['Kansas City, Kansas', [-94.75, 39.11], 'KS'], ['Lake of the Woods, Northwest Angle', [-95.1, 49.35], 'MN'],
    ['San Francisco', [-122.42, 37.77], 'CA'], ['Seattle', [-122.33, 47.61], 'WA'], ['San Juan Island', [-123.071, 48.537], 'WA'], ['Galveston', [-94.8, 29.3], 'TX'],
    ['Cumberland Island', [-81.45, 30.85], 'GA'], ['Mackinac Island', [-84.62, 45.85], 'MI'], ['New Orleans', [-90.07, 29.95], 'LA'], ['Denver', [-104.99, 39.74], 'CO'],
  ];
  for (const [name, p, code] of places) assert.deepEqual(at(us, p), [code], name);
});

test('United States: straight borders, the Four Corners and the 49th parallel', () => {
  const pairs: [LngLat, string, LngLat, string][] = [
    [[-109.07, 37.5], 'UT', [-109.03, 37.5], 'CO'], [[-109.07, 34], 'AZ', [-109.03, 34], 'NM'],
    [[-108.5, 37.02], 'CO', [-108.5, 36.98], 'NM'], [[-110.5, 37.02], 'UT', [-110.5, 36.98], 'AZ'],
    [[-100, 40.02], 'NE', [-100, 39.98], 'KS'], [[-104.07, 44], 'WY', [-104.03, 44], 'SD'], [[-100, 45.96], 'ND', [-100, 45.92], 'SD'],
    [[-114.06, 42.02], 'ID', [-114.06, 41.98], 'NV'], [[-120.02, 39.5], 'CA', [-119.98, 39.5], 'NV'],
    [[-141.03, 65], 'AK', [-140.97, 65], null as unknown as string],   // Alaska–Yukon: the far side is Canada, in no US unit
  ];
  for (const [a, ca, b, cb] of pairs) {
    assert.deepEqual(at(us, a), [ca], `${a} should be ${ca}`);
    assert.deepEqual(at(us, b), cb ? [cb] : [], `${b} should be ${cb ?? 'outside the United States'}`);
  }
});

test('United States: dispersed framing; Hawaii framed on its main islands, the country across 180°', () => {
  const meta = index.countries.USA;
  assert.ok(meta.bounds[0] > 170 && meta.bounds[2] > 180, 'the bounds cross 180° (the western Aleutians)');
  const hi = us.byId.get('admin1:USA:HI')!.properties.frame;
  // Not stretched 2,000 km west by the Northwestern Hawaiian Islands (a few km² of land).
  assert.ok(hi.radiusKm < 400 && Math.abs(hi.center[0] + 157.5) < 1.5, JSON.stringify(hi));
  // The far-flung islets still belong to Hawaii, and are drawn and clickable.
  assert.deepEqual(at(us, turf.centroid(turf.flatten(us.byId.get('admin1:USA:HI')!).features.find(f => turf.centroid(f).geometry.coordinates[0] < -170)!).geometry.coordinates as LngLat), ['HI']);   // Laysan Island, 1,600 km northwest
  assert.ok(us.byId.get('admin1:USA:RI')!.properties.frame.radiusKm < 80);
});

test('profiles: a unit left out of the challenges needs a note, and declared counts are enforced', () => {
  const p = PROFILES.find(x => x.country === 'USA')!, keys = Object.keys(p.units);
  const noNote = { ...p, units: { ...p.units, 'US-DC': { ...p.units['US-DC'], note: undefined } } };
  assert.match(validateProfile(noNote, keys).join(), /DC: a unit left out of the challenges needs a note/);
  const { ['US-WY']: _, ...fortyNine } = p.units;
  assert.match(validateProfile({ ...p, units: fortyNine, exclude: { 'US-WY': 'test' } }, keys).join(), /expected 50 playable State units, found 49/);
});
