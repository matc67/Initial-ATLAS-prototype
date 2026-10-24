// Camera views for the Pacific, where Oceania's countries are scattered over a third of the globe and across 180°.
// Pure, so the views are checked against the real country positions in regions.test.ts.
import type { LngLat } from '../game/geo';

export type RegionView = { id: string; label: string; title: string; center: LngLat; zoom: number };

// The whole of Oceania, then three broad parts of it. A view frames a wide stretch of ocean holding several countries,
// never one country, so moving the camera never points at the answer. `title` is the accessible name.
export const PACIFIC_VIEWS: RegionView[] = [
  { id: 'all', label: 'All', title: 'Show all of Oceania', center: [167, -10], zoom: 2.45 },
  { id: 'west', label: 'West', title: 'Show the western Pacific', center: [150, -1], zoom: 3.1 },
  { id: 'central', label: 'Central', title: 'Show the central Pacific', center: [176, 2], zoom: 2.95 },
  { id: 'south', label: 'South', title: 'Show the southern Pacific', center: [175, -20], zoom: 3 },
];

// The point on the sphere nearest to all of `points` on average (the mean of their unit vectors). Works across the 180°
// line: the mean of 179°E and 179°W is 180°, where a plain average of longitudes would give 0°.
export function sphericalCenter(points: LngLat[]): LngLat {
  let x = 0, y = 0, z = 0;
  for (const [lng, lat] of points) {
    const a = (lng * Math.PI) / 180, b = (lat * Math.PI) / 180;
    x += Math.cos(b) * Math.cos(a); y += Math.cos(b) * Math.sin(a); z += Math.sin(b);
  }
  return [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI];
}

// Great-circle distance in degrees.
export function angularDistance([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a))) * 180) / Math.PI;
}

// How far from the view centre (in degrees) a point can be and still lie within `halfPx` screen pixels of it. MapLibre's
// globe radius is worldSize / 2π / cos(centre latitude) pixels (see GlobeView.placeFx); the point is seen at R·sin(angle).
export function visibleRadiusDeg(zoom: number, centerLat: number, halfPx: number): number {
  const R = (512 * 2 ** zoom) / (2 * Math.PI) / Math.cos((centerLat * Math.PI) / 180);
  return halfPx >= R ? 90 : (Math.asin(halfPx / R) * 180) / Math.PI;
}
