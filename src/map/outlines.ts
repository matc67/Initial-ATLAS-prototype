// Country borders, drawn from the country shapes minus the edges that are not borders at all. Natural Earth closes rings
// that cross 180° along the 180° meridian (Russia's Chukotka, Fiji, Antarctica) and closes Antarctica along 90°S. Drawn
// as lines, those cuts show as a straight seam across land and, at the South Pole, as a ring at the Mercator limit.

const EPS = 1e-6;
const onSeam = (p: number[]) => Math.abs(p[0]) >= 180 - EPS;
const onPole = (p: number[]) => Math.abs(p[1]) >= 90 - EPS;
// An edge is a cut, not a border, when both ends lie on the same side of the 180° seam, or both lie on a pole.
export const isCut = (a: number[], b: number[]) => (onSeam(a) && onSeam(b) && Math.sign(a[0]) === Math.sign(b[0])) || (onPole(a) && onPole(b));

// Splits a ring into the runs of consecutive real border edges.
export function borderRuns(ring: number[][]): number[][][] {
  const runs: number[][][] = [];
  let run: number[][] = [];
  for (let i = 1; i < ring.length; i++) {
    if (isCut(ring[i - 1], ring[i])) { if (run.length > 1) runs.push(run); run = []; continue; }
    if (!run.length) run.push(ring[i - 1]);
    run.push(ring[i]);
  }
  if (run.length > 1) runs.push(run);
  // The ring is closed, so when neither its first nor its last edge is a cut, the last run continues into the first.
  const n = ring.length;
  if (runs.length > 1 && !isCut(ring[0], ring[1]) && !isCut(ring[n - 2], ring[n - 1])) runs[0] = [...runs.pop()!, ...runs[0].slice(1)];
  return runs;
}

// One MultiLineString per country, with the same id and properties, so feature-state styling works as on the shapes.
export function outlinesOf(shapes: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  return {
    type: 'FeatureCollection',
    features: shapes.features.flatMap(f => {
      const g = f.geometry;
      if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return [];
      const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
      return [{ type: 'Feature' as const, properties: f.properties, geometry: { type: 'MultiLineString' as const, coordinates: rings.flatMap(borderRuns) } }];
    }),
  };
}

// Approximate area of a ring in km² (shoelace on longitude scaled by the cosine of its mean latitude). Close enough to
// tell a 3 km² atoll from a 3,000 km² island, which is all it is used for.
export function ringKm2(ring: number[][]): number {
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * Math.PI / 180, k = Math.cos(lat0), KM = 111.32;
  let a = 0;
  for (let i = 1; i < ring.length; i++) a += ring[i - 1][0] * k * ring[i][1] - ring[i][0] * k * ring[i - 1][1];
  return Math.abs(a / 2) * KM * KM;
}

// The outer coastlines of islands below `maxKm2`, per country. These are the islands a fill can miss at globe zoom
// (a fill only covers pixels whose centre is inside it); GlobeView traces them in the land's colour so they always show.
// Large landmasses fill reliably, so they are left out, which keeps the extra line geometry to a few percent.
export function isletsOf(shapes: GeoJSON.FeatureCollection, maxKm2: number): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  return {
    type: 'FeatureCollection',
    features: shapes.features.flatMap(f => {
      const g = f.geometry;
      if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return [];
      const outers = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(p => p[0]).filter(r => ringKm2(r) < maxKm2);
      const lines = outers.flatMap(borderRuns);
      return lines.length ? [{ type: 'Feature' as const, properties: f.properties, geometry: { type: 'MultiLineString' as const, coordinates: lines } }] : [];
    }),
  };
}
