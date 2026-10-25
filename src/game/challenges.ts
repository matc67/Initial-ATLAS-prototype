// A challenge is one fixed set of things to find, with one way of answering. Records belong to a challenge, so results are
// only ever compared with runs of the same challenge. The scoring rules (scoring.ts) work on plain ids and do not care
// whether those ids are countries, provinces or cities; only the map interaction and name matching differ per kind.
import { inArea, inSet, type Area, type CountrySet } from '../data/countries.ts';
import { ROSTER } from '../data/roster.ts';
import type { EntityType } from '../data/entities.ts';
import { SCORING_VERSION } from './scoring.ts';

// `map-click`: a polygon (or a ring for tiny countries) is clicked on the globe. `text-entry`: the answer is typed.
// Future city challenges add `point-click`, a click within a tolerance of a city's coordinates (see docs/geography.md).
export type Interaction = 'map-click' | 'text-entry';
// `find`: a country is named; the player clicks it. `name`: a country lights up; the player types its name. `flag`: a
// flag is shown; the player clicks its country (countries only: regions have no flags in ATLAS).
export type GameMode = 'find' | 'name' | 'flag';
export const GAME_MODES: GameMode[] = ['find', 'name', 'flag'];
export const interactionOf = (mode: GameMode): Interaction => (mode === 'name' ? 'text-entry' : 'map-click');

// `full`: every target, in random order. `sprint`: SPRINT_SIZE targets drawn at random from the pool for each run.
export type ChallengeKind = 'full' | 'sprint';
export const SPRINT_SIZE = 10;

export type GeographyChallenge = {
  id: string;              // stable: e.g. "world-countries-find", "africa-sprint-classic-name"
  name: string;            // "World countries", "Africa Sprint"
  kind: ChallengeKind;
  size: number;            // questions in one run
  entityType: EntityType;  // what the targets are
  scopeId: string;         // the entity the challenge covers: "world", "continent:africa"…
  interaction: Interaction;
  targetIds: string[];     // what is asked (full), or the pool the questions are drawn from (sprint), as map/roster ids
  // Changes whenever the target list changes (a roster edit, a new country) or the scoring rules change (streak bonuses),
  // so records from a different list of countries or different rules are never ranked against this one.
  version: string;
  // The same challenge under scoring version 1 (before streak bonuses), whose records are kept and shown apart.
  earlierVersion: string;
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

// A version string for a list of targets under a scoring version: version 1 records keep their original, unsuffixed key.
export const scoredVersion = (list: string, scoring = SCORING_VERSION) => (scoring < 2 ? list : `${list}.sc${scoring}`);

// The roster ids of an area in a country set, the same list a full round plays.
export const countryIds = (area: Area, set: CountrySet) => ROSTER.filter(r => inArea(r, area) && inSet(r, set)).map(r => r.id);

export function countryChallenge(area: Area, set: CountrySet, mode: GameMode, ids = countryIds(area, set)): GeographyChallenge {
  return {
    id: `${slug(area)}-countries${set === '195' ? '-classic' : ''}-${mode}`,
    name: `${area === 'World' ? 'World' : area} ${mode === 'flag' ? 'flags' : 'countries'}`, kind: 'full', size: ids.length,
    entityType: 'country', scopeId: SCOPE[area],
    interaction: interactionOf(mode),
    targetIds: ids, version: scoredVersion(versionOf(ids)), earlierVersion: versionOf(ids),
  };
}

// A Sprint draws 10 of the area's countries at random for each run. Its records are kept apart from the full challenge's
// (a different id), and each run's ten differ, so they are personal arcade records rather than like-for-like rankings.
// The version follows the pool, the run size and the scoring rules, so changing any of them starts fresh records.
export function sprintChallenge(area: Area, set: CountrySet, mode: GameMode, pool = countryIds(area, set)): GeographyChallenge {
  return {
    ...countryChallenge(area, set, mode, pool),
    id: `${slug(area)}-sprint${set === '195' ? '-classic' : ''}-${mode}`,
    name: `${area === 'World' ? 'World' : area} Sprint`, kind: 'sprint', size: SPRINT_SIZE,
    version: scoredVersion(`s${SPRINT_SIZE}-${versionOf(pool)}`), earlierVersion: `s${SPRINT_SIZE}-${versionOf(pool)}`,
  };
}

// ---- Subdivision challenges --------------------------------------------------------------------------------------------
// First-level subdivisions of one country (provinces, states, territories…), from its data profile. Nothing here names a
// country: the same functions serve every country with subdivision data (docs/subdivisions.md).
// `full`: every subdivision. `sprint`: SPRINT_SIZE drawn at random, only when the country has at least that many; a
// country with fewer has only the full challenge, which is already short, never a padded or repeating Sprint.
export const subdivisionKinds = (count: number): ChallengeKind[] => (count >= SPRINT_SIZE ? ['sprint', 'full'] : ['full']);

// e.g. "can-admin1-find", "can-admin1-sprint-name": apart from every country challenge id.
export const subdivisionChallengeId = (countryId: string, mode: GameMode, kind: ChallengeKind) => `${slug(countryId)}-admin1${kind === 'sprint' ? '-sprint' : ''}-${mode}`;
// A challenge's records key from the fingerprint of the country's unit list (`versionOf(ids)`, stored in the subdivision
// index as `unitsVersion`), so Progress finds a country's records without loading its geometry. Same as perfKey of the
// challenge itself.
export const subdivisionKey = (countryId: string, mode: GameMode, kind: ChallengeKind, unitsVersion: string) =>
  `${subdivisionChallengeId(countryId, mode, kind)}@${scoredVersion(kind === 'sprint' ? `s${SPRINT_SIZE}-${unitsVersion}` : unitsVersion)}`;

export function subdivisionChallenge(countryId: string, name: string, mode: GameMode, kind: ChallengeKind, ids: string[]): GeographyChallenge {
  if (kind === 'sprint' && ids.length < SPRINT_SIZE) throw new Error(`${countryId} has ${ids.length} subdivisions, too few for a ${SPRINT_SIZE}-question Sprint`);
  const list = versionOf(ids);
  return {
    id: subdivisionChallengeId(countryId, mode, kind),
    name: kind === 'sprint' ? `${name} Sprint` : name,
    kind, size: kind === 'sprint' ? SPRINT_SIZE : ids.length,
    entityType: 'admin1', scopeId: `country:${countryId}`,
    interaction: interactionOf(mode),
    targetIds: ids,
    version: scoredVersion(kind === 'sprint' ? `s${SPRINT_SIZE}-${list}` : list),
    earlierVersion: kind === 'sprint' ? `s${SPRINT_SIZE}-${list}` : list,
  };
}
