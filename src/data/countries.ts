import type { LngLat } from '../game/geo';
import { CONTINENTS, ROSTER, isClassic, type Continent, type RosterEntry } from './roster.ts';

// `region` is the UN geoscheme subregion carried in countries.topo.json (e.g. "Caribbean", "Western Africa").
export type Country = RosterEntry & { center: LngLat; region: string };
// Americas = North America + South America together.
export type Area = 'World' | 'Americas' | Continent;
export const AREAS: Area[] = ['World', 'Africa', 'Americas', 'North America', 'South America', 'Asia', 'Europe', 'Oceania'];
// The top tabs. North and South America are reached through the Americas tab's All / North / South switch.
export const TABS: Area[] = ['World', 'Africa', 'Americas', 'Europe', 'Asia', 'Oceania'];
export const AMERICAS: { area: Area; label: string }[] = [{ area: 'Americas', label: 'All' }, { area: 'North America', label: 'North' }, { area: 'South America', label: 'South' }];
export const tabOf = (a: Area): Area => (a === 'North America' || a === 'South America' ? 'Americas' : a);

// Where the camera goes when an area is chosen.
export const AREA_CAMERA: { [A in Area]: { center: LngLat; zoom: number } } = {
  World: { center: [-20, 22], zoom: 2.15 },
  Africa: { center: [18, 3], zoom: 2.6 },
  Americas: { center: [-78, 12], zoom: 2.1 },
  Asia: { center: [92, 30], zoom: 2.2 },
  Europe: { center: [16, 52], zoom: 3.2 },
  'North America': { center: [-92, 32], zoom: 2.3 },
  'South America': { center: [-60, -20], zoom: 2.6 },
  Oceania: { center: [160, -12], zoom: 2.4 },
};

export const STATUS_LABEL: { [S in RosterEntry['status']]: string } = {
  'un-member': 'UN member state',
  'un-observer': 'UN observer state',
  'partially-recognised': 'Partially recognised state',
  disputed: 'Disputed territory',
  territory: 'Territory',
};

// The two ways to play: ATLAS — 200 Countries (the default) or the Classic 195 (UN member and observer states).
export type CountrySet = '200' | '195';
export const SET_LABEL: { [S in CountrySet]: string } = { '200': 'ATLAS — 200 Countries', '195': 'Classic — 195 Countries' };
export const inSet = (c: RosterEntry, set: CountrySet) => set === '200' || isClassic(c);

// Joins the curated roster with the label point and region each shape carries in countries.topo.json.
export function indexCountries(shapes: GeoJSON.FeatureCollection): Map<string, Country> {
  const props = new Map(shapes.features.map(f => [String(f.properties?.id), f.properties ?? {}]));
  return new Map(ROSTER.map(r => {
    const p = props.get(r.id) ?? {};
    return [r.id, { ...r, center: [Number(p.lx), Number(p.ly)] as LngLat, region: String(p.region ?? '') }];
  }));
}

export const inArea = (c: Pick<RosterEntry, 'continent'>, area: Area) =>
  area === 'World' || c.continent === area || (area === 'Americas' && (c.continent === 'North America' || c.continent === 'South America'));
export { CONTINENTS };
