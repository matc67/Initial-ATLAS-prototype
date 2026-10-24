// Checks the built map data in public/data (run `npm run data` after changing the roster or the build script).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { ROSTER } from '../data/roster.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
const topo = read('countries.topo.json') as Topology<{ countries: GeometryCollection }>;
type Shape = Feature<Polygon | MultiPolygon, Record<string, any>>;
const shapes = (feature(topo, topo.objects.countries) as FeatureCollection).features as Shape[];
const halos = (read('halos.geojson') as FeatureCollection).features as Shape[];
const markers = (read('markers.geojson') as FeatureCollection).features as Feature<Point>[];
const byId = new Map(shapes.map(s => [String(s.properties.id), s]));
const roster = new Map(ROSTER.map(r => [r.id, r]));

test('every shape has a unique id, and exactly the 200 roster countries are playable', () => {
  assert.equal(byId.size, shapes.length);
  const playable = shapes.filter(s => s.properties.playable === 1).map(s => String(s.properties.id));
  assert.deepEqual(playable.sort(), [...roster.keys()].sort());
  for (const id of playable) assert.equal(byId.get(id)!.properties.name, roster.get(id)!.name, `${id} name`);
});

test('names, ids and flags line up one to one', () => {
  assert.equal(new Set(ROSTER.map(r => r.name)).size, ROSTER.length);
  const flagged = ROSTER.filter(r => r.iso2);
  assert.equal(new Set(flagged.map(r => r.iso2)).size, flagged.length);
  for (const r of flagged) assert.ok(existsSync(new URL(`../../public/flags/${r.iso2.toLowerCase()}.svg`, import.meta.url)), `flag for ${r.id}`);
});

test('rings and halos belong to playable countries, one each, and sit on their own country', () => {
  for (const list of [markers, halos]) {
    const ids = list.map(f => String(f.properties!.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.ok(roster.has(id), `${id} is not playable`);
  }
  for (const m of markers) {
    const own = byId.get(String(m.properties!.id))!;
    // A ring is drawn on its country's land (on the largest island when the label point falls in the sea).
    const d = turf.pointToPolygonDistance(m, own, { units: 'kilometers' });
    assert.ok(d <= 1, `${m.properties!.id} ring is ${Math.round(d)} km from its land`);
  }
});

// Edges along the poles (Antarctica's ring closes along 90°S from 180° to -180°) are real, not tears.
const lonJump = (ring: number[][]) => Math.max(0, ...ring.slice(1).map((p, i) => (Math.abs(p[1]) > 85 && Math.abs(ring[i][1]) > 85 ? 0 : Math.abs(p[0] - ring[i][0]))));
const rings = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat();

test('no edge jumps across the globe (antimeridian tears would fill the ocean)', () => {
  for (const s of [...shapes, ...halos]) {
    const worst = Math.max(...rings(s.geometry).map(lonJump));
    assert.ok(worst < 30, `${s.properties.id} has an edge spanning ${worst.toFixed(0)}° of longitude`);
  }
});

test('islands stay separate: every island of an island country is its own polygon inside its halo', () => {
  for (const h of halos) {
    const country = byId.get(String(h.properties.id))!;
    const islands = turf.flatten(country).features;
    for (const island of islands) {
      const [x, y] = turf.pointOnFeature(island).geometry.coordinates;
      assert.ok([0, 360, -360].some(d => turf.booleanPointInPolygon([x + d, y], h)), `${h.properties.id} island at ${x.toFixed(2)},${y.toFixed(2)} is outside its halo`);
    }
  }
  assert.ok(turf.flatten(byId.get('TUV')!).features.length >= 9);
  assert.ok(turf.flatten(byId.get('MDV')!).features.length > 100);
});

test('every playable country owns its label point, and no other country does (holes and enclaves intact)', () => {
  const playable = shapes.filter(s => s.properties.playable === 1);
  const boxes = new Map(playable.map(s => [s, turf.bbox(s)]));
  for (const s of playable) {
    const pt = turf.point([Number(s.properties.lx), Number(s.properties.ly)]);
    const [x, y] = pt.geometry.coordinates;
    const owners = playable.filter(o => { const b = boxes.get(o)!; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && turf.booleanPointInPolygon(pt, o); });
    const others = owners.filter(o => o !== s).map(o => o.properties.id);
    assert.deepEqual(others, [], `${s.properties.id}'s label point is also inside ${others.join(', ')}`);
  }
  // Enclaves are holes in the country around them.
  const italy = byId.get('ITA')!, southAfrica = byId.get('ZAF')!;
  for (const [id, around] of [['VAT', italy], ['SMR', italy], ['LSO', southAfrica]] as const) {
    const p = byId.get(id)!.properties;
    assert.equal(turf.booleanPointInPolygon([p.lx, p.ly], around), false, `${id} is not a hole in ${around.properties.id}`);
  }
});

// MapLibre's globe draws polygons in Web Mercator tiles, which stop at ±85.0511°, and fills the polar caps by extending
// the shapes that touch that edge. A coastline beyond the limit collapses onto the edge and leaves a wedge with no land.
test('no coastline goes past the Web Mercator limit; Antarctica reaches the pole along its whole width', () => {
  const LIMIT = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;
  for (const s of shapes) for (const ring of rings(s.geometry)) for (const p of ring) {
    const poleOrSeam = Math.abs(p[1]) >= 90 - 1e-6 || Math.abs(p[0]) >= 180 - 1e-6;
    assert.ok(poleOrSeam || Math.abs(p[1]) < LIMIT, `${s.properties.id} has a coastline point at ${p[0].toFixed(2)}, ${p[1].toFixed(2)}`);
  }
  const pole = rings(byId.get('ATA')!.geometry).flat().filter(p => p[1] <= -90 + 1e-6).map(p => p[0]).sort((a, b) => a - b);
  assert.equal(pole[0], -180);
  assert.equal(pole.at(-1), 180);
  // The pole edge keeps its points (about every 0.5°) so no single edge spans the world.
  assert.ok(pole.slice(1).every((x, i) => x - pole[i] <= 1), 'gap in the pole edge');
});
