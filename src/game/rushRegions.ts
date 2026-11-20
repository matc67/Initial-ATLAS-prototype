// Region borders in City Rush: whether a country has them, whether the player wants them, and what the globe draws.
// The geometry is the Regions game's own reviewed files (public/data/admin1, loaded one country at a time); City Rush only
// draws their internal borders and names. Countries without a file simply have no borders: nothing is approximated.
import type { SubdivisionIndex, SubdivisionSet } from '../data/subdivisions';
import type { LngLat } from './geo';

export type RushRegionLabel = { id: string; name: string; at: LngLat; box: [number, number, number, number] };
export type RushRegionData = { borders: GeoJSON.FeatureCollection; labels: RushRegionLabel[] };

// A country has borders to show when the subdivision index lists it (and has not switched it off).
export const regionsAvailable = (index: Pick<SubdivisionIndex, 'countries'> | null, country: string | null) =>
  !!(index && country && index.countries[country] && index.countries[country].enabled !== false);

// Whether to draw them: the player's choice when they can be drawn, and never when they cannot.
export const regionsShown = (pref: boolean, available: boolean) => pref && available;

function boxOf(g: GeoJSON.Geometry): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') { const [x, y] = c as number[]; w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    else if (Array.isArray(c)) c.forEach(walk);
  };
  if ('coordinates' in g) walk(g.coordinates);
  return [w, s, e, n];
}

// The globe's data from a loaded subdivision set: its internal borders, and one label per unit at its label point.
export function rushRegionsOf(set: Pick<SubdivisionSet, 'units' | 'borders'>): RushRegionData {
  return {
    borders: set.borders,
    labels: set.units.features.map(u => ({ id: u.properties.id, name: u.properties.name, at: u.properties.label, box: boxOf(u.geometry) })),
  };
}

// The player's choice, kept in this browser. On unless they turned it off; unreadable storage means on.
export const REGIONS_KEY = 'atlas-city-rush-regions-v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export function loadShowRegions(from: Storage | null = storage()): boolean {
  try { return from?.getItem(REGIONS_KEY) !== 'off'; } catch { return true; }
}
export function saveShowRegions(on: boolean, to: Storage | null = storage()) {
  try { to?.setItem(REGIONS_KEY, on ? 'on' : 'off'); } catch { /* kept for this visit */ }
}
