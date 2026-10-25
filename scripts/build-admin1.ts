// Builds first-level subdivisions (provinces, states, territories…) from a pinned Natural Earth release, one file per
// country in src/data/admin1Profiles.ts. Run with `npm run admin1`. See docs/subdivisions.md.
//
// The country map is the authority and is never changed here: each subdivision is clipped to the country's shape in
// public/data/countries.topo.json, the land between the subdivisions' coastline and the country's (the two are simplified
// separately) is given to the nearest subdivision, and the output is quantised on the country file's own grid. So the
// subdivisions cover the drawn country exactly, and anything that does not fit is measured and reported as a flag.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { topology } from 'topojson-server';
import { feature, mesh, neighbors, quantize } from 'topojson-client';
import { presimplify, quantile, simplify, sphericalTriangleArea } from 'topojson-simplify';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { PROFILES, validateProfile, type Admin1Unit } from '../src/data/admin1Profiles.ts';
import { shapeDistanceKm, shapeOf, verticesOf } from '../src/game/distance.ts';
import { boundsOf, frameOf, type LngLat } from '../src/game/geo.ts';
import { versionOf } from '../src/game/challenges.ts';

const NE_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const NE_FILE = 'ne_10m_admin_1_states_provinces.geojson';
const NE_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_COMMIT}/geojson/${NE_FILE}`;
const RAW = `data-raw/${NE_COMMIT.slice(0, 7)}-${NE_FILE}`;
const COUNTRIES = 'public/data/countries.topo.json';
const OUT = 'public/data/admin1';
// Units closer than this across water count as neighbours for colouring, so a strait never joins two same-coloured units
// (Prince Edward Island and Nova Scotia are 13 km apart).
const NEAR_KM = 50;
// Share of points kept when simplifying the subdivisions' own borders, as for country borders (build-countries.ts).
const KEEP_POINTS = 0.5;
// A disagreement between the subdivision data and the country map is reported for review when it is larger than both of
// these. The two coastlines are simplified separately, so every unit differs a little (up to ~0.05% for Canada's);
// a real disagreement, such as a region on land the country map gives to another country, is far larger.
const FLAG_KM2 = 1, FLAG_SHARE = 0.005;
// Framing looks at the parts that make up this share of a unit's land, largest first, so a scatter of islets far away
// (the Northwestern Hawaiian Islands, the western Aleutians) does not shrink the unit to a speck. They are still drawn
// and clickable; only the camera ignores them.
const CORE_SHARE = 0.99;

type Shape = Feature<Polygon | MultiPolygon, Record<string, any>>;
type Unit = { key: string; unit: Admin1Unit; rows: Shape[]; shape: Shape };

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

const km2 = (f: Feature | null) => (f ? turf.area(f) / 1e6 : 0);
const fc = <G extends GeoJSON.Geometry>(fs: Feature<G>[]) => turf.featureCollection<G>(fs);
// Puts every point on the country file's grid. The country's own points are already on it (decoded from the same
// transform, with the same arithmetic), so after snapping, an edge two pieces share has identical points and becomes one
// arc in the topology. Rings that collapse to nothing on the grid are dropped.
function snapper(t: { scale: [number, number]; translate: [number, number] }) {
  const [kx, ky] = t.scale, [dx, dy] = t.translate;
  const ring = (r: number[][]) => {
    const out: number[][] = [];
    for (const [x, y] of r) {
      const p = [Math.round((x - dx) / kx) * kx + dx, Math.round((y - dy) / ky) * ky + dy];
      const q = out[out.length - 1];
      if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
    }
    const [a, b] = [out[0], out[out.length - 1]];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push(a);
    return out.length >= 4 && Math.abs(turf.area(turf.polygon([out]))) > 0 ? out : null;
  };
  return (f: Shape): Shape | null => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
      .map(p => { const [outer, ...holes] = p.map(ring); return outer ? [outer, ...holes.filter(h => h)] as number[][][] : null; })
      .filter((p): p is number[][][] => !!p);
    return polys.length ? turf.feature({ type: 'MultiPolygon', coordinates: polys }, f.properties) as Shape : null;
  };
}

const union = (fs: Shape[]): Shape | null => (fs.length === 0 ? null : fs.length === 1 ? fs[0] : (turf.union(fc(fs)) as Shape | null));

// Simplifies the units' borders together, so a border two units share is simplified once and stays shared. Also returns
// those shared borders as lines: they are drawn as the internal borders. (The clipped shapes below are for fills and
// clicks; clipping can add a point to one side of a border and not the other, so their edges are not used as lines.)
function simplifyTogether(units: Unit[]): { shapes: Shape[]; borders: GeoJSON.MultiLineString; touching: number[][] } {
  const topo = presimplify(topology({ units: fc(units.map(u => u.shape)) }, 1e6) as Topology<{ units: GeometryCollection }>, sphericalTriangleArea);
  const simple = simplify(topo, quantile(topo, 1 - KEEP_POINTS));
  const out = feature(simple, simple.objects.units) as FeatureCollection;
  return { shapes: out.features as Shape[], borders: mesh(simple, simple.objects.units as any, (a, b) => a !== b), touching: touchingOf(simple) };
}

// Units that touch (from the source topology, where shared borders are exact: after clipping, a border can stop being one
// shared arc, which would hide that two units touch).
const touchingOf = (topo: Topology<{ units: GeometryCollection }>) => neighbors(topo.objects.units.geometries as any).map((ns, i) => ns.filter(j => j !== i));

// Neighbours never share a colour: greedy colouring, most-connected first, over the 7 classes of the country palette.
// Each unit takes the least-used colour its neighbours leave free, so the palette is spread rather than three colours.
function colours(adj: number[][]): number[] {
  const order = adj.map((n, i) => [i, n.length]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i]) => i);
  const colour: number[] = [], used = new Map<number, number>();
  for (const i of order) {
    const taken = new Set(adj[i].map(j => colour[j]));
    const free = [1, 2, 3, 4, 5, 6, 7].filter(c => !taken.has(c));
    colour[i] = free.sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0) || a - b)[0] ?? 1;
    used.set(colour[i], (used.get(colour[i]) ?? 0) + 1);
  }
  return colour;
}

// The points of a shape's core: its parts, largest first, until they hold CORE_SHARE of its area.
function corePoints(shape: Shape): LngLat[] {
  const parts = turf.flatten(shape).features.map(f => ({ f, a: turf.area(f) })).sort((x, y) => y.a - x.a);
  const total = parts.reduce((n, x) => n + x.a, 0), core: typeof parts = [];
  let sum = 0;
  for (const x of parts) { if (core.length && sum >= CORE_SHARE * total) break; core.push(x); sum += x.a; }
  return core.flatMap(x => verticesOf(x.f.geometry));
}
const rounded = ({ center, radiusKm }: { center: LngLat; radiusKm: number }) => ({ center: center.map(x => +x.toFixed(3)), radiusKm: Math.round(radiusKm) });

// A point on the unit's land for labels and flights: Natural Earth's label point when it is on the land, otherwise a
// point on the largest part.
function labelOf(shape: Shape, ne: LngLat): LngLat {
  if (turf.booleanPointInPolygon(ne, shape)) return ne;
  const largest = turf.flatten(shape).features.reduce((a, b) => (turf.area(b) > turf.area(a) ? b : a));
  return turf.pointOnFeature(largest).geometry.coordinates as LngLat;
}

const raw = await loadRaw();
const countryText = readFileSync(COUNTRIES, 'utf8');
const countryTopo = JSON.parse(countryText) as Topology<{ countries: GeometryCollection }>;
const countryShapes = new Map((feature(countryTopo, countryTopo.objects.countries) as FeatureCollection).features.map(f => [String(f.properties?.id), f as Shape]));
mkdirSync(OUT, { recursive: true });

const index: Record<string, unknown> = {};
const files: string[] = [];
for (const p of PROFILES) {
  const t0 = performance.now();
  const rows = raw.features.filter(f => p.sources.includes(f.properties?.adm0_a3)) as Shape[];
  const keyOf = (f: Shape) => String(p.groupBy ? f.properties[p.groupBy] : f.properties[p.key]);
  const errors = validateProfile(p, [...new Set(rows.map(keyOf))]);
  if (errors.length) throw new Error(`${p.country} profile:\n  ${errors.join('\n  ')}`);
  const country = countryShapes.get(p.country);
  if (!country) throw new Error(`${p.country} has no shape in ${COUNTRIES}`);
  const flags: string[] = [];

  // 1. Source rows → units (merged when the profile groups them), simplified together.
  const units: Unit[] = Object.entries(p.units).map(([key, unit]) => {
    const own = rows.filter(r => keyOf(r) === key);
    return { key, unit, rows: own, shape: union(own.map(r => turf.feature(r.geometry, {}) as Shape))! };
  });
  const simplified = simplifyTogether(units);
  simplified.shapes.forEach((s, i) => { units[i].shape = s; });

  // 2. Clip to the country, each unit against the ones before it, so they never overlap.
  let taken: Shape | null = null;
  const pieces: (Shape | null)[] = [];
  for (const u of units) {
    let piece = turf.intersect(fc([country, u.shape])) as Shape | null;
    const outside = km2(u.shape) - km2(piece);
    if (outside > FLAG_KM2 && outside > FLAG_SHARE * km2(u.shape)) flags.push(`${u.unit.code}: ${Math.round(outside).toLocaleString('en-US')} km² of the source unit lies outside ATLAS's ${p.country} and was left out`);
    if (piece && taken) piece = turf.difference(fc([piece, taken])) as Shape | null;
    if (!piece) throw new Error(`${p.country} ${u.unit.code}: no land inside the country (exclude it in the profile, with a reason)`);
    pieces.push(piece);
    taken = taken ? (turf.union(fc([taken, piece])) as Shape) : piece;
  }

  // 3. Land of the country covered by no unit (slivers between two simplified coastlines, mostly) → the nearest unit.
  const rest = taken ? (turf.difference(fc([country, taken])) as Shape | null) : country;
  const slivers = rest ? turf.flatten(rest).features : [];
  const unitShapes = pieces.map(s => shapeOf(verticesOf(s!.geometry)));
  const extra: Shape[][] = units.map(() => []);
  let unassigned = 0;
  for (const s of slivers) {
    const sh = shapeOf(verticesOf(s.geometry));
    let best = 0, bestKm = Infinity;
    unitShapes.forEach((u, i) => { const d = shapeDistanceKm(sh, u); if (d < bestKm) { bestKm = d; best = i; } });
    extra[best].push(s as Shape);
    unassigned += km2(s);
    if (km2(s) > FLAG_KM2 && km2(s) > FLAG_SHARE * km2(units[best].shape)) flags.push(`${Math.round(km2(s)).toLocaleString('en-US')} km² of ${p.country} in no source unit was given to ${units[best].unit.code}`);
  }
  // Each unit's piece and its slivers are joined on the country file's grid. Snapped first, the edges they share have
  // identical points, which the polygon union handles reliably (unsnapped, near-coincident coastlines make it fail).
  const snap = snapper(countryTopo.transform as { scale: [number, number]; translate: [number, number] });
  const finals = pieces.map((piece, i) => {
    const parts = [piece!, ...extra[i]].map(s => snap(s)).filter((s): s is Shape => !!s);
    return snap(union(parts)!)!;
  });

  // 4. Properties, colours and output on the country file's grid.
  const features = finals.map((shape, i) => {
    const u = units[i], first = u.rows[0].properties;
    return turf.feature(shape.geometry, {
      id: `admin1:${p.country}:${u.unit.code}`, country: p.country, code: u.unit.code, name: u.unit.name, kind: u.unit.kind,
      aliases: u.unit.aliases ?? [], ...(u.unit.abbrev ? { abbrev: u.unit.abbrev } : {}),
      ...(u.unit.playable === false ? { playable: false, note: u.unit.note } : {}),
      label: labelOf(shape, [Number(first.longitude), Number(first.latitude)]).map(x => +x.toFixed(4)),
      km2: Math.round(km2(shape)),
      // Where to look to see the whole unit (Name the Region flies to each one), valid across 180°.
      frame: rounded(frameOf(corePoints(shape))),
      src: { ne: u.rows.map(r => Number(r.properties.ne_id)), ...(p.groupBy ? {} : { iso: first.iso_3166_2 }), ...(first.wikidataid && !p.groupBy ? { wikidata: first.wikidataid } : {}) },
    });
  });
  const borders = turf.feature(simplified.borders, { country: p.country });
  const topo = quantize(topology({ units: fc(features), borders: fc([borders]) }) as Topology<{ units: GeometryCollection; borders: GeometryCollection }>, countryTopo.transform!) as Topology<{ units: GeometryCollection; borders: GeometryCollection }>;
  // Colours: units that touch, plus units within NEAR_KM of each other across water.
  const adj = simplified.touching.map((ns, i) => [...new Set([...ns, ...unitShapes.flatMap((u, j) => (j !== i && shapeDistanceKm(unitShapes[i], u) < NEAR_KM ? [j] : []))])]);
  colours(adj).forEach((c, i) => { (topo.objects.units.geometries[i].properties as Record<string, unknown>).color = c; });
  const file = `admin1/${p.country}.topo.json`, text = JSON.stringify(topo);
  writeFileSync(`public/data/${file}`, text);
  files.push(text);

  // The country is framed by every unit's core, so each unit is in view (Hawaii and Alaska with the 48 states).
  const points = finals.flatMap(corePoints);
  // Counts, kinds and the fingerprint cover the playable units only: those are the challenges. Units on the map but not
  // played (Washington, DC) are listed apart, with the reason.
  const kinds: Record<string, number> = {};
  const played = units.filter(u => u.unit.playable !== false);
  for (const u of played) kinds[u.unit.kind] = (kinds[u.unit.kind] ?? 0) + 1;
  const others = features.filter(f => f.properties.playable === false).map(f => ({ id: f.properties.id, name: f.properties.name, kind: f.properties.kind, note: f.properties.note }));
  index[p.country] = {
    enabled: p.enabled, file, count: played.length, kinds, terms: p.terms,
    ...(others.length ? { others } : {}),
    // The fingerprint of the unit list: challenge record keys are built from it (subdivisionKey), so Progress can show a
    // country's records without loading its file.
    unitsVersion: versionOf(features.filter(f => f.properties.playable !== false).map(f => f.properties.id)),
    bounds: boundsOf(points).map(x => +x.toFixed(3)), frame: rounded(frameOf(points)),
    flags,
  };
  console.log(`${p.country}: ${played.length} units${others.length ? ` (+${others.length} not played)` : ''}, ${(text.length / 1024).toFixed(0)} KB, ${Math.round(unassigned).toLocaleString('en-US')} km² of coastline slivers assigned, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  for (const f of flags) console.log(`  flag: ${f}`);
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
writeFileSync(`${OUT}/index.json`, JSON.stringify({
  version: hash(files.join('')).slice(0, 12),
  builtAt: new Date().toISOString(),
  source: { name: 'Natural Earth Admin 1 States and Provinces 1:10m', url: NE_URL, commit: NE_COMMIT, licence: 'Public domain' },
  countryData: { file: 'countries.topo.json', sha256: hash(countryText) },
  countries: index,
}, null, 2));
console.log(`Wrote ${OUT}/index.json (${PROFILES.length} ${PROFILES.length === 1 ? 'country' : 'countries'}).`);
