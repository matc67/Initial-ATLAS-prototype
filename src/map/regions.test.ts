import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { AREA_CAMERA } from '../data/countries.ts';
import { ROSTER } from '../data/roster.ts';
import { PACIFIC_VIEWS, angularDistance, sphericalCenter, visibleRadiusDeg } from './regions.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
const topo = read('countries.topo.json') as Topology<{ countries: GeometryCollection }>;
const shapes = new Map((feature(topo, topo.objects.countries) as GeoJSON.FeatureCollection).features.map(f => [String(f.properties?.id), f.properties!]));
const rings = new Map((read('markers.geojson') as GeoJSON.FeatureCollection<GeoJSON.Point>).features.map(f => [String(f.properties?.id), f.geometry.coordinates as [number, number]]));
// Where a player looks for a country: its ring for tiny countries, its label point otherwise.
const spot = (id: string): [number, number] => rings.get(id) ?? [Number(shapes.get(id)!.lx), Number(shapes.get(id)!.ly)];
const oceania = ROSTER.filter(r => r.continent === 'Oceania').map(r => r.id);
// During a round the HUD takes the top of the screen; about 300 px either side of the centre stays clear on a laptop.
const HALF_PX = 300;

test('the spherical centre handles the 180° line', () => {
  const [lng, lat] = sphericalCenter([[179, 0], [-179, 0]]);
  assert.ok(Math.abs(Math.abs(lng) - 180) < 1e-9 && Math.abs(lat) < 1e-9);
  assert.deepEqual(sphericalCenter([[10, 0], [20, 0]]).map(v => Math.round(v)), [15, 0]);
  assert.ok(Math.abs(angularDistance([179, 0], [-179, 0]) - 2) < 1e-9);
});

test('the Oceania view is centred on its countries and shows every one of them', () => {
  const all = PACIFIC_VIEWS.find(v => v.id === 'all')!;
  assert.deepEqual(AREA_CAMERA.Oceania, { center: all.center, zoom: all.zoom });
  const centre = sphericalCenter(oceania.map(spot));
  assert.ok(angularDistance(centre, all.center) < 3, `view centre is ${angularDistance(centre, all.center).toFixed(1)}° from Oceania's centre`);
  const reach = visibleRadiusDeg(all.zoom, all.center[1], HALF_PX);
  for (const id of oceania) assert.ok(angularDistance(all.center, spot(id)) < reach, `${id} is off screen in the Oceania view`);
});

test('every Pacific island country is fully in view in at least one regional view, which shows several countries', () => {
  const pacific = oceania.filter(id => id !== 'AUS' && id !== 'NZL');
  const regions = PACIFIC_VIEWS.filter(v => v.id !== 'all');
  for (const id of pacific) {
    const inView = regions.filter(v => angularDistance(v.center, spot(id)) < visibleRadiusDeg(v.zoom, v.center[1], HALF_PX));
    assert.ok(inView.length > 0, `${id} is in no regional view`);
  }
  // No view frames a single country: each holds at least four, so choosing one never gives an answer away.
  for (const v of regions) {
    const shown = oceania.filter(id => angularDistance(v.center, spot(id)) < visibleRadiusDeg(v.zoom, v.center[1], HALF_PX));
    assert.ok(shown.length >= 4, `${v.id} shows only ${shown.join(', ')}`);
  }
});

test('views have unique ids, accessible titles and valid coordinates', () => {
  assert.equal(new Set(PACIFIC_VIEWS.map(v => v.id)).size, PACIFIC_VIEWS.length);
  for (const v of PACIFIC_VIEWS) {
    assert.ok(v.title.length > 5);
    assert.ok(Math.abs(v.center[0]) <= 180 && Math.abs(v.center[1]) <= 85 && v.zoom > 1 && v.zoom < 5);
  }
});
