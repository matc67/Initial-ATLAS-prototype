// Builds the Level 1 country data from a pinned Natural Earth release.
// Run with `npm run data`. Writes to public/data/; the app never fetches upstream data at runtime.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { topology } from 'topojson-server';
import { quantize } from 'topojson-client';
import { presimplify, quantile, simplify, sphericalTriangleArea } from 'topojson-simplify';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { ROSTER } from '../src/data/roster.ts';

const NE_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
// 1:10m: island coastlines stay crisp when zoomed in on the Caribbean or the Pacific.
const NE_FILE = 'ne_10m_admin_0_countries.geojson';
const NE_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_COMMIT}/geojson/${NE_FILE}`;
const RAW = `data-raw/${NE_COMMIT.slice(0, 7)}-${NE_FILE}`;
const OUT = 'public/data';

// Natural Earth draws these areas separately; ATLAS shows the internationally recognised country.
// Somaliland and Northern Cyprus are de facto states; the Cyprus buffer zone, Baikonur (leased to Russia)
// and Guantanamo Bay (leased to the US) are sovereign territory of Cyprus, Kazakhstan and Cuba.
const MERGE_INTO: Record<string, string> = { SOL: 'SOM', CYN: 'CYP', CNM: 'CYP', KAB: 'KAZ', USG: 'CUB' };
// Share of border points kept after simplification; the rest are too small to see at the app's max zoom.
const KEEP_POINTS = 0.5;
// Countries below this land area keep every point Natural Earth has: halving an atoll's 8 points turns it into a triangle.
const FULL_DETAIL_KM2 = 30000;
// Below this land area a country gets a ring marker at world zoom.
const TINY_KM2 = 3000;
// Island countries (no land border) below this land area get a dashed halo around their islands.
const HALO_MAX_KM2 = 30000;
// Halo = islands grown by HALO_REACH_KM, merged, then shrunk back to HALO_MARGIN_KM from the coast:
// islands up to 2 × reach apart share one outline, and the outline stays close to the land.
const HALO_REACH_KM = 45;
const HALO_MARGIN_KM = 14;
// Atoll nations (under 1,000 km² of land spread over more than 300 km of ocean, e.g. Kiribati, Marshall Islands,
// Maldives) need a longer reach so each island chain reads as one shape instead of dozens of specks.
const ATOLL_KM2 = 1000, ATOLL_SPREAD_KM = 300, ATOLL_REACH_KM = 120, ATOLL_MARGIN_KM = 22;
// Natural Earth includes overseas regions in France (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte) and the
// Netherlands (Bonaire, Sint Eustatius, Saba). Players expect "France" to be the European country, so islands and
// territories outside this box become non-playable land of their own.
const OVERSEAS_SPLIT = ['FRA', 'NLD'];
const EUROPE_BOX = [-11, 35, 30, 72];

type Shape = Feature<Polygon | MultiPolygon, Record<string, any>>;

async function loadRaw(): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  if (!existsSync(RAW)) {
    console.log(`Downloading ${NE_URL}`);
    const res = await fetch(NE_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    mkdirSync('data-raw', { recursive: true });
    writeFileSync(RAW, await res.text());
  }
  return JSON.parse(readFileSync(RAW, 'utf8'));
}

const round = <T extends Feature>(f: T, precision = 3) => turf.truncate(f, { precision, coordinates: 2, mutate: true });

// turf.buffer wraps longitudes into ±180, which tears any shape whose *buffer* reaches the 180° line, even when the land
// itself does not (Tuvalu's islands stop at 179.9°E). Those countries are rotated 180°, buffered, and rotated back; a
// result that straddles 180° keeps longitudes above 180, which MapLibre wraps.
function rotate(g: Shape, east: boolean): Shape {
  const c = turf.clone(g);
  turf.coordEach(c, p => { p[0] = east ? (p[0] > 0 ? p[0] - 180 : p[0] + 180) : p[0] + 180; });
  return c;
}

// A ring must sit on its country's land. Natural Earth's label point is used when it does; for archipelagos it can fall in
// the sea between islands (São Tomé and Príncipe, Antigua and Barbuda), so the ring moves onto the largest island.
function ringPoint(f: Shape, label: [number, number]): [number, number] {
  if (turf.booleanPointInPolygon(label, f)) return label;
  const largest = turf.flatten(f).features.reduce((a, b) => (turf.area(b) > turf.area(a) ? b : a));
  const c = turf.centroid(largest).geometry.coordinates as [number, number];
  return turf.booleanPointInPolygon(c, largest) ? c : turf.pointOnFeature(largest).geometry.coordinates as [number, number];
}

const ANTIMERIDIAN_DEG = 5;
function halo(f: Shape, reach: number, margin: number): Shape {
  const lons = turf.coordAll(f).map(c => c[0]);
  // Within ANTIMERIDIAN_DEG of 180°, a buffer of up to ATOLL_REACH_KM (about 1.1° at the equator, more towards the poles) could cross it.
  const crosses = Math.max(...lons) > 180 - ANTIMERIDIAN_DEG || Math.min(...lons) < -180 + ANTIMERIDIAN_DEG;
  const base = crosses ? rotate(f, true) : f;
  // Grow island by island: one buffer around a whole archipelago is centred far from its outer islands.
  const grown = turf.flatten(base).features.map(p => turf.buffer(p, reach, { units: 'kilometers' })!);
  const merged = (grown.length > 1 ? turf.union(turf.featureCollection(grown)) : grown[0]) as Shape;
  const shrunk = turf.buffer(merged, -(reach - margin), { units: 'kilometers' }) as Shape;
  // Outer rings only: open water enclosed by an island chain (the Bahamas) belongs inside the halo, not as a hole.
  const g = shrunk.geometry;
  shrunk.geometry = g.type === 'Polygon' ? { type: 'Polygon', coordinates: [g.coordinates[0]] } : { type: 'MultiPolygon', coordinates: g.coordinates.map(p => [p[0]]) };
  const smooth = turf.simplify(shrunk, { tolerance: 0.01, highQuality: true });
  if (!crosses) return smooth;
  const back = rotate(smooth, false);
  // Entirely east of 180° (Tonga, Samoa after the round trip): shift back into ±180.
  if (turf.coordAll(back).every(p => p[0] > 180)) turf.coordEach(back, p => { p[0] -= 360; });
  return back;
}

// MapLibre draws polygons in Web Mercator tiles, which end at ±85.0511°: any point beyond is clamped onto the tile's
// edge, and the globe covers the polar cap by extending the shapes that touch that edge out to the pole. A coastline that
// dips past the limit (the inner edge of the Ross Ice Shelf reaches 85.22°S) collapses onto the edge as a zero-width sliver,
// leaving that stretch of edge empty, so no land is drawn from there to the pole: a dark wedge. Coastline points beyond
// MERCATOR_SAFE_LAT are moved to it, just inside the limit, so the shape stays a valid polygon in the projection that draws
// it. Points on the pole edge (±90°) and the 180° seam are what join the shape to the pole, and are left alone.
const MERCATOR_SAFE_LAT = 85;
function clampToMercator(f: Shape) {
  turf.coordEach(f, p => {
    const onPoleOrSeam = Math.abs(p[1]) >= 90 - 1e-9 || Math.abs(p[0]) >= 180 - 1e-9;
    if (!onPoleOrSeam && Math.abs(p[1]) > MERCATOR_SAFE_LAT) p[1] = Math.sign(p[1]) * MERCATOR_SAFE_LAT;
  });
}

const raw = await loadRaw();
for (const f of raw.features as Shape[]) clampToMercator(f);
const byId = new Map<string, Shape>();
for (const f of raw.features as Shape[]) byId.set(f.properties.ADM0_A3, f);

for (const [from, to] of Object.entries(MERGE_INTO)) {
  const a = byId.get(to)!, b = byId.get(from)!;
  const merged = turf.union(turf.featureCollection([a, b])) as Shape;
  merged.properties = a.properties;
  byId.set(to, merged);
  byId.delete(from);
}

for (const id of OVERSEAS_SPLIT) {
  const f = byId.get(id)!;
  const parts = turf.flatten(f).features;
  const inEurope = (p: Feature<Polygon>) => { const [x, y] = turf.centroid(p).geometry.coordinates; return x >= EUROPE_BOX[0] && y >= EUROPE_BOX[1] && x <= EUROPE_BOX[2] && y <= EUROPE_BOX[3]; };
  const home = parts.filter(inEurope), away = parts.filter(p => !inEurope(p));
  const multi = (ps: Feature<Polygon>[]) => turf.multiPolygon(ps.map(p => p.geometry.coordinates)).geometry;
  byId.set(id, turf.feature(multi(home), f.properties) as Shape);
  const [lx, ly] = turf.centroid(away[0]).geometry.coordinates;
  byId.set(`${id}-OVERSEAS`, turf.feature(multi(away), { ...f.properties, ADM0_A3: `${id}-OVERSEAS`, NAME_LONG: `${f.properties.NAME_LONG} (overseas)`, LABEL_X: lx, LABEL_Y: ly }) as Shape);
}

const roster = new Map(ROSTER.map(r => [r.id, r]));
const missing = ROSTER.filter(r => !byId.has(r.id)).map(r => r.id);
if (missing.length) throw new Error(`Roster ids not in Natural Earth: ${missing.join(', ')}`);

// A country is an island country when its land touches no other country's land.
const boxes = new Map([...byId].map(([id, f]) => [id, turf.bbox(f)]));
const overlaps = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const isIsland = (id: string) => ![...byId].some(([other, g]) =>
  other !== id && overlaps(boxes.get(id)!, boxes.get(other)!) && turf.booleanIntersects(byId.get(id)!, g));

const shapes: Shape[] = [], halos: Shape[] = [], markers: Feature[] = [];
const fullDetail = new Set<string>();
for (const [id, f] of byId) {
  const r = roster.get(id);
  // `color` is Natural Earth's MAPCOLOR7 (1-7, no two neighbours alike); `lx`/`ly` is its label point, used for distances.
  // `cont` picks the continent colour family; `region` is the UN geoscheme subregion (Natural Earth SUBREGION), shown in Explore.
  const props = { id, name: r?.name ?? f.properties.NAME_LONG, playable: r ? 1 : 0, color: f.properties.MAPCOLOR7, lx: f.properties.LABEL_X, ly: f.properties.LABEL_Y,
    ...(r ? { cont: r.continent, region: f.properties.SUBREGION } : {}),
    // Non-playable land keeps its sovereign and Natural Earth TYPE, so Explore can say why it is not one of the 195.
    ...(r ? {} : { sovereign: f.properties.SOVEREIGNT, kind: id.endsWith('-OVERSEAS') ? 'Overseas region' : f.properties.TYPE }) };
  shapes.push(turf.feature(f.geometry, props) as Shape);
  if (!r) continue;
  const km2 = turf.area(f) / 1e6;
  if (km2 < FULL_DETAIL_KM2) fullDetail.add(id);
  const hasHalo = km2 < HALO_MAX_KM2 && isIsland(id);
  const [w, so, e, n] = boxes.get(id)!;
  const atoll = km2 < ATOLL_KM2 && turf.distance([w, so], [e, n]) > ATOLL_SPREAD_KM;
  if (hasHalo) halos.push(round(turf.feature(halo(f, atoll ? ATOLL_REACH_KM : HALO_REACH_KM, atoll ? ATOLL_MARGIN_KM : HALO_MARGIN_KM).geometry, { id, color: props.color, cont: props.cont })) as Shape);
  // Ring markers for countries with a halo fade out sooner, once the halo is big enough to see.
  if (km2 < TINY_KM2) markers.push(turf.point(ringPoint(f, [props.lx, props.ly]), { id, halo: hasHalo ? 1 : 0, color: props.color, cont: props.cont }));
}

// Halos of different countries must not overlap, or a click could land in two at once. Where two do (Grenada and
// Saint Vincent's Grenadines are a few km apart), both coastlines grow outward in steps and each patch of water
// goes to whichever country reaches it first: roughly the line halfway between their islands.
const STEP_KM = 2;
function separate(a: Shape, b: Shape) {
  const landA = byId.get(a.properties.id)!, landB = byId.get(b.properties.id)!;
  let claimA: Shape = landA, claimB: Shape = landB;
  for (let km = STEP_KM; km <= ATOLL_REACH_KM + STEP_KM; km += STEP_KM) {
    const growA = turf.difference(turf.featureCollection([turf.buffer(landA, km, { units: 'kilometers' }) as Shape, claimB])) as Shape | null;
    const growB = turf.difference(turf.featureCollection([turf.buffer(landB, km, { units: 'kilometers' }) as Shape, claimA])) as Shape | null;
    if (growA) claimA = turf.union(turf.featureCollection([claimA, growA])) as Shape;
    if (growB) claimB = (turf.difference(turf.featureCollection([turf.union(turf.featureCollection([claimB, growB])) as Shape, claimA])) as Shape | null) ?? claimB;
  }
  const keep = (h: Shape, other: Shape) => {
    const cut = turf.difference(turf.featureCollection([h, other])) as Shape | null;
    if (cut) h.geometry = round(cut).geometry;
  };
  keep(a, claimB);
  keep(b, claimA);
}
const intersecting = (i: number, j: number) => turf.booleanIntersects(halos[i], halos[j]) && !!turf.intersect(turf.featureCollection([halos[i], halos[j]]));
for (let i = 0; i < halos.length; i++) for (let j = i + 1; j < halos.length; j++) if (intersecting(i, j)) separate(halos[i], halos[j]);

// Shared borders are stored once, so simplifying a border moves both neighbours' edges together.
const topo = presimplify(topology({ countries: turf.featureCollection(shapes) }, 1e6) as Topology<{ countries: GeometryCollection }>, sphericalTriangleArea);
// Small countries keep every point: their arcs get an infinite weight, which simplify() never drops.
const arcIndex = (i: number) => (i < 0 ? ~i : i);
const arcsOf = (a: unknown): number[] => (Array.isArray(a) ? a.flatMap(arcsOf) : [arcIndex(a as number)]);
for (const g of topo.objects.countries.geometries) {
  if (!fullDetail.has(String((g.properties as { id?: string } | undefined)?.id))) continue;
  for (const i of arcsOf((g as { arcs?: unknown }).arcs ?? [])) for (const p of topo.arcs[i]) p[2] = Infinity;
}
// Points on the 180° seam and along the poles are never dropped either. Simplification measures area on the sphere,
// where every point at 90°S is the same point, so it would remove all of Antarctica's pole edge (a point every 0.5° of
// longitude) and leave one edge from 180° to -180°. MapLibre triangulates in flat Mercator tiles, where that edge runs the
// width of the world, and the long thin triangles fanning from its two ends show as a dark wedge at the South Pole.
// The same goes for rings along the seam (Antarctica, Russia's Chukotka, Fiji).
const onSeamOrPole = (p: number[]) => Math.abs(p[0]) >= 180 - 1e-6 || Math.abs(p[1]) >= 90 - 1e-6;
for (const arc of topo.arcs) for (const p of arc) if (onSeamOrPole(p)) p[2] = Infinity;
const simplified = quantize(simplify(topo, quantile(topo, 1 - KEEP_POINTS)), 4e5);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/countries.topo.json`, JSON.stringify(simplified));
// Flags for the playable countries only (none for an empty `iso2`), from the flag-icons package (MIT licence), served from public/flags/.
mkdirSync('public/flags', { recursive: true });
for (const r of ROSTER) if (r.iso2) copyFileSync(`node_modules/flag-icons/flags/4x3/${r.iso2.toLowerCase()}.svg`, `public/flags/${r.iso2.toLowerCase()}.svg`);
copyFileSync('node_modules/flag-icons/LICENSE', 'public/flags/LICENSE.txt');
const write = (file: string, features: Feature[]) => writeFileSync(`${OUT}/${file}`, JSON.stringify(turf.featureCollection(features)));
write('halos.geojson', halos);
write('markers.geojson', markers);
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  builtAt: new Date().toISOString(),
  sources: [{ id: 'natural-earth', name: 'Natural Earth Admin 0 Countries 1:10m', url: NE_URL, commit: NE_COMMIT, licence: 'Public domain' }],
  counts: { shapes: shapes.length, playable: ROSTER.length, halos: halos.length, markers: markers.length },
}, null, 2));

const clashes: string[] = [];
for (let i = 0; i < halos.length; i++) for (let j = i + 1; j < halos.length; j++) {
  const both = intersecting(i, j) ? turf.intersect(turf.featureCollection([halos[i], halos[j]])) : null;
  // Touching edges are fine; a shared patch bigger than about 0.01 km² is not.
  if (both && turf.area(both) > 1e4) clashes.push(`${halos[i].properties.id}/${halos[j].properties.id}`);
}
console.log(`Wrote ${shapes.length} shapes (${ROSTER.length} playable), ${halos.length} halos, ${markers.length} markers.`);
console.log(`Halos: ${halos.map(h => h.properties.id).join(' ')}`);
if (clashes.length) throw new Error(`Halos still overlap: ${clashes.join(' ')}`);
// Every island of a halo country must lie inside its halo (on either side of 180°), or the halo misleads and misses clicks.
const inHalo = (h: Shape, [x, y]: number[]) => [0, 360, -360].some(d => turf.booleanPointInPolygon([x + d, y], h));
const uncovered = halos.flatMap(h => turf.flatten(byId.get(h.properties.id)!).features
  .filter(p => !inHalo(h, turf.pointOnFeature(p).geometry.coordinates)).map(() => h.properties.id));
if (uncovered.length) throw new Error(`Islands outside their halo: ${[...new Set(uncovered)].join(' ')}`);
