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
  notes?: string[];
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
  return errors;
}
