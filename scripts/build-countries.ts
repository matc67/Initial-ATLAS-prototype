// Builds the Level 1 country data from a pinned Natural Earth release.
// Run with `npm run data`. Writes to public/data/; the app never fetches upstream data at runtime.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { ROSTER } from '../src/data/roster.ts';

const NE_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const NE_FILE = 'ne_50m_admin_0_countries.geojson';
const NE_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_COMMIT}/geojson/${NE_FILE}`;
const RAW = `data-raw/${NE_COMMIT.slice(0, 7)}-${NE_FILE}`;
const OUT = 'public/data';

// Natural Earth draws these de facto areas separately; ATLAS shows the internationally recognised country.
const MERGE_INTO: Record<string, string> = { SOL: 'SOM', CYN: 'CYP' };
// Below this land area a country gets a ring marker at world zoom.
const TINY_KM2 = 3000;
// Island countries whose land is scattered over many small islands get a clickable halo around them.
// Listed by hand: an area-and-polygon-count rule also caught Kuwait, Haiti, Armenia and other mainland countries.
const ARCHIPELAGOS = new Set(['ATG', 'BHS', 'COM', 'CPV', 'FJI', 'FSM', 'KIR', 'KNA', 'MDV', 'MHL', 'MLT', 'PLW', 'SLB', 'STP', 'TON', 'TTO', 'VCT', 'VUT', 'WSM']);
// Wide enough that neighbouring islands merge into one shape per island group.
const HALO_KM = 60;

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

const round = <T extends Feature>(f: T) => turf.truncate(f, { precision: 3, coordinates: 2, mutate: true });

const raw = await loadRaw();
const byId = new Map<string, Shape>();
for (const f of raw.features as Shape[]) byId.set(f.properties.ADM0_A3, f);

for (const [from, to] of Object.entries(MERGE_INTO)) {
  const a = byId.get(to)!, b = byId.get(from)!;
  const merged = turf.union(turf.featureCollection([a, b])) as Shape;
  merged.properties = a.properties;
  byId.set(to, merged);
  byId.delete(from);
}

const roster = new Map(ROSTER.map(r => [r.id, r]));
const missing = ROSTER.filter(r => !byId.has(r.id)).map(r => r.id);
if (missing.length) throw new Error(`Roster ids not in Natural Earth: ${missing.join(', ')}`);

const shapes: Shape[] = [], halos: Shape[] = [], markers: Feature[] = [];
for (const [id, f] of byId) {
  const r = roster.get(id);
  const name = r?.name ?? f.properties.NAME_LONG;
  // `color` is Natural Earth's MAPCOLOR7 (1-7, no two neighbours alike); `lx`/`ly` is its label point, used for distances.
  const props = { id, name, playable: r ? 1 : 0, color: f.properties.MAPCOLOR7, lx: f.properties.LABEL_X, ly: f.properties.LABEL_Y };
  shapes.push(round(turf.feature(f.geometry, props)) as Shape);
  if (!r) continue;
  const km2 = turf.area(f) / 1e6;
  if (km2 < TINY_KM2) markers.push(turf.point([f.properties.LABEL_X, f.properties.LABEL_Y], { id }));
  if (ARCHIPELAGOS.has(id)) {
    // turf.buffer wraps longitudes into ±180, which tears islands on the 180° line (Fiji, Kiribati).
    // Those countries are rotated 180° east, buffered, and rotated back, leaving longitudes up to 360 that MapLibre wraps.
    const lons = turf.coordAll(f).map(c => c[0]);
    const crosses = Math.min(...lons) < -170 && Math.max(...lons) > 170;
    const shift = (g: Shape, by: number) => {
      const c = turf.clone(g);
      turf.coordEach(c, p => { p[0] = by < 0 ? (p[0] > 0 ? p[0] - 180 : p[0] + 180) : p[0] + 180; });
      return c;
    };
    const base = crosses ? shift(f, -180) : f;
    // Buffer island by island: one buffer around a whole archipelago is centred far from its outer islands.
    const islands = turf.flatten(base).features.map(p => turf.buffer(p, HALO_KM, { units: 'kilometers' })!);
    const merged = (islands.length > 1 ? turf.union(turf.featureCollection(islands)) : islands[0]) as Shape;
    const halo = crosses ? shift(merged, 180) : merged;
    halos.push(round(turf.simplify(turf.feature(halo.geometry, { id, color: props.color }), { tolerance: 0.02, highQuality: true })) as Shape);
  }
}

mkdirSync(OUT, { recursive: true });
const write = (file: string, features: Feature[]) => writeFileSync(`${OUT}/${file}`, JSON.stringify(turf.featureCollection(features)));
write('countries.geojson', shapes);
write('halos.geojson', halos);
write('markers.geojson', markers);
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  builtAt: new Date().toISOString(),
  sources: [{ id: 'natural-earth', name: 'Natural Earth Admin 0 Countries 1:50m', url: NE_URL, commit: NE_COMMIT, licence: 'Public domain' }],
  counts: { shapes: shapes.length, playable: ROSTER.length, halos: halos.length, markers: markers.length },
}, null, 2));
console.log(`Wrote ${shapes.length} shapes (${ROSTER.length} playable), ${halos.length} halos, ${markers.length} markers.`);
console.log(`Halos: ${halos.map(h => h.properties.id).join(' ')}`);
console.log(`Markers: ${markers.map(m => m.properties!.id).join(' ')}`);
