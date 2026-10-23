export type LngLat = [number, number];

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const toVec = ([lng, lat]: LngLat) => [Math.cos(rad(lat)) * Math.cos(rad(lng)), Math.cos(rad(lat)) * Math.sin(rad(lng)), Math.sin(rad(lat))];

export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Points along the shortest path between a and b, for the guess-to-answer line.
export function greatCircle(a: LngLat, b: LngLat, steps = 64): LngLat[] {
  const va = toVec(a), vb = toVec(b);
  const omega = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  if (omega < 1e-6) return [a, b];
  const points: LngLat[] = [];
  let prevLng = a[0];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, s1 = Math.sin((1 - t) * omega) / Math.sin(omega), s2 = Math.sin(t * omega) / Math.sin(omega);
    const v = [0, 1, 2].map(k => s1 * va[k] + s2 * vb[k]);
    let lng = deg(Math.atan2(v[1], v[0]));
    // Keep longitudes continuous so the line does not jump across the globe at 180°.
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    points.push([lng, deg(Math.asin(v[2]))]);
  }
  return points;
}

export const midpoint = (a: LngLat, b: LngLat): LngLat => { const p = greatCircle(a, b, 2); return p[1] ?? a; };
