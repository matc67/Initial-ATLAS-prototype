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
    // Every build flag has been reviewed in the profile; a new one fails until it is.
    const unreviewed = meta.flags.filter(f => !p.reviewed?.[f.split(':')[0]]);
    assert.deepEqual(unreviewed, [], `${id} has build flags to review`);
    for (const code of Object.keys(p.reviewed ?? {})) assert.ok(meta.flags.some(f => f.startsWith(`${code}:`)), `${id} ${code}: reviewed, but no longer flagged`);
  }
});

test('every country: names and aliases match exactly one unit', () => {
  for (const id of ids) {
    const all = sets[id].units.features.flatMap(u => [u.properties.name, ...u.properties.aliases].map(n => [normalize(n), u.properties.code] as const));
    for (const [n, code] of all) assert.ok(!all.some(([m, c]) => m === n && c !== code), `${id}: "${n}" is ambiguous`);
  }
});

// A point strictly inside a ring, never on its edge (the edge is shared with whatever fills it): its centroid when that
// is inside, otherwise the first inside point on a grid over its box.
function interiorOf(ring: number[][]): LngLat {
  const poly = turf.polygon([ring]), strictly = (q: number[]) => turf.booleanPointInPolygon(q, poly, { ignoreBoundary: true });
  const c = turf.centroid(poly).geometry.coordinates;
  if (strictly(c)) return c as LngLat;
  const [w, s, e, n] = turf.bbox(poly);
  for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) { const q = [w + ((e - w) * i) / 40, s + ((n - s) * j) / 40]; if (strictly(q)) return q as LngLat; }
  return c as LngLat;
}

test('every country: units cover the country map exactly, without holes or overlaps, and inside its bounds', () => {
  for (const id of ids) {
    const units = sets[id].units.features, shape = country(id);
    const total = units.reduce((n, u) => n + turf.area(u), 0), area = turf.area(shape);
    assert.ok(Math.abs(total - area) / area < 0.0005, `${id}: units ${total / 1e6} km² vs country ${area / 1e6} km²`);
    // A hole is only ever another unit inside it (the Federal District in Goiás, Berlin in Brandenburg): never a gap.
    for (const u of units) for (const p of u.geometry.type === 'Polygon' ? [u.geometry.coordinates] : u.geometry.coordinates) for (const hole of p.slice(1)) {
      const inside = interiorOf(hole);
      if (!turf.booleanPointInPolygon(inside, shape)) continue;   // a hole in the country map too: a lake or an inlet
      assert.equal(at(sets[id], inside).length, 1, `${u.properties.id} has a hole at ${inside} that no other unit fills`);
      assert.notDeepEqual(at(sets[id], inside), [u.properties.code]);
    }
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
    assert.ok(checked >= Math.min(100, 2 * set.units.features.length), `${id}: only ${checked} border points checked`);
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

// ---- Phase 6, batch 1 ---------------------------------------------------------------------------------------------------
type Batch = { codes: string; describe: string; places: [string, LngLat, string][]; names?: [string, string | null][] };
const BATCH1: { [id: string]: Batch } = {
  BRA: {
    codes: 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO', describe: '26 states and 1 federal district',
    places: [['Brasília', [-47.88, -15.79], 'DF'], ['São Paulo', [-46.63, -23.55], 'SP'], ['Manaus', [-60.02, -3.1], 'AM'], ['Belo Horizonte', [-43.94, -19.92], 'MG'],
      ['Goiânia', [-49.25, -16.68], 'GO'], ['Cuiabá', [-56.1, -15.6], 'MT'], ['Campo Grande', [-54.62, -20.47], 'MS'], ['Palmas', [-48.33, -10.18], 'TO'], ['Marajó Island', [-49.5, -0.9], 'PA']],
    names: [['Sao Paulo', 'SP'], ['Distrito Federal', 'DF'], ['Para', 'PA'], ['Brasilia', null]],
  },
  MEX: {
    codes: 'AGU BCN BCS CAM CHP CHH COA COL CMX DUR GUA GRO HID JAL MEX MIC MOR NAY NLE OAX PUE QUE ROO SLP SIN SON TAB TAM TLA VER YUC ZAC', describe: '31 states and 1 capital city',
    places: [['Mexico City', [-99.13, 19.43], 'CMX'], ['Toluca', [-99.66, 19.29], 'MEX'], ['Guadalajara', [-103.35, 20.67], 'JAL'], ['Monterrey', [-100.31, 25.67], 'NLE'],
      ['Mérida', [-89.62, 20.97], 'YUC'], ['Chihuahua', [-106.09, 28.63], 'CHH'], ['Ciudad Constitución', [-111.66, 25.03], 'BCS'], ['Felipe Carrillo Puerto', [-88.05, 19.58], 'ROO'], ['Cozumel', [-86.9, 20.42], 'ROO']],
    names: [['Mexico City', 'CMX'], ['CDMX', 'CMX'], ['Ciudad de Mexico', 'CMX'], ['Estado de Mexico', 'MEX'], ['Mexico', null], ['Distrito Federal', null], ['Nuevo Leon', 'NLE']],
  },
  IND: {
    codes: 'AN AP AR AS BR CH CG DH DL GA GJ HR HP JK JH KA KL LA LD MP MH MN ML MZ NL OD PB PY RJ SK TN TS TR UP UK WB', describe: '28 states and 8 union territories',
    places: [['New Delhi', [77.21, 28.61], 'DL'], ['Pune', [73.86, 18.52], 'MH'], ['Chandigarh', [76.78, 30.73], 'CH'], ['Bengaluru', [77.59, 12.97], 'KA'], ['Hyderabad', [78.49, 17.39], 'TS'],
      ['Kolkata', [88.36, 22.57], 'WB'], ['Leh', [77.58, 34.16], 'LA'], ['Srinagar', [74.8, 34.08], 'JK'], ['Raipur', [81.63, 21.25], 'CG'], ['Bhubaneswar', [85.82, 20.3], 'OD'],
      ['Dehradun', [78.03, 30.32], 'UK'], ['Itanagar', [93.6, 27.1], 'AR'], ['Gangtok', [88.61, 27.33], 'SK'], ['Shimla', [77.17, 31.1], 'HP']],
    names: [['Odisha', 'OD'], ['Orissa', null], ['NCT of Delhi', 'DL'], ['Pondicherry', null], ['Telangana', 'TS']],
  },
  DEU: {
    codes: 'BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH TH', describe: '16 states',
    places: [['Berlin', [13.4, 52.52], 'BE'], ['Potsdam', [13.06, 52.4], 'BB'], ['Munich', [11.58, 48.14], 'BY'], ['Hamburg', [10.0, 53.55], 'HH'], ['Bremen', [8.8, 53.08], 'HB'],
      ['Bremerhaven, an exclave of Bremen', [8.58, 53.55], 'HB'], ['Cologne', [6.96, 50.94], 'NW'], ['Stuttgart', [9.18, 48.78], 'BW'], ['Dresden', [13.74, 51.05], 'SN'], ['Frankfurt', [8.68, 50.11], 'HE'],
      ['Saarbrücken', [7.0, 49.24], 'SL'], ['Rügen', [13.4, 54.45], 'MV'], ['Kiel', [10.13, 54.32], 'SH'], ['Erfurt', [11.03, 50.98], 'TH'], ['Magdeburg', [11.63, 52.13], 'ST'], ['Koblenz', [7.59, 50.36], 'RP'], ['Hanover', [9.73, 52.37], 'NI']],
    names: [['Bayern', 'BY'], ['Bavaria', 'BY'], ['NRW', 'NW'], ['Thuringen', 'TH'], ['Mecklenburg-Vorpommern', 'MV']],
  },
  JPN: {
    codes: Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0')).join(' '), describe: '47 prefectures',
    places: [['Shinjuku, Tokyo', [139.7, 35.69], '13'], ['Sapporo', [141.35, 43.06], '01'], ['Osaka', [135.5, 34.69], '27'], ['Kyoto', [135.77, 35.01], '26'], ['Nagoya', [136.91, 35.18], '23'],
      ['Fukuoka', [130.4, 33.59], '40'], ['Sendai', [140.87, 38.27], '04'], ['Kirishima', [130.76, 31.74], '46'], ['Amami Ōshima', [129.4, 28.3], '46'], ['Hachijō-jima, Tokyo', [139.79, 33.1], '13'],
      ['Matsuyama', [132.77, 33.84], '38'], ['Sado Island', [138.4, 38.05], '15'], ['Okinawa Island', [127.8, 26.4], '47'],
      // The Amami Islands are Kagoshima's (Natural Earth files them under Okinawa; the profile moves them).
      ['Tokunoshima', [128.95, 27.78], '46'], ['Yoronjima', [128.42, 27.04], '46'], ['Yakushima', [130.53, 30.35], '46']],
    names: [['Hokkaidō', '01'], ['Tokyo', '13'], ['Osaka', '27'], ['Kochi', '39']],
  },
  AUS: {
    codes: 'NSW QLD SA TAS VIC WA ACT NT', describe: '6 states and 2 territories',
    places: [['Parramatta, Sydney', [151.0, -33.8], 'NSW'], ['Canberra', [149.13, -35.28], 'ACT'], ['Melbourne', [144.96, -37.81], 'VIC'], ['Brisbane', [153.03, -27.47], 'QLD'],
      ['Adelaide', [138.6, -34.93], 'SA'], ['Perth', [115.86, -31.95], 'WA'], ['Hobart', [147.33, -42.88], 'TAS'], ['Katherine', [132.26, -14.47], 'NT'], ['Alice Springs', [133.88, -23.7], 'NT'],
      ['Kangaroo Island', [137.2, -35.8], 'SA'], ['Jervis Bay Territory', [150.692, -35.1532], 'JBT']],
    names: [['NSW', 'NSW'], ['ACT', 'ACT'], ['Jervis Bay Territory', null]],
  },
  FRA: {
    codes: 'ARA BFC BRE CVL 20R GES HDF IDF NOR NAQ OCC PDL PAC', describe: '13 regions',
    places: [['Paris', [2.35, 48.86], 'IDF'], ['Lyon', [4.84, 45.76], 'ARA'], ['Marseille', [5.4, 43.3], 'PAC'], ['Toulouse', [1.44, 43.6], 'OCC'], ['Bordeaux', [-0.58, 44.84], 'NAQ'],
      ['Nantes', [-1.55, 47.22], 'PDL'], ['Rennes', [-1.68, 48.11], 'BRE'], ['Rouen', [1.1, 49.44], 'NOR'], ['Lille', [3.06, 50.63], 'HDF'], ['Strasbourg', [7.75, 48.58], 'GES'],
      ['Orléans', [1.9, 47.9], 'CVL'], ['Dijon', [5.04, 47.32], 'BFC'], ['Corte, Corsica', [9.15, 42.31], '20R']],
    names: [['Normandie', 'NOR'], ['Bretagne', 'BRE'], ['Corse', '20R'], ['PACA', 'PAC'], ['Ile de France', 'IDF']],
  },
  NGA: {
    codes: 'AB AD AK AN BA BY BE BO CR DE EB ED EK EN FC GO IM JI KD KN KT KE KO KW LA NA NI OG ON OS OY PL RI SO TA YO ZA', describe: '36 states and 1 federal capital territory',
    places: [['Abuja', [7.49, 9.06], 'FC'], ['Ikeja, Lagos', [3.35, 6.6], 'LA'], ['Kano', [8.52, 12.0], 'KN'], ['Ibadan', [3.9, 7.38], 'OY'], ['Port Harcourt', [7.0, 4.82], 'RI'],
      ['Enugu', [7.5, 6.45], 'EN'], ['Maiduguri', [13.16, 11.85], 'BO'], ['Kaduna', [7.44, 10.52], 'KD'], ['Jos', [8.89, 9.9], 'PL'], ['Benin City', [5.63, 6.34], 'ED'], ['Lafia', [8.52, 8.49], 'NA']],
    names: [['FCT', 'FC'], ['Nasarawa', 'NA'], ['Akwa Ibom', 'AK']],
  },
};

for (const [id, b] of Object.entries(BATCH1)) {
  test(`batch 1, ${id}: the official set, places in the right unit, typed names`, () => {
    const set = sets[id], meta = index.countries[id];
    assert.ok(set, `${id} is not built`);
    assert.equal(meta.enabled, true);
    assert.equal(describeCount(meta), b.describe);
    assert.deepEqual(playableIds(set).map(x => x.split(':')[2]).sort(), b.codes.split(' ').sort());
    for (const [name, p, code] of b.places) assert.deepEqual(at(set, p), [code], `${id}: ${name}`);
    const places = subdivisionPlayables(set);
    for (const [typed, code] of b.names ?? []) {
      const hits = [...places.values()].filter(u => nameMatches(u, typed)).map(u => u.id.split(':')[2]);
      assert.deepEqual(hits, code ? [code] : [], `${id}: "${typed}"`);
    }
  });
}

test('batch 1: enclaves, merged islets and units left out are handled as their profiles say', () => {
  // Enclaves: each sits inside a hole of the unit around it, and is its own unit.
  assert.deepEqual(at(sets.BRA, [-47.88, -15.79]), ['DF']);
  assert.deepEqual(at(sets.DEU, [13.4, 52.52]), ['BE']);
  assert.deepEqual(at(sets.AUS, [149.13, -35.28]), ['ACT']);
  // Rows merged into another unit: one unit each, listing every source row.
  assert.equal(sets.AUS.byId.get('admin1:AUS:NSW')!.properties.src.ne.length, 2);   // with Lord Howe Island
  assert.equal(sets.AUS.byId.get('admin1:AUS:TAS')!.properties.src.ne.length, 2);   // with Macquarie Island
  assert.equal(sets.AUS.byId.get('admin1:AUS:NSW')!.properties.src.iso, 'AU-NSW');
  assert.equal(sets.MEX.byId.get('admin1:MEX:YUC')!.properties.src.ne.length, 2);   // with Arrecife Alacranes
  // Mexico City keeps its source code as a crosswalk; its ATLAS code is the current one.
  assert.equal(sets.MEX.byId.get('admin1:MEX:CMX')!.properties.src.iso, 'MX-DIF');
  // India's updated codes keep the source codes as a crosswalk.
  assert.equal(sets.IND.byId.get('admin1:IND:OD')!.properties.src.iso, 'IN-OR');
  // Jervis Bay Territory: drawn and named, never asked.
  assert.equal(sets.AUS.byId.get('admin1:AUS:JBT')!.properties.playable, false);
  assert.deepEqual(index.countries.AUS.others?.map(o => o.id), ['admin1:AUS:JBT']);
  // France: 101 departments grouped into the 13 metropolitan regions; the overseas regions are not part of it.
  assert.equal(sets.FRA.units.features.reduce((n, u) => n + u.properties.src.ne.length, 0), 96);
  for (const p of [[-53.1, 3.9], [55.5, -21.1], [-61.0, 14.65]] as LngLat[]) assert.deepEqual(at(sets.FRA, p), []);
});
