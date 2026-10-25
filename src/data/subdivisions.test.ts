// Checks the built subdivision data in public/data/admin1 (run `npm run admin1` after changing a profile or the country
// data). Canada first: every unit, exact coverage of the country map, and places that must land in the right unit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import { feature } from 'topojson-client';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { PROFILES, validateProfile } from './admin1Profiles.ts';
import { decodeSubdivisions, describeCount, neighboursOf, type SubdivisionIndex } from './subdivisions.ts';
import { ROSTER } from './roster.ts';
import { boundsOf, frameOf, type LngLat } from '../game/geo.ts';
import { normalize } from '../game/names.ts';

const file = (f: string) => new URL(`../../public/data/${f}`, import.meta.url);
const read = (f: string) => readFileSync(file(f), 'utf8');
const index = JSON.parse(read('admin1/index.json')) as SubdivisionIndex;
const countryText = read('countries.topo.json');
const countryTopo = JSON.parse(countryText) as Topology<{ countries: GeometryCollection }>;
const country = (id: string) => (feature(countryTopo, countryTopo.objects.countries) as FeatureCollection).features.find(f => f.properties?.id === id) as GeoJSON.Feature<Polygon | MultiPolygon>;
const topoOf = (id: string) => JSON.parse(read(index.countries[id].file));
const canTopo = topoOf('CAN');
const can = decodeSubdivisions('CAN', index.countries.CAN, canTopo);
const units = can.units.features;
const at = (p: LngLat) => units.filter(u => turf.booleanPointInPolygon(p, u)).map(u => u.properties.code);
const rings = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat();

test('the index is built from the current country map and the pinned Natural Earth release', () => {
  assert.equal(index.countryData.sha256, createHash('sha256').update(countryText).digest('hex'), 'countries.topo.json changed since `npm run admin1`');
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(index.source.commit, manifest.sources[0].commit);
  assert.equal(index.source.licence, 'Public domain');
  for (const p of PROFILES) assert.ok(index.countries[p.country], `${p.country} is missing from the index`);
  for (const id of Object.keys(index.countries)) assert.ok(ROSTER.some(r => r.id === id), `${id} is not a roster country`);
});

test('Canada: 10 provinces and 3 territories with stable ids', () => {
  const meta = index.countries.CAN;
  assert.deepEqual([meta.enabled, meta.count, meta.kinds], [true, 13, { Province: 10, Territory: 3 }]);
  assert.equal(describeCount(meta), '10 provinces and 3 territories');
  assert.deepEqual(meta.flags, []);
  assert.equal(units.length, 13);
  assert.deepEqual(units.map(u => u.properties.code).sort(), ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
  for (const u of units) {
    const p = u.properties;
    assert.equal(p.id, `admin1:CAN:${p.code}`);
    assert.equal(p.src.iso, `CA-${p.code}`);   // the code is the ISO 3166-2 suffix
    assert.match(p.src.wikidata ?? '', /^Q\d+$/);
    assert.equal(p.src.ne.length, 1);
    assert.ok(['Province', 'Territory'].includes(p.kind));
    assert.equal(can.byId.get(p.id), u);
  }
  assert.equal(new Set(units.map(u => u.properties.id)).size, 13);
  const names = Object.fromEntries(units.map(u => [u.properties.code, u.properties.name]));
  assert.equal(names.QC, 'Quebec');
  assert.equal(names.NL, 'Newfoundland and Labrador');
  assert.equal(names.PE, 'Prince Edward Island');
  assert.deepEqual(units.filter(u => u.properties.kind === 'Territory').map(u => u.properties.code).sort(), ['NT', 'NU', 'YT']);
});

test('names and aliases: diacritics fold, and none names two units', () => {
  const all = units.flatMap(u => [u.properties.name, ...u.properties.aliases].map(n => [normalize(n), u.properties.code] as const));
  for (const [n, code] of all) assert.ok(!all.some(([m, c]) => m === n && c !== code), `"${n}" is ambiguous`);
  const find = (s: string) => [...new Set(all.filter(([n]) => n === normalize(s)).map(([, c]) => c))];
  assert.deepEqual(find('Québec'), ['QC']);
  assert.deepEqual(find('quebec'), ['QC']);
  assert.deepEqual(find('Terre-Neuve-et-Labrador'), ['NL']);
  assert.deepEqual(find('PEI'), ['PE']);
  // Historical names from Natural Earth's name_alt are not accepted.
  for (const old of ['Upper Canada', 'Lower Canada', 'Acadia', 'New Caledonia', 'Newfoundland']) assert.deepEqual(find(old), [], old);
});

test('the units cover the country map exactly: same area, no gaps or overlaps', () => {
  const shape = country('CAN');
  const total = units.reduce((n, u) => n + turf.area(u), 0), area = turf.area(shape);
  assert.ok(Math.abs(total - area) / area < 0.0005, `units ${total / 1e6} km² vs country ${area / 1e6} km²`);
  for (const u of units) for (const p of u.geometry.type === 'Polygon' ? [u.geometry.coordinates] : u.geometry.coordinates) assert.equal(p.length, 1, `${u.properties.code} has a hole`);
  // Overlaps between neighbours are at most a rounding sliver.
  const adj = neighboursOf(canTopo);
  let overlap = 0;
  adj.forEach((ns, i) => ns.filter(j => j > i).forEach(j => { const x = turf.intersect(turf.featureCollection([units[i], units[j]])); overlap += x ? turf.area(x) / 1e6 : 0; }));
  assert.ok(overlap < 1, `overlap ${overlap} km²`);
});

test("coasts and international borders are the country map's own points", () => {
  const key = (p: number[]) => `${p[0]},${p[1]}`;
  const countryPoints = new Set(rings(country('CAN').geometry).flat().map(key));
  const unitPoints = new Set(units.flatMap(u => rings(u.geometry).flat().map(key)));
  const shared = [...countryPoints].filter(p => unitPoints.has(p)).length;
  assert.ok(shared / countryPoints.size > 0.99, `${shared} of ${countryPoints.size} country points`);
  // Everything lies within the country's own bounds.
  const [w, s, e, n] = boundsOf([...countryPoints].map(k => k.split(',').map(Number) as LngLat));
  for (const u of units) { const [a, b, c, d] = turf.bbox(u); assert.ok(a >= w - 1e-6 && b >= s - 1e-6 && c <= e + 1e-6 && d <= n + 1e-6, u.properties.code); }
});

test('every unit is selectable at its label point, and only there is it that unit', () => {
  for (const u of units) assert.deepEqual(at(u.properties.label), [u.properties.code], u.properties.name);
});

test('places across Canada land in the right unit, islands included', () => {
  const places: [string, LngLat, string][] = [
    ['Quebec City', [-71.28, 46.86], 'QC'], ['Montreal', [-73.57, 45.5], 'QC'], ['Gatineau', [-75.72, 45.48], 'QC'], ['Anticosti Island', [-62.9, 49.5], 'QC'],
    ['Ottawa', [-75.7, 45.4], 'ON'], ['Toronto', [-79.38, 43.68], 'ON'], ['Thunder Bay', [-89.25, 48.38], 'ON'],
    ['Iqaluit, Baffin Island', [-68.5, 63.76], 'NU'], ['Baffin Island interior', [-72, 69], 'NU'], ['Ellesmere Island', [-80, 80], 'NU'],
    ['Southampton Island', [-84, 64.5], 'NU'], ['Cambridge Bay, Victoria Island', [-105.06, 69.12], 'NU'], ['Belcher Islands', [-79.2, 56.25], 'NU'],
    ["St. John's, Newfoundland", [-52.73, 47.56], 'NL'], ['Gander, Newfoundland', [-54.6, 48.95], 'NL'], ['Labrador City', [-66.91, 52.94], 'NL'], ['Goose Bay, Labrador', [-60.4, 53.3], 'NL'],
    ['Prince Edward Island, centre', [-63.3, 46.35], 'PE'], ['Prince Edward Island, east', [-62.6, 46.4], 'PE'], ['Prince Edward Island, west', [-64.0, 46.7], 'PE'],
    ['Yellowknife', [-114.37, 62.45], 'NT'], ['Ulukhaktok, Victoria Island', [-117.77, 70.74], 'NT'], ['Whitehorse', [-135.06, 60.72], 'YT'],
    ['Vancouver', [-123.12, 49.28], 'BC'], ['Vancouver Island', [-125.5, 49.6], 'BC'], ['Haida Gwaii', [-132.1, 53.3], 'BC'],
    ['Edmonton', [-113.49, 53.55], 'AB'], ['Regina', [-104.62, 50.45], 'SK'], ['Winnipeg', [-97.14, 49.9], 'MB'],
    ['Fredericton', [-66.64, 45.96], 'NB'], ['Halifax', [-63.58, 44.65], 'NS'], ['Cape Breton Island', [-60.9, 46.2], 'NS'],
  ];
  for (const [name, p, code] of places) assert.deepEqual(at(p), [code], name);
  // Water in the country map is water here too: Quebec City's and Charlottetown's harbours are in no unit.
  const shape = country('CAN');
  for (const p of [[-71.21, 46.81], [-63.13, 46.24]] as LngLat[]) assert.deepEqual([turf.booleanPointInPolygon(p, shape), at(p)], [false, []]);
});

test('near a land border, each side is its own unit', () => {
  // Points ~2 km either side of straight borders: Alberta–Saskatchewan (110°W), Saskatchewan–Manitoba (~101.5°W at
  // 55°N), Yukon–Northwest Territories, Quebec–Ontario north of the Ottawa River (79.52°W), and the 60th parallel.
  const pairs: [LngLat, string, LngLat, string][] = [
    [[-110.03, 53.3], 'AB', [-109.97, 53.3], 'SK'],
    [[-110.03, 58], 'AB', [-109.97, 58], 'SK'],
    [[-101.95, 55], 'SK', [-101.89, 55], 'MB'],
    [[-102.03, 58], 'SK', [-101.97, 58], 'MB'],
    [[-79.55, 50], 'ON', [-79.49, 50], 'QC'],
    [[-115, 59.98], 'AB', [-115, 60.02], 'NT'],
    [[-125, 59.98], 'BC', [-125, 60.02], 'YT'],
    [[-102.1, 59.98], 'SK', [-102.1, 60.02], 'NT'],
  ];
  for (const [a, ca, b, cb] of pairs) {
    assert.deepEqual(at(a), [ca], `${a} should be ${ca}`);
    assert.deepEqual(at(b), [cb], `${b} should be ${cb}`);
  }
  // Along every internal border: a point 1 km to each side is in exactly one unit, and the two sides differ. The pairs
  // found are the units that really touch: they must have different colours.
  let checked = 0;
  const touching = new Set<string>();
  for (const line of can.borders.features.flatMap(f => f.geometry.coordinates)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as LngLat, b = line[i] as LngLat, km = turf.distance(a, b);
      // Every long segment (straight surveyed borders are one segment), and every 9th of the rest; very short ones are
      // too short to offset reliably.
      if (km < 3 || (km < 20 && i % 9)) continue;
      const mid = turf.midpoint(a, b), bearing = turf.bearing(a, b);
      const side = (d: number) => turf.destination(mid, 1, bearing + d).geometry.coordinates as LngLat;
      const [l, r] = [at(side(90)), at(side(-90))];
      if (!turf.booleanPointInPolygon(side(90), country('CAN')) || !turf.booleanPointInPolygon(side(-90), country('CAN'))) continue;   // at a coast
      assert.equal(l.length, 1, `${side(90)}`);
      assert.equal(r.length, 1, `${side(-90)}`);
      assert.notEqual(l[0], r[0], `both sides of the border at ${mid.geometry.coordinates} are ${l[0]}`);
      touching.add([l[0], r[0]].sort().join('–'));
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} border points checked`);
  for (const pair of ['BC–NT', 'BC–YT', 'AB–NT', 'NT–NU', 'NT–YT', 'MB–NU', 'ON–QC', 'NL–QC', 'NB–QC', 'MB–ON', 'MB–SK', 'AB–SK', 'AB–BC', 'NT–SK']) assert.ok(touching.has(pair), `${pair} not found along the borders`);
  const colour = Object.fromEntries(units.map(u => [u.properties.code, u.properties.color]));
  // The Chignecto isthmus is too short for the sampling above: Sackville (NB) and Amherst (NS) sit either side of it.
  assert.deepEqual([at([-64.37, 45.9]), at([-64.21, 45.83])], [['NB'], ['NS']]);
  touching.add('NB–NS');
  for (const pair of touching) { const [a, b] = pair.split('–'); assert.notEqual(colour[a], colour[b], `${pair} share a colour`); }
  // Across a narrow strait too: Prince Edward Island is not the same colour as Nova Scotia or New Brunswick.
  assert.ok(colour.PE !== colour.NS && colour.PE !== colour.NB, 'PEI shares a colour across the Northumberland Strait');
  assert.ok(new Set(Object.values(colour)).size >= 4, 'the palette is spread');
});

test('internal borders: drawn from the shared source borders, and neighbours never share a colour', () => {
  const lines = can.borders.features.flatMap(f => f.geometry.coordinates);
  assert.ok(lines.length > 0);
  const near = (p: LngLat) => Math.min(...lines.map(l => turf.pointToLineDistance(p, turf.lineString(l), { units: 'kilometers' })));
  assert.ok(near([-110, 55]) < 2, 'Alberta–Saskatchewan');
  assert.ok(near([-79.52, 49]) < 2, 'Ontario–Quebec');
  assert.ok(near([-120, 60]) < 2, '60th parallel');
  // Coasts are not internal borders: the middle of Hudson Bay is far from any.
  assert.ok(near([-85, 59]) > 100);
  neighboursOf(canTopo).forEach((ns, i) => ns.filter(j => j !== i).forEach(j => assert.notEqual(units[i].properties.color, units[j].properties.color, `${units[i].properties.code}–${units[j].properties.code}`)));
});

test('every per-country file stays small enough for a phone', () => {
  for (const meta of Object.values(index.countries)) assert.ok(statSync(file(meta.file)).size < 512 * 1024, `${meta.file} is over 512 KB`);
});

test('framing: Canada fits, and countries across 180° get a box that crosses it', () => {
  const meta = index.countries.CAN;
  assert.deepEqual(meta.bounds.map(Math.round), [-141, 42, -53, 83]);
  assert.ok(meta.frame.radiusKm > 2000 && meta.frame.radiusKm < 3500);
  // Fiji: islands either side of 180°.
  assert.deepEqual(boundsOf([[177.2, -17.6], [179.9, -16.5], [-179.9, -16.2], [-178.4, -19]]).map(x => +x.toFixed(1)), [177.2, -19, 181.6, -16.2]);
  // A country that does not cross 180° keeps its ordinary box.
  assert.deepEqual(boundsOf([[-10, 40], [5, 50]]), [-10, 40, 5, 50]);
  const fiji = frameOf([[177.2, -17.6], [-178.4, -19]]);
  assert.ok(Math.abs(Math.abs(fiji.center[0]) - 179.4) < 0.01 && fiji.radiusKm < 300);
});

test('profiles are validated: every source row reviewed, codes and names unique', () => {
  const p = PROFILES.find(x => x.country === 'CAN')!;
  assert.deepEqual(validateProfile(p, Object.keys(p.units)), []);
  assert.match(validateProfile(p, [...Object.keys(p.units), 'CA-XX']).join(), /CA-XX is neither in units nor in exclude/);
  const dupCode = { ...p, units: { ...p.units, 'CA-PE': { ...p.units['CA-PE'], code: 'NS' } } };
  assert.match(validateProfile(dupCode, Object.keys(p.units)).join(), /code NS is used twice/);
  const dupName = { ...p, units: { ...p.units, 'CA-PE': { ...p.units['CA-PE'], aliases: ['Nouvelle-Ecosse'] } } };
  assert.match(validateProfile(dupName, Object.keys(p.units)).join(), /"nouvelle ecosse" names more than one unit/);
  assert.match(validateProfile({ ...p, country: 'XXX' }, Object.keys(p.units)).join(), /not a roster country/);
});
