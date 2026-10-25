export type LngLat = [number, number];

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The smallest box holding every point, as [west, south, east, north]. Longitudes wrap, so the box is chosen around the
// widest empty gap in longitude: a country across 180° (Fiji, Russia) gets east > 180 rather than a box around the world.
export function boundsOf(points: LngLat[]): [number, number, number, number] {
  if (!points.length) throw new Error('boundsOf: no points');
  const lons = [...new Set(points.map(p => p[0]))].sort((a, b) => a - b);
  let gap = lons[0] + 360 - lons[lons.length - 1], west = lons[0], east = lons[lons.length - 1];
  for (let i = 1; i < lons.length; i++) {
    const g = lons[i] - lons[i - 1];
    if (g > gap) { gap = g; west = lons[i]; east = lons[i - 1] + 360; }
  }
  const lats = points.map(p => p[1]);
  return [west, Math.min(...lats), east, Math.max(...lats)];
}

// Where to look to see all the points: the centre of their bounds and the distance to the farthest point.
export function frameOf(points: LngLat[]): { center: LngLat; radiusKm: number } {
  const [w, s, e, n] = boundsOf(points);
  const lng = ((w + e) / 2 + 540) % 360 - 180, center: LngLat = [lng, (s + n) / 2];
  return { center, radiusKm: Math.max(...points.map(p => distanceKm(center, p))) };
}
