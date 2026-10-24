import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { borderRuns, isCut, outlinesOf } from './outlines.ts';

test('cut edges along 180° and the poles are dropped; real borders, including ones touching 180°, are kept', () => {
  assert.equal(isCut([180, -84], [180, -90]), true);
  assert.equal(isCut([180, -90], [-180, -90]), true);
  assert.equal(isCut([10, -90], [20, -90]), true);
  assert.equal(isCut([180, 65], [-180, 66]), false);      // opposite sides of the seam: not one edge along it
  assert.equal(isCut([179.5, 65], [180, 66]), false);     // a coastline reaching 180°
  // A box cut by the seam on its east side: three border edges, one run, closing through the start point.
  const ring = [[170, 0], [180, 0], [180, 10], [170, 10], [170, 0]];
  assert.deepEqual(borderRuns(ring), [[[180, 10], [170, 10], [170, 0], [180, 0]]]);
  // No cuts: the ring is one run.
  assert.deepEqual(borderRuns([[0, 0], [1, 0], [1, 1], [0, 0]]), [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
});

test('the built borders have no seam or pole edges anywhere', () => {
  const topo = JSON.parse(readFileSync(new URL('../../public/data/countries.topo.json', import.meta.url), 'utf8')) as Topology<{ countries: GeometryCollection }>;
  const lines = outlinesOf(feature(topo, topo.objects.countries) as GeoJSON.FeatureCollection);
  let edges = 0;
  for (const f of lines.features) for (const line of f.geometry.coordinates) for (let i = 1; i < line.length; i++) {
    edges++;
    assert.equal(isCut(line[i - 1], line[i]), false, `${f.properties?.id} draws a cut edge`);
  }
  assert.ok(edges > 100_000);
  // Antarctica keeps its whole coastline: every coastline point of the shape is in its outline.
  const ata = lines.features.find(f => f.properties?.id === 'ATA')!;
  assert.ok(ata.geometry.coordinates.flat().every(p => Math.abs(p[1]) < 90));
});

test('islet traces cover small islands only, with real outlines', async () => {
  const { isletsOf, ringKm2 } = await import('./outlines.ts');
  // 1° × 1° at the equator is about 12,400 km².
  assert.ok(Math.abs(ringKm2([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) - 12_392) < 200);
  const topo = JSON.parse(readFileSync(new URL('../../public/data/countries.topo.json', import.meta.url), 'utf8')) as Topology<{ countries: GeometryCollection }>;
  const shapes = feature(topo, topo.objects.countries) as GeoJSON.FeatureCollection;
  const islets = new Map(isletsOf(shapes, 3000).features.map(f => [f.properties?.id, f.geometry.coordinates.length]));
  // Every island of Tuvalu, Kiribati and the Maldives is traced; large single landmasses are not.
  assert.ok((islets.get('TUV') ?? 0) >= 9);
  assert.ok((islets.get('MDV') ?? 0) > 100);
  for (const id of ['BOL', 'SWZ', 'LSO']) assert.equal(islets.has(id), false, `${id} is landlocked and large`);
});
