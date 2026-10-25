// First-level subdivisions, one reviewed profile per country. Edit this file, then run `npm run admin1`.
// See docs/subdivisions.md. This is data: no game or map code names a country. A profile says which Natural Earth
// Admin-1 rows make up the country's subdivisions, what each one is called and what kind it is. Every source row must be
// listed in `units` or `exclude`, so nothing reaches the game unreviewed.
import type { AdminTerms } from './entities.ts';
import { ROSTER } from './roster.ts';
import { normalize } from '../game/names.ts';

export type Admin1Unit = {
  code: string;          // the ATLAS code: the ISO 3166-2 suffix where clean and unique ("ON"), never from a name
  name: string;          // English display name
  kind: string;          // singular, capitalised, one of the profile's `terms.kinds` ("Province")
  aliases?: string[];    // other accepted names, reviewed: official names in other languages, common short forms
  abbrev?: string;       // official abbreviation
  // A unit drawn on the map and named in Explore, but never asked in a challenge (Washington, DC among the 50 states).
  // Its land stays its own, never merged into a neighbour; `note` says why it is not played. Clicking it in a round is a
  // neutral note, never a mistake.
  playable?: false;
  note?: string;
};

export type Admin1Profile = {
  country: string;                     // roster id
  sources: string[];                   // Natural Earth ADM0_A3 values whose rows belong to this country
  key: 'iso_3166_2' | 'adm1_code';     // the Natural Earth field that identifies a row in `units` / `exclude`
  groupBy?: string;                    // a Natural Earth field to merge rows by, when its rows are below the first level
  exclude?: { [sourceKey: string]: string };   // rows left out, with the reason
  terms: AdminTerms;
  units: { [sourceKey: string]: Admin1Unit };  // by source key, or by group value when `groupBy` is set
  enabled: boolean;                    // only once reviewed: names, codes, counts and the build's flags
  // The playable units of each kind there must be, from an official source: the build stops if the profile differs.
  expect?: { [kind: string]: number };
  notes?: string[];                    // review notes and policies, shown in docs/subdivisions.md
};

export const PROFILES: Admin1Profile[] = [
  {
    country: 'CAN',
    sources: ['CAN'],
    key: 'iso_3166_2',
    terms: {
      singular: 'province or territory', plural: 'provinces and territories',
      kinds: [{ singular: 'province', plural: 'provinces' }, { singular: 'territory', plural: 'territories' }],
    },
    // English names as the Government of Canada uses them; French official names as aliases. "Newfoundland" alone and
    // the historical names in Natural Earth's name_alt (Upper/Lower Canada, Acadia, New Caledonia) are not accepted.
    units: {
      'CA-BC': { code: 'BC', name: 'British Columbia', kind: 'Province', aliases: ['Colombie-Britannique'], abbrev: 'BC' },
      'CA-AB': { code: 'AB', name: 'Alberta', kind: 'Province', abbrev: 'AB' },
      'CA-SK': { code: 'SK', name: 'Saskatchewan', kind: 'Province', abbrev: 'SK' },
      'CA-MB': { code: 'MB', name: 'Manitoba', kind: 'Province', abbrev: 'MB' },
      'CA-ON': { code: 'ON', name: 'Ontario', kind: 'Province', abbrev: 'ON' },
      'CA-QC': { code: 'QC', name: 'Quebec', kind: 'Province', aliases: ['Québec'], abbrev: 'QC' },
      'CA-NB': { code: 'NB', name: 'New Brunswick', kind: 'Province', aliases: ['Nouveau-Brunswick'], abbrev: 'NB' },
      'CA-NS': { code: 'NS', name: 'Nova Scotia', kind: 'Province', aliases: ['Nouvelle-Écosse'], abbrev: 'NS' },
      'CA-PE': { code: 'PE', name: 'Prince Edward Island', kind: 'Province', aliases: ['Île-du-Prince-Édouard', 'PEI'], abbrev: 'PE' },
      'CA-NL': { code: 'NL', name: 'Newfoundland and Labrador', kind: 'Province', aliases: ['Terre-Neuve-et-Labrador'], abbrev: 'NL' },
      'CA-YT': { code: 'YT', name: 'Yukon', kind: 'Territory', aliases: ['Yukon Territory'], abbrev: 'YT' },
      'CA-NT': { code: 'NT', name: 'Northwest Territories', kind: 'Territory', aliases: ['Territoires du Nord-Ouest', 'NWT'], abbrev: 'NT' },
      'CA-NU': { code: 'NU', name: 'Nunavut', kind: 'Territory', abbrev: 'NU' },
    },
    expect: { Province: 10, Territory: 3 },
    enabled: true,
  },
  {
    country: 'USA',
    sources: ['USA'],
    key: 'iso_3166_2',
    terms: {
      singular: 'state', plural: 'states',
      kinds: [{ singular: 'state', plural: 'states' }, { singular: 'federal district', plural: 'federal districts' }],
    },
    // The 50 states, by their ISO 3166-2 codes (the USPS abbreviations). Accepted short forms: the two-letter postal code
    // is not accepted as a typed answer (two letters are a guess, not a name), but a few well-established short names are.
    // "Washington" is the state; the federal district is never matched by it.
    units: {
      'US-AL': { code: 'AL', name: 'Alabama', kind: 'State', abbrev: 'AL' },
      'US-AK': { code: 'AK', name: 'Alaska', kind: 'State', abbrev: 'AK' },
      'US-AZ': { code: 'AZ', name: 'Arizona', kind: 'State', abbrev: 'AZ' },
      'US-AR': { code: 'AR', name: 'Arkansas', kind: 'State', abbrev: 'AR' },
      'US-CA': { code: 'CA', name: 'California', kind: 'State', abbrev: 'CA' },
      'US-CO': { code: 'CO', name: 'Colorado', kind: 'State', abbrev: 'CO' },
      'US-CT': { code: 'CT', name: 'Connecticut', kind: 'State', abbrev: 'CT' },
      'US-DE': { code: 'DE', name: 'Delaware', kind: 'State', abbrev: 'DE' },
      'US-FL': { code: 'FL', name: 'Florida', kind: 'State', abbrev: 'FL' },
      'US-GA': { code: 'GA', name: 'Georgia', kind: 'State', abbrev: 'GA' },
      'US-HI': { code: 'HI', name: 'Hawaii', kind: 'State', aliases: ['Hawaiʻi'], abbrev: 'HI' },
      'US-ID': { code: 'ID', name: 'Idaho', kind: 'State', abbrev: 'ID' },
      'US-IL': { code: 'IL', name: 'Illinois', kind: 'State', abbrev: 'IL' },
      'US-IN': { code: 'IN', name: 'Indiana', kind: 'State', abbrev: 'IN' },
      'US-IA': { code: 'IA', name: 'Iowa', kind: 'State', abbrev: 'IA' },
      'US-KS': { code: 'KS', name: 'Kansas', kind: 'State', abbrev: 'KS' },
      'US-KY': { code: 'KY', name: 'Kentucky', kind: 'State', aliases: ['Commonwealth of Kentucky'], abbrev: 'KY' },
      'US-LA': { code: 'LA', name: 'Louisiana', kind: 'State', abbrev: 'LA' },
      'US-ME': { code: 'ME', name: 'Maine', kind: 'State', abbrev: 'ME' },
      'US-MD': { code: 'MD', name: 'Maryland', kind: 'State', abbrev: 'MD' },
      'US-MA': { code: 'MA', name: 'Massachusetts', kind: 'State', aliases: ['Commonwealth of Massachusetts'], abbrev: 'MA' },
      'US-MI': { code: 'MI', name: 'Michigan', kind: 'State', abbrev: 'MI' },
      'US-MN': { code: 'MN', name: 'Minnesota', kind: 'State', abbrev: 'MN' },
      'US-MS': { code: 'MS', name: 'Mississippi', kind: 'State', abbrev: 'MS' },
      'US-MO': { code: 'MO', name: 'Missouri', kind: 'State', abbrev: 'MO' },
      'US-MT': { code: 'MT', name: 'Montana', kind: 'State', abbrev: 'MT' },
      'US-NE': { code: 'NE', name: 'Nebraska', kind: 'State', abbrev: 'NE' },
      'US-NV': { code: 'NV', name: 'Nevada', kind: 'State', abbrev: 'NV' },
      'US-NH': { code: 'NH', name: 'New Hampshire', kind: 'State', abbrev: 'NH' },
      'US-NJ': { code: 'NJ', name: 'New Jersey', kind: 'State', abbrev: 'NJ' },
      'US-NM': { code: 'NM', name: 'New Mexico', kind: 'State', abbrev: 'NM' },
      'US-NY': { code: 'NY', name: 'New York', kind: 'State', aliases: ['New York State'], abbrev: 'NY' },
      'US-NC': { code: 'NC', name: 'North Carolina', kind: 'State', abbrev: 'NC' },
      'US-ND': { code: 'ND', name: 'North Dakota', kind: 'State', abbrev: 'ND' },
      'US-OH': { code: 'OH', name: 'Ohio', kind: 'State', abbrev: 'OH' },
      'US-OK': { code: 'OK', name: 'Oklahoma', kind: 'State', abbrev: 'OK' },
      'US-OR': { code: 'OR', name: 'Oregon', kind: 'State', abbrev: 'OR' },
      'US-PA': { code: 'PA', name: 'Pennsylvania', kind: 'State', aliases: ['Commonwealth of Pennsylvania'], abbrev: 'PA' },
      'US-RI': { code: 'RI', name: 'Rhode Island', kind: 'State', abbrev: 'RI' },
      'US-SC': { code: 'SC', name: 'South Carolina', kind: 'State', abbrev: 'SC' },
      'US-SD': { code: 'SD', name: 'South Dakota', kind: 'State', abbrev: 'SD' },
      'US-TN': { code: 'TN', name: 'Tennessee', kind: 'State', abbrev: 'TN' },
      'US-TX': { code: 'TX', name: 'Texas', kind: 'State', abbrev: 'TX' },
      'US-UT': { code: 'UT', name: 'Utah', kind: 'State', abbrev: 'UT' },
      'US-VT': { code: 'VT', name: 'Vermont', kind: 'State', abbrev: 'VT' },
      'US-VA': { code: 'VA', name: 'Virginia', kind: 'State', aliases: ['Commonwealth of Virginia'], abbrev: 'VA' },
      'US-WA': { code: 'WA', name: 'Washington', kind: 'State', aliases: ['Washington State'], abbrev: 'WA' },
      'US-WV': { code: 'WV', name: 'West Virginia', kind: 'State', abbrev: 'WV' },
      'US-WI': { code: 'WI', name: 'Wisconsin', kind: 'State', abbrev: 'WI' },
      'US-WY': { code: 'WY', name: 'Wyoming', kind: 'State', abbrev: 'WY' },
      'US-DC': {
        code: 'DC', name: 'District of Columbia', kind: 'Federal district', aliases: ['Washington, DC', 'Washington, D.C.'], abbrev: 'DC',
        playable: false, note: 'The federal district, home of the capital, Washington. It is not a state, so it is not one of the 50 states played here.',
      },
    },
    expect: { State: 50 },
    notes: [
      'Washington, DC is drawn and named, never asked: the challenges are the 50 states.',
      'Puerto Rico is one of the 200 countries in ATLAS and is played as a country, not as part of the United States.',
      'Guam, the US Virgin Islands, American Samoa, the Northern Mariana Islands and the US Minor Outlying Islands are separate entities in Natural Earth and on the country map: shown as territories of the United States, not playable.',
    ],
    enabled: true,
  },
];

// A profile must account for every source row (`keys`: the source keys, or group values, of the country's rows), use
// distinct codes and names, and give every unit a declared kind. The build stops on any error.
export function validateProfile(p: Admin1Profile, keys: string[]): string[] {
  const errors: string[] = [];
  if (!ROSTER.some(r => r.id === p.country)) errors.push(`${p.country} is not a roster country`);
  const listed = new Set([...Object.keys(p.units), ...Object.keys(p.exclude ?? {})]);
  for (const k of keys) if (!listed.has(k)) errors.push(`source row ${k} is neither in units nor in exclude`);
  for (const k of Object.keys(p.units)) if (!keys.includes(k)) errors.push(`unit ${k} matches no source row`);
  const units = Object.values(p.units);
  const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
  for (const c of dup(units.map(u => u.code))) errors.push(`code ${c} is used twice`);
  // No name or alias may match two units: a typed answer must always mean one subdivision.
  const names = units.flatMap(u => [u.name, ...(u.aliases ?? [])].map(n => [normalize(n), u.code] as const));
  for (const [n, code] of names) if (names.some(([m, c]) => m === n && c !== code)) errors.push(`"${n}" names more than one unit`);
  const kinds = new Set((p.terms.kinds ?? [{ singular: p.terms.singular }]).map(k => k.singular.toLowerCase()));
  for (const u of units) if (!kinds.has(u.kind.toLowerCase())) errors.push(`${u.code}: kind ${u.kind} is not in terms.kinds`);
  for (const u of units) if (!/^[A-Z0-9]{1,6}$/.test(u.code)) errors.push(`${u.code}: codes are 1–6 capitals or digits`);
  for (const u of units) if (u.playable === false && !u.note) errors.push(`${u.code}: a unit left out of the challenges needs a note saying why`);
  if (!units.some(u => u.playable !== false)) errors.push('no playable units');
  // A declared count, when given, must match: the check that the profile is the whole set (50 states, 13 provinces…).
  if (p.expect) for (const [kind, n] of Object.entries(p.expect)) {
    const got = units.filter(u => u.playable !== false && u.kind.toLowerCase() === kind.toLowerCase()).length;
    if (got !== n) errors.push(`expected ${n} playable ${kind} units, found ${got}`);
  }
  return errors;
}
