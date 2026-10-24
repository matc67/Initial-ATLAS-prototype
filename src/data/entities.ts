// The geographic hierarchy ATLAS grows into: World → Continent → Country → first-level division → City.
// Only the first three levels are playable today; cities come from places.json and divisions are not loaded yet.
// See docs/geography.md for how states, provinces and cities plug in.
import { CONTINENTS, ROSTER, type Continent } from './roster.ts';
import type { City } from './places.ts';

export type EntityType = 'world' | 'continent' | 'country' | 'admin1' | 'city';

// Stable ids, one namespace per level, so a city and a country can never collide:
//   world · continent:north-america · country:CAN · admin1:CAN:<source id> · city:ne:1159151299
// Country ids are the roster's Natural Earth ADM0_A3 codes; city ids are Natural Earth ne_id values.
export type GeographicEntity = {
  id: string;
  type: EntityType;
  name: string;
  parentId?: string;
  countryId?: string;      // the roster id of the country it belongs to (countries point to themselves)
  center?: [lng: number, lat: number];
  geometryId?: string;     // the feature id in the map source that draws it, when it has a shape
};

// What a country calls its first-level divisions. Never assume "states" or "provinces": Japan has prefectures, France
// regions, Switzerland cantons, Egypt governorates, and many countries mix several kinds (Canada: provinces and territories).
// Filled in per country from the boundary dataset when Level 2 arrives; nothing is guessed in the meantime.
export type AdminTerms = { singular: string; plural: string; kinds?: { singular: string; plural: string }[] };

export const WORLD_ID = 'world';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const continentId = (c: Continent) => `continent:${slug(c)}`;
export const countryEntityId = (rosterId: string) => `country:${rosterId}`;
export const cityEntityId = (c: Pick<City, 'id'>) => `city:${c.id}`;

export function baseEntities(): GeographicEntity[] {
  return [
    { id: WORLD_ID, type: 'world', name: 'World' },
    ...CONTINENTS.map(c => ({ id: continentId(c), type: 'continent' as const, name: c, parentId: WORLD_ID })),
    ...ROSTER.map(r => ({ id: countryEntityId(r.id), type: 'country' as const, name: r.name, parentId: continentId(r.continent), countryId: r.id, geometryId: r.id })),
  ];
}

// Cities hang off their country for now. Once divisions load, `parentId` becomes the division the city lies in (matched by
// geometry, not by name: Natural Earth's admin1 names and the boundary dataset's names do not always agree).
export const cityEntity = (c: City): GeographicEntity =>
  ({ id: cityEntityId(c), type: 'city', name: c.name, parentId: countryEntityId(c.country), countryId: c.country, center: [c.lng, c.lat] });

// The chain from an entity up to the world, nearest first.
export function ancestors(id: string, index: Map<string, GeographicEntity>): GeographicEntity[] {
  const out: GeographicEntity[] = [];
  for (let e = index.get(index.get(id)?.parentId ?? ''); e; e = index.get(e.parentId ?? '')) out.push(e);
  return out;
}
export const indexEntities = (list: GeographicEntity[]) => new Map(list.map(e => [e.id, e]));
