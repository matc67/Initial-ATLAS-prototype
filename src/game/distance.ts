// How far apart two countries are, for Mystery Country. Pure, so it is tested against the real map data.
//
// Definition (used everywhere in the mode): the shortest great-circle distance between the land of the two countries,
// measured between the vertices of their shapes in countries.topo.json, the same shapes the globe draws and takes clicks
// on. So:
// - Neighbours are 0 km: shared borders are stored once in the TopoJSON, so both shapes have the same vertices.
// - Water does not matter: Spain and Morocco, or Indonesia and Australia, are as close as their nearest coasts.
// - A country's distant islands count, because they are part of its shape (Alaska and Hawaii for the United States).
//   Overseas regions that ATLAS does not play as part of a country are separate shapes (e.g. "France (overseas)") and
//   never count towards it, so French Guiana does not make France a neighbour of Brazil.
// - Points are unit vectors on the sphere, so the 180° meridian needs no special case (Fiji, Kiribati, Russia).
// The vertex spacing of the simplified shapes (a few km) is the error bound: two coasts can be up to about half a
// vertex gap closer than reported.
//
// Speed: Canada has ~32,000 vertices and Russia ~19,000, so comparing every pair is out of the question. Each shape's
// vertices are grouped into small clusters (about 190 km across) inside large ones (about 1,300 km), each with a centre
// and a radius. A cluster pair can only hold points closer than (centre distance − both radii), so pairs are visited
// nearest-bound first and skipped once that bound passes the best distance found. The answer is still the exact
// minimum over all vertex pairs.
import type { LngLat } from './geo.ts';

const R = 6371;
type Cluster = { x: number; y: number; z: number; r: number; pts: Float64Array };       // r in radians; pts: xyz triples
type Group = { x: number; y: number; z: number; r: number; clusters: Cluster[] };
export type Shape = { groups: Group[]; count: number };

const SMALL = 0.03, LARGE = 0.2;   // grid cell sizes on the unit sphere (chord length): ~190 km and ~1,300 km

const angle = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
  Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));

function toVec([lng, lat]: LngLat): [number, number, number] {
  const p = (lat * Math.PI) / 180, l = (lng * Math.PI) / 180;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

// Groups unit vectors (xyz triples) into grid cells of `size`, each with its normalised centre and angular radius.
function cells<T>(items: { v: [number, number, number]; item: T }[], size: number) {
  const byCell = new Map<string, { v: [number, number, number]; item: T }[]>();
  for (const it of items) {
    const key = `${Math.floor(it.v[0] / size)},${Math.floor(it.v[1] / size)},${Math.floor(it.v[2] / size)}`;
    const list = byCell.get(key);
    if (list) list.push(it); else byCell.set(key, [it]);
  }
  return [...byCell.values()].map(list => {
    let x = 0, y = 0, z = 0;
    for (const { v } of list) { x += v[0]; y += v[1]; z += v[2]; }
    const n = Math.hypot(x, y, z) || 1;
    x /= n; y /= n; z /= n;
    return { x, y, z, list };
  });
}

// Prepares a country's shape for distance queries. `points` is every vertex of its (Multi)Polygon.
export function shapeOf(points: LngLat[]): Shape {
  const seen = new Set<string>(), vecs: { v: [number, number, number]; item: null }[] = [];
  for (const p of points) {
    const k = `${p[0]},${p[1]}`;
    if (!seen.has(k)) { seen.add(k); vecs.push({ v: toVec(p), item: null }); }
  }
  const small = cells(vecs, SMALL).map(c => {
    const pts = new Float64Array(c.list.length * 3);
    let r = 0;
    c.list.forEach(({ v }, i) => { pts.set(v, i * 3); r = Math.max(r, angle(c.x, c.y, c.z, v[0], v[1], v[2])); });
    return { x: c.x, y: c.y, z: c.z, r, pts } as Cluster;
  });
  const groups = cells(small.map(c => ({ v: [c.x, c.y, c.z] as [number, number, number], item: c })), LARGE).map(g => {
    const clusters = g.list.map(i => i.item);
    const r = Math.max(...clusters.map(c => angle(g.x, g.y, g.z, c.x, c.y, c.z) + c.r));
    return { x: g.x, y: g.y, z: g.z, r, clusters };
  });
  return { groups, count: vecs.length };
}

// Every vertex of a GeoJSON Polygon or MultiPolygon.
export function verticesOf(g: GeoJSON.Geometry | null | undefined): LngLat[] {
  const out: LngLat[] = [];
  const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') out.push([c[0], c[1] as number]); else if (Array.isArray(c)) c.forEach(walk); };
  if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) walk(g.coordinates);
  return out;
}

// Visits pairs of bounded things nearest-bound first, skipping the rest once a bound reaches `best()`.
function nearest<A extends { x: number; y: number; z: number; r: number }, B extends A>(as: A[], bs: B[], best: () => number, visit: (a: A, b: B) => void) {
  const pairs: [number, A, B][] = [];
  for (const a of as) for (const b of bs) pairs.push([angle(a.x, a.y, a.z, b.x, b.y, b.z) - a.r - b.r, a, b]);
  pairs.sort((p, q) => p[0] - q[0]);
  for (const [bound, a, b] of pairs) { if (bound >= best()) break; visit(a, b); }
}

// The distance in km between two prepared shapes (0 when they touch). Infinity if either has no vertices.
export function shapeDistanceKm(a: Shape, b: Shape): number {
  if (!a.count || !b.count) return Infinity;
  let best = Infinity;
  nearest(a.groups, b.groups, () => best, (ga, gb) => nearest(ga.clusters, gb.clusters, () => best, (ca, cb) => {
    // The exact minimum between two small clusters: the largest dot product is the smallest angle.
    let dot = -2;
    const p = ca.pts, q = cb.pts;
    for (let i = 0; i < p.length; i += 3) for (let j = 0; j < q.length; j += 3) {
      const d = p[i] * q[j] + p[i + 1] * q[j + 1] + p[i + 2] * q[j + 2];
      if (d > dot) dot = d;
    }
    best = Math.min(best, Math.acos(Math.max(-1, Math.min(1, dot))));
  }));
  // Shared vertices give 0 up to rounding; anything under 1 km is a shared border.
  const km = best * R;
  return km < 1 ? 0 : km;
}

// Distances between countries by id, from their GeoJSON shapes. Shapes are prepared on first use and results cached,
// so the first guess against a large country costs a few milliseconds and repeats cost nothing.
export class CountryDistances {
  private shapes = new Map<string, Shape>();
  private cache = new Map<string, number>();
  private geometry: Map<string, GeoJSON.Geometry>;
  constructor(features: GeoJSON.Feature[]) {
    this.geometry = new Map(features.filter(f => f.geometry).map(f => [String(f.properties?.id), f.geometry]));
  }
  has(id: string) { return verticesOf(this.geometry.get(id)).length > 0; }
  // Prepares a shape ahead of time (e.g. the mystery's, at the start), so the first guess against it is instant.
  warm(id: string) { this.shape(id); }
  private shape(id: string) {
    let s = this.shapes.get(id);
    if (!s) { s = shapeOf(verticesOf(this.geometry.get(id))); this.shapes.set(id, s); }
    return s;
  }
  // km between two countries; null when either shape is missing (never guessed as a distance, see mystery.ts).
  km(a: string, b: string): number | null {
    if (a === b) return 0;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let d = this.cache.get(key);
    if (d === undefined) { d = shapeDistanceKm(this.shape(a), this.shape(b)); this.cache.set(key, d); }
    return Number.isFinite(d) ? d : null;
  }
}
