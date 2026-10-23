import type { LngLat } from '../game/geo';
import { CONTINENTS, ROSTER, type Continent, type RosterEntry } from './roster';

export type Country = RosterEntry & { center: LngLat };
export type Area = 'World' | Continent;
export const AREAS: Area[] = ['World', ...CONTINENTS];

// Where the camera goes when an area is chosen.
export const AREA_CAMERA: { [A in Area]: { center: LngLat; zoom: number } } = {
  World: { center: [-20, 22], zoom: 1.9 },
  Africa: { center: [18, 3], zoom: 2.6 },
  Asia: { center: [92, 30], zoom: 2.2 },
  Europe: { center: [16, 52], zoom: 3.2 },
  'North America': { center: [-92, 32], zoom: 2.3 },
  'South America': { center: [-60, -20], zoom: 2.6 },
  Oceania: { center: [160, -12], zoom: 2.4 },
};

export const STATUS_LABEL: { [S in RosterEntry['status']]: string } = {
  'un-member': 'UN member state',
  'un-observer': 'UN observer state',
};

// Joins the curated roster with the label point each shape carries in countries.geojson.
export function indexCountries(shapes: GeoJSON.FeatureCollection): Map<string, Country> {
  const centers = new Map(shapes.features.map(f => [String(f.properties?.id), [Number(f.properties?.lx), Number(f.properties?.ly)] as LngLat]));
  return new Map(ROSTER.map(r => [r.id, { ...r, center: centers.get(r.id) ?? [0, 0] }]));
}

export const inArea = (c: Country, area: Area) => area === 'World' || c.continent === area;
