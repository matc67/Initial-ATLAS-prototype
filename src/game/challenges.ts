// A challenge is one fixed set of things to find, with one way of answering. Records belong to a challenge, so results are
// only ever compared with runs of the same challenge. The scoring rules (scoring.ts) work on plain ids and do not care
// whether those ids are countries, provinces or cities; only the map interaction and name matching differ per kind.
import { inArea, inSet, type Area, type CountrySet } from '../data/countries.ts';
import { ROSTER } from '../data/roster.ts';
import type { EntityType } from '../data/entities.ts';

// `map-click`: a polygon (or a ring for tiny countries) is clicked on the globe. `text-entry`: the answer is typed.
// Future city challenges add `point-click`, a click within a tolerance of a city's coordinates (see docs/geography.md).
export type Interaction = 'map-click' | 'text-entry';
export type GameMode = 'find' | 'name';

export type GeographyChallenge = {
  id: string;              // stable: e.g. "world-countries-find", "africa-countries-classic-name"
  name: string;            // "World countries"
  entityType: EntityType;  // what the targets are
  scopeId: string;         // the entity the challenge covers: "world", "continent:africa"…
  interaction: Interaction;
  targetIds: string[];     // what is asked, as map/roster ids
  // Changes whenever the target list changes (a roster edit, a new country), so records from a different list of
  // countries are never ranked against this one.
  version: string;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const SCOPE: { [A in Area]: string } = {
  World: 'world', Africa: 'continent:africa', Americas: 'region:americas', 'North America': 'continent:north-america',
  'South America': 'continent:south-america', Asia: 'continent:asia', Europe: 'continent:europe', Oceania: 'continent:oceania',
};

// A short, order-independent fingerprint of the target ids (FNV-1a), prefixed with the count for readability.
export function versionOf(ids: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [...ids].sort().join(',')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return `${ids.length}-${(h >>> 0).toString(36)}`;
}

// The roster ids of an area in a country set, the same list a full round plays.
export const countryIds = (area: Area, set: CountrySet) => ROSTER.filter(r => inArea(r, area) && inSet(r, set)).map(r => r.id);

export function countryChallenge(area: Area, set: CountrySet, mode: GameMode, ids = countryIds(area, set)): GeographyChallenge {
  return {
    id: `${slug(area)}-countries${set === '195' ? '-classic' : ''}-${mode}`,
    name: `${area === 'World' ? 'World' : area} countries`,
    entityType: 'country', scopeId: SCOPE[area],
    interaction: mode === 'find' ? 'map-click' : 'text-entry',
    targetIds: ids, version: versionOf(ids),
  };
}
