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
  // Rows that are part of another unit (an island with its own row, such as Macquarie Island in Tasmania), with the reason.
  mergeInto?: { [sourceKey: string]: { into: string; reason: string } };
  // Whole parts (islands) that Natural Earth files under the wrong unit: every part of `from` lying entirely inside
  // `bbox` (west, south, east, north) moves to `to`. A part crossing the box stops the build; nothing is ever cut.
  moveParts?: { from: string; to: string; bbox: [number, number, number, number]; reason: string }[];
  terms: AdminTerms;
  units: { [sourceKey: string]: Admin1Unit };  // by source key, or by group value when `groupBy` is set
  enabled: boolean;                    // only once reviewed: names, codes, counts and the build's flags
  // The playable units of each kind there must be, from an official source: the build stops if the profile differs.
  expect?: { [kind: string]: number };
  // Build flags that have been reviewed, by unit code, with what was found. A test fails on any flag not listed here.
  reviewed?: { [code: string]: string };
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
  {
    country: 'BRA',
    sources: ['BRA'],
    key: 'iso_3166_2',
    terms: { singular: 'state', plural: 'states', kinds: [{ singular: 'state', plural: 'states' }, { singular: 'federal district', plural: 'federal districts' }] },
    units: {
      'BR-AC': { code: 'AC', name: 'Acre', kind: 'State' },
      'BR-AL': { code: 'AL', name: 'Alagoas', kind: 'State' },
      'BR-AP': { code: 'AP', name: 'Amapá', kind: 'State' },
      'BR-AM': { code: 'AM', name: 'Amazonas', kind: 'State' },
      'BR-BA': { code: 'BA', name: 'Bahia', kind: 'State' },
      'BR-CE': { code: 'CE', name: 'Ceará', kind: 'State' },
      'BR-ES': { code: 'ES', name: 'Espírito Santo', kind: 'State' },
      'BR-GO': { code: 'GO', name: 'Goiás', kind: 'State' },
      'BR-MA': { code: 'MA', name: 'Maranhão', kind: 'State' },
      'BR-MT': { code: 'MT', name: 'Mato Grosso', kind: 'State' },
      'BR-MS': { code: 'MS', name: 'Mato Grosso do Sul', kind: 'State' },
      'BR-MG': { code: 'MG', name: 'Minas Gerais', kind: 'State' },
      'BR-PA': { code: 'PA', name: 'Pará', kind: 'State' },
      'BR-PB': { code: 'PB', name: 'Paraíba', kind: 'State' },
      'BR-PR': { code: 'PR', name: 'Paraná', kind: 'State' },
      'BR-PE': { code: 'PE', name: 'Pernambuco', kind: 'State' },
      'BR-PI': { code: 'PI', name: 'Piauí', kind: 'State' },
      'BR-RJ': { code: 'RJ', name: 'Rio de Janeiro', kind: 'State' },
      'BR-RN': { code: 'RN', name: 'Rio Grande do Norte', kind: 'State' },
      'BR-RS': { code: 'RS', name: 'Rio Grande do Sul', kind: 'State' },
      'BR-RO': { code: 'RO', name: 'Rondônia', kind: 'State' },
      'BR-RR': { code: 'RR', name: 'Roraima', kind: 'State' },
      'BR-SC': { code: 'SC', name: 'Santa Catarina', kind: 'State' },
      'BR-SP': { code: 'SP', name: 'São Paulo', kind: 'State' },
      'BR-SE': { code: 'SE', name: 'Sergipe', kind: 'State' },
      'BR-TO': { code: 'TO', name: 'Tocantins', kind: 'State' },
      'BR-DF': { code: 'DF', name: 'Federal District', kind: 'Federal district', aliases: ['Distrito Federal'] },
    },
    expect: { State: 26, 'Federal district': 1 },
    notes: [
      'The 27 federative units of the constitution (articles 1 and 18): 26 states and the Federal District, which is played.',
      'Names are the Portuguese official names, as used in English; accents are optional when typing.',
    ],
    enabled: true,
  },
  {
    country: 'MEX',
    sources: ['MEX'],
    key: 'iso_3166_2',
    mergeInto: { 'MX-X01~': { into: 'MX-YUC', reason: 'Arrecife Alacranes, a reef north of the Yucatán peninsula, belongs to Yucatán (an unnamed row in Natural Earth)' } },
    terms: { singular: 'state', plural: 'states', kinds: [{ singular: 'state', plural: 'states' }, { singular: 'capital city', plural: 'capital cities' }] },
    units: {
      'MX-AGU': { code: 'AGU', name: 'Aguascalientes', kind: 'State' },
      'MX-BCN': { code: 'BCN', name: 'Baja California', kind: 'State' },
      'MX-BCS': { code: 'BCS', name: 'Baja California Sur', kind: 'State' },
      'MX-CAM': { code: 'CAM', name: 'Campeche', kind: 'State' },
      'MX-CHP': { code: 'CHP', name: 'Chiapas', kind: 'State' },
      'MX-CHH': { code: 'CHH', name: 'Chihuahua', kind: 'State' },
      'MX-COA': { code: 'COA', name: 'Coahuila', kind: 'State', aliases: ['Coahuila de Zaragoza'] },
      'MX-COL': { code: 'COL', name: 'Colima', kind: 'State' },
      'MX-DUR': { code: 'DUR', name: 'Durango', kind: 'State' },
      'MX-GUA': { code: 'GUA', name: 'Guanajuato', kind: 'State' },
      'MX-GRO': { code: 'GRO', name: 'Guerrero', kind: 'State' },
      'MX-HID': { code: 'HID', name: 'Hidalgo', kind: 'State' },
      'MX-JAL': { code: 'JAL', name: 'Jalisco', kind: 'State' },
      'MX-MEX': { code: 'MEX', name: 'State of Mexico', kind: 'State', aliases: ['Estado de México', 'Mexico State', 'Edomex'] },
      'MX-MIC': { code: 'MIC', name: 'Michoacán', kind: 'State', aliases: ['Michoacán de Ocampo'] },
      'MX-MOR': { code: 'MOR', name: 'Morelos', kind: 'State' },
      'MX-NAY': { code: 'NAY', name: 'Nayarit', kind: 'State' },
      'MX-NLE': { code: 'NLE', name: 'Nuevo León', kind: 'State' },
      'MX-OAX': { code: 'OAX', name: 'Oaxaca', kind: 'State' },
      'MX-PUE': { code: 'PUE', name: 'Puebla', kind: 'State' },
      'MX-QUE': { code: 'QUE', name: 'Querétaro', kind: 'State' },
      'MX-ROO': { code: 'ROO', name: 'Quintana Roo', kind: 'State' },
      'MX-SLP': { code: 'SLP', name: 'San Luis Potosí', kind: 'State' },
      'MX-SIN': { code: 'SIN', name: 'Sinaloa', kind: 'State' },
      'MX-SON': { code: 'SON', name: 'Sonora', kind: 'State' },
      'MX-TAB': { code: 'TAB', name: 'Tabasco', kind: 'State' },
      'MX-TAM': { code: 'TAM', name: 'Tamaulipas', kind: 'State' },
      'MX-TLA': { code: 'TLA', name: 'Tlaxcala', kind: 'State' },
      'MX-VER': { code: 'VER', name: 'Veracruz', kind: 'State', aliases: ['Veracruz de Ignacio de la Llave'] },
      'MX-YUC': { code: 'YUC', name: 'Yucatán', kind: 'State' },
      'MX-ZAC': { code: 'ZAC', name: 'Zacatecas', kind: 'State' },
      'MX-DIF': { code: 'CMX', name: 'Mexico City', kind: 'Capital city', aliases: ['Ciudad de México', 'CDMX'] },
    },
    expect: { State: 31, 'Capital city': 1 },
    notes: [
      'The 32 federal entities of the constitution (article 43): 31 states and Mexico City, which is played.',
      'Natural Earth still names Mexico City "Distrito Federal" under the pre-2016 code MX-DIF; ATLAS uses Mexico City and the current ISO code CMX.',
      'The State of Mexico answers to "State of Mexico", "Estado de México", "Mexico State" and "Edomex", never to "Mexico" alone, which would be ambiguous with Mexico City.',
      'Arrecife Alacranes (an unnamed Natural Earth row off the Yucatán coast) is part of Yucatán.',
    ],
    enabled: true,
  },
  {
    country: 'IND',
    sources: ['IND'],
    key: 'iso_3166_2',
    terms: { singular: 'state or union territory', plural: 'states and union territories', kinds: [{ singular: 'state', plural: 'states' }, { singular: 'union territory', plural: 'union territories' }] },
    units: {
      'IN-AP': { code: 'AP', name: 'Andhra Pradesh', kind: 'State' },
      'IN-AR': { code: 'AR', name: 'Arunachal Pradesh', kind: 'State' },
      'IN-AS': { code: 'AS', name: 'Assam', kind: 'State' },
      'IN-BR': { code: 'BR', name: 'Bihar', kind: 'State' },
      'IN-CT': { code: 'CG', name: 'Chhattisgarh', kind: 'State' },
      'IN-GA': { code: 'GA', name: 'Goa', kind: 'State' },
      'IN-GJ': { code: 'GJ', name: 'Gujarat', kind: 'State' },
      'IN-HR': { code: 'HR', name: 'Haryana', kind: 'State' },
      'IN-HP': { code: 'HP', name: 'Himachal Pradesh', kind: 'State' },
      'IN-JH': { code: 'JH', name: 'Jharkhand', kind: 'State' },
      'IN-KA': { code: 'KA', name: 'Karnataka', kind: 'State' },
      'IN-KL': { code: 'KL', name: 'Kerala', kind: 'State' },
      'IN-MP': { code: 'MP', name: 'Madhya Pradesh', kind: 'State' },
      'IN-MH': { code: 'MH', name: 'Maharashtra', kind: 'State' },
      'IN-MN': { code: 'MN', name: 'Manipur', kind: 'State' },
      'IN-ML': { code: 'ML', name: 'Meghalaya', kind: 'State' },
      'IN-MZ': { code: 'MZ', name: 'Mizoram', kind: 'State' },
      'IN-NL': { code: 'NL', name: 'Nagaland', kind: 'State' },
      'IN-OR': { code: 'OD', name: 'Odisha', kind: 'State' },
      'IN-PB': { code: 'PB', name: 'Punjab', kind: 'State' },
      'IN-RJ': { code: 'RJ', name: 'Rajasthan', kind: 'State' },
      'IN-SK': { code: 'SK', name: 'Sikkim', kind: 'State' },
      'IN-TN': { code: 'TN', name: 'Tamil Nadu', kind: 'State' },
      'IN-TG': { code: 'TS', name: 'Telangana', kind: 'State' },
      'IN-TR': { code: 'TR', name: 'Tripura', kind: 'State' },
      'IN-UP': { code: 'UP', name: 'Uttar Pradesh', kind: 'State' },
      'IN-UT': { code: 'UK', name: 'Uttarakhand', kind: 'State' },
      'IN-WB': { code: 'WB', name: 'West Bengal', kind: 'State' },
      'IN-AN': { code: 'AN', name: 'Andaman and Nicobar Islands', kind: 'Union territory', aliases: ['Andaman and Nicobar'] },
      'IN-CH': { code: 'CH', name: 'Chandigarh', kind: 'Union territory' },
      'IN-DH': { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', kind: 'Union territory' },
      'IN-DL': { code: 'DL', name: 'Delhi', kind: 'Union territory', aliases: ['National Capital Territory of Delhi', 'NCT of Delhi'] },
      'IN-JK': { code: 'JK', name: 'Jammu and Kashmir', kind: 'Union territory' },
      'IN-LA': { code: 'LA', name: 'Ladakh', kind: 'Union territory' },
      'IN-LD': { code: 'LD', name: 'Lakshadweep', kind: 'Union territory' },
      'IN-PY': { code: 'PY', name: 'Puducherry', kind: 'Union territory' },
    },
    reviewed: {
      'AN': 'Andaman and Nicobar: islets and coastline the country map draws as sea (many pieces of 3 km² or less, none on another country); left out, as the country map is the authority',
      'LD': 'Lakshadweep: islets and coastline the country map draws as sea (many pieces of 3 km² or less, none on another country); left out, as the country map is the authority',
    },
    expect: { State: 28, 'Union territory': 8 },
    notes: [
      'The 28 states and 8 union territories (since 2020: Ladakh separate from Jammu and Kashmir; Dadra and Nagar Haveli merged with Daman and Diu). All are played, Delhi included.',
      'Codes are the current ISO 3166-2 codes (2023: CG, OD, TS, UK); Natural Earth has the earlier CT, OR, TG and UT, kept in each unit\'s source codes.',
      'Natural Earth types Himachal Pradesh as a union territory and leaves Gujarat untyped; both are states.',
      'Kashmir: the units follow the country map, which draws India as Natural Earth does (the Line of Control; Siachen and Aksai Chin are separate, non-playable land). Arunachal Pradesh, claimed by China, is in India on the country map and here. See docs/subdivisions.md.',
      'Former names (Orissa, Pondicherry) are not accepted, as for Canada\'s historical names.',
    ],
    enabled: true,
  },
  {
    country: 'DEU',
    sources: ['DEU'],
    key: 'iso_3166_2',
    terms: { singular: 'state', plural: 'states' },
    units: {
      'DE-BW': { code: 'BW', name: 'Baden-Württemberg', kind: 'State' },
      'DE-BY': { code: 'BY', name: 'Bavaria', kind: 'State', aliases: ['Bayern'] },
      'DE-BE': { code: 'BE', name: 'Berlin', kind: 'State' },
      'DE-BB': { code: 'BB', name: 'Brandenburg', kind: 'State' },
      'DE-HB': { code: 'HB', name: 'Bremen', kind: 'State', aliases: ['Free Hanseatic City of Bremen'] },
      'DE-HH': { code: 'HH', name: 'Hamburg', kind: 'State' },
      'DE-HE': { code: 'HE', name: 'Hesse', kind: 'State', aliases: ['Hessen'] },
      'DE-MV': { code: 'MV', name: 'Mecklenburg-Western Pomerania', kind: 'State', aliases: ['Mecklenburg-Vorpommern', 'Mecklenburg-West Pomerania'] },
      'DE-NI': { code: 'NI', name: 'Lower Saxony', kind: 'State', aliases: ['Niedersachsen'] },
      'DE-NW': { code: 'NW', name: 'North Rhine-Westphalia', kind: 'State', aliases: ['Nordrhein-Westfalen', 'NRW'] },
      'DE-RP': { code: 'RP', name: 'Rhineland-Palatinate', kind: 'State', aliases: ['Rheinland-Pfalz'] },
      'DE-SL': { code: 'SL', name: 'Saarland', kind: 'State' },
      'DE-SN': { code: 'SN', name: 'Saxony', kind: 'State', aliases: ['Sachsen'] },
      'DE-ST': { code: 'ST', name: 'Saxony-Anhalt', kind: 'State', aliases: ['Sachsen-Anhalt'] },
      'DE-SH': { code: 'SH', name: 'Schleswig-Holstein', kind: 'State' },
      'DE-TH': { code: 'TH', name: 'Thuringia', kind: 'State', aliases: ['Thüringen'] },
    },
    expect: { State: 16 },
    notes: [
      'The 16 Länder, with English names and the German names as aliases. Berlin, Hamburg and Bremen are city-states; Bremen includes Bremerhaven.',
    ],
    enabled: true,
  },
  {
    country: 'JPN',
    sources: ['JPN'],
    key: 'iso_3166_2',
    // The Amami Islands (Amami Ōshima, Kikaijima, Tokunoshima, Okinoerabujima, Yoronjima) have been part of Kagoshima
    // since 1953; Natural Earth files them under Okinawa. The box holds them and no Okinawa island (Yoron is the
    // southernmost, at 27.04°N; Okinawa's islands lie south of 26.95°N or west of 128.3°E).
    moveParts: [{ from: 'JP-47', to: 'JP-46', bbox: [128.3, 26.95, 130.4, 28.6], reason: 'The Amami Islands belong to Kagoshima Prefecture; Natural Earth has them in Okinawa' }],
    terms: { singular: 'prefecture', plural: 'prefectures' },
    units: {
      'JP-01': { code: '01', name: 'Hokkaido', kind: 'Prefecture', aliases: ['Hokkaidō'] },
      'JP-02': { code: '02', name: 'Aomori', kind: 'Prefecture' },
      'JP-03': { code: '03', name: 'Iwate', kind: 'Prefecture' },
      'JP-04': { code: '04', name: 'Miyagi', kind: 'Prefecture' },
      'JP-05': { code: '05', name: 'Akita', kind: 'Prefecture' },
      'JP-06': { code: '06', name: 'Yamagata', kind: 'Prefecture' },
      'JP-07': { code: '07', name: 'Fukushima', kind: 'Prefecture' },
      'JP-08': { code: '08', name: 'Ibaraki', kind: 'Prefecture' },
      'JP-09': { code: '09', name: 'Tochigi', kind: 'Prefecture' },
      'JP-10': { code: '10', name: 'Gunma', kind: 'Prefecture' },
      'JP-11': { code: '11', name: 'Saitama', kind: 'Prefecture' },
      'JP-12': { code: '12', name: 'Chiba', kind: 'Prefecture' },
      'JP-13': { code: '13', name: 'Tokyo', kind: 'Prefecture', aliases: ['Tōkyō'] },
      'JP-14': { code: '14', name: 'Kanagawa', kind: 'Prefecture' },
      'JP-15': { code: '15', name: 'Niigata', kind: 'Prefecture' },
      'JP-16': { code: '16', name: 'Toyama', kind: 'Prefecture' },
      'JP-17': { code: '17', name: 'Ishikawa', kind: 'Prefecture' },
      'JP-18': { code: '18', name: 'Fukui', kind: 'Prefecture' },
      'JP-19': { code: '19', name: 'Yamanashi', kind: 'Prefecture' },
      'JP-20': { code: '20', name: 'Nagano', kind: 'Prefecture' },
      'JP-21': { code: '21', name: 'Gifu', kind: 'Prefecture' },
      'JP-22': { code: '22', name: 'Shizuoka', kind: 'Prefecture' },
      'JP-23': { code: '23', name: 'Aichi', kind: 'Prefecture' },
      'JP-24': { code: '24', name: 'Mie', kind: 'Prefecture' },
      'JP-25': { code: '25', name: 'Shiga', kind: 'Prefecture' },
      'JP-26': { code: '26', name: 'Kyoto', kind: 'Prefecture', aliases: ['Kyōto'] },
      'JP-27': { code: '27', name: 'Osaka', kind: 'Prefecture', aliases: ['Ōsaka'] },
      'JP-28': { code: '28', name: 'Hyogo', kind: 'Prefecture', aliases: ['Hyōgo'] },
      'JP-29': { code: '29', name: 'Nara', kind: 'Prefecture' },
      'JP-30': { code: '30', name: 'Wakayama', kind: 'Prefecture' },
      'JP-31': { code: '31', name: 'Tottori', kind: 'Prefecture' },
      'JP-32': { code: '32', name: 'Shimane', kind: 'Prefecture' },
      'JP-33': { code: '33', name: 'Okayama', kind: 'Prefecture' },
      'JP-34': { code: '34', name: 'Hiroshima', kind: 'Prefecture' },
      'JP-35': { code: '35', name: 'Yamaguchi', kind: 'Prefecture' },
      'JP-36': { code: '36', name: 'Tokushima', kind: 'Prefecture' },
      'JP-37': { code: '37', name: 'Kagawa', kind: 'Prefecture' },
      'JP-38': { code: '38', name: 'Ehime', kind: 'Prefecture' },
      'JP-39': { code: '39', name: 'Kochi', kind: 'Prefecture', aliases: ['Kōchi'] },
      'JP-40': { code: '40', name: 'Fukuoka', kind: 'Prefecture' },
      'JP-41': { code: '41', name: 'Saga', kind: 'Prefecture' },
      'JP-42': { code: '42', name: 'Nagasaki', kind: 'Prefecture' },
      'JP-43': { code: '43', name: 'Kumamoto', kind: 'Prefecture' },
      'JP-44': { code: '44', name: 'Oita', kind: 'Prefecture', aliases: ['Ōita'] },
      'JP-45': { code: '45', name: 'Miyazaki', kind: 'Prefecture' },
      'JP-46': { code: '46', name: 'Kagoshima', kind: 'Prefecture' },
      'JP-47': { code: '47', name: 'Okinawa', kind: 'Prefecture' },
    },
    reviewed: {
      '47': 'Okinawa: islets and coastline the country map draws as sea (many pieces of 3 km² or less, none on another country); left out, as the country map is the authority',
    },
    expect: { Prefecture: 47 },
    notes: [
      'The 47 prefectures (todōfuken). Tokyo (a metropolis), Hokkaido (a circuit) and Osaka and Kyoto (urban prefectures) are all counted as prefectures in English.',
      'Names without macrons; the macron spellings are aliases. Codes are the ISO 3166-2 numbers, 01 to 47.',
      'Tokyo includes the Izu and Ogasawara islands, up to 1,000 km south, so its framing covers them.',
      'The Amami Islands are moved from Natural Earth\'s Okinawa row to Kagoshima, where they belong (moveParts).',
      'The southern Kuril Islands (the Northern Territories), claimed by Japan, are in Russia on the country map, as in Natural Earth: not part of Hokkaido here.',
    ],
    enabled: true,
  },
  {
    country: 'AUS',
    sources: ['AUS'],
    key: 'iso_3166_2',
    mergeInto: { 'AU-X03~': { into: 'AU-TAS', reason: 'Macquarie Island is part of Tasmania (its own Natural Earth row, without a code)' } },
    terms: { singular: 'state or territory', plural: 'states and territories', kinds: [{ singular: 'state', plural: 'states' }, { singular: 'territory', plural: 'territories' }] },
    units: {
      'AU-NSW': { code: 'NSW', name: 'New South Wales', kind: 'State', aliases: ['NSW'] },
      'AU-QLD': { code: 'QLD', name: 'Queensland', kind: 'State' },
      'AU-SA': { code: 'SA', name: 'South Australia', kind: 'State' },
      'AU-TAS': { code: 'TAS', name: 'Tasmania', kind: 'State' },
      'AU-VIC': { code: 'VIC', name: 'Victoria', kind: 'State' },
      'AU-WA': { code: 'WA', name: 'Western Australia', kind: 'State' },
      'AU-ACT': { code: 'ACT', name: 'Australian Capital Territory', kind: 'Territory', aliases: ['ACT'] },
      'AU-NT': { code: 'NT', name: 'Northern Territory', kind: 'Territory' },
      'AU-X02~': {
        code: 'JBT', name: 'Jervis Bay Territory', kind: 'Territory', playable: false,
        note: 'A small territory of about 70 km² on the coast of New South Wales, administered by the federal government. It is not one of the 6 states and 2 mainland territories played here.',
      },
    },
    expect: { State: 6, Territory: 2 },
    notes: [
      'The 6 states and the 2 self-governing mainland territories (Australian Capital Territory, Northern Territory) are played.',
      'Jervis Bay Territory (about 70 km², administered by the federal government) is drawn and named, not played, like Washington, DC.',
      'Lord Howe Island (its own Natural Earth row, coded AU-NSW) is part of New South Wales; Macquarie Island is part of Tasmania.',
      'External territories (Christmas Island, the Cocos (Keeling) Islands, Norfolk Island, Heard and McDonald Islands) are separate land on the country map, not part of Australia here.',
    ],
    enabled: true,
  },
  {
    country: 'FRA',
    sources: ['FRA'],
    key: 'iso_3166_2',
    groupBy: 'region',
    exclude: {
      'Guyane française': 'An overseas region: separate land on the country map, not part of ATLAS\'s France',
      'Guadeloupe': 'An overseas region: separate land on the country map, not part of ATLAS\'s France',
      'Martinique': 'An overseas region: separate land on the country map, not part of ATLAS\'s France',
      'Réunion': 'An overseas region: separate land on the country map, not part of ATLAS\'s France',
      'Mayotte': 'An overseas region: separate land on the country map, not part of ATLAS\'s France',
    },
    terms: { singular: 'region', plural: 'regions' },
    units: {
      'Auvergne-Rhône-Alpes': { code: 'ARA', name: 'Auvergne-Rhône-Alpes', kind: 'Region' },
      'Bourgogne-Franche-Comté': { code: 'BFC', name: 'Bourgogne-Franche-Comté', kind: 'Region', aliases: ['Burgundy-Franche-Comté'] },
      'Bretagne': { code: 'BRE', name: 'Brittany', kind: 'Region', aliases: ['Bretagne'] },
      'Centre-Val de Loire': { code: 'CVL', name: 'Centre-Val de Loire', kind: 'Region' },
      'Corse': { code: '20R', name: 'Corsica', kind: 'Region', aliases: ['Corse'] },
      'Grand Est': { code: 'GES', name: 'Grand Est', kind: 'Region' },
      'Hauts-de-France': { code: 'HDF', name: 'Hauts-de-France', kind: 'Region' },
      'Île-de-France': { code: 'IDF', name: 'Île-de-France', kind: 'Region' },
      'Normandie': { code: 'NOR', name: 'Normandy', kind: 'Region', aliases: ['Normandie'] },
      'Nouvelle-Aquitaine': { code: 'NAQ', name: 'Nouvelle-Aquitaine', kind: 'Region' },
      'Occitanie': { code: 'OCC', name: 'Occitania', kind: 'Region', aliases: ['Occitanie'] },
      'Pays de la Loire': { code: 'PDL', name: 'Pays de la Loire', kind: 'Region' },
      'Provence-Alpes-Côte-d\'Azur': { code: 'PAC', name: 'Provence-Alpes-Côte d\'Azur', kind: 'Region', aliases: ['PACA'] },
    },
    expect: { Region: 13 },
    notes: [
      'Natural Earth\'s rows are the 96 metropolitan and 5 overseas departments; they are grouped by region into the 13 metropolitan regions, the first level since 2016.',
      'Corsica is a territorial collectivity with special status, counted among the 13 regions.',
      'The 5 overseas regions (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte) are separate land on the country map, shown as overseas regions of France and not playable: excluded here.',
    ],
    enabled: true,
  },
  {
    country: 'NGA',
    sources: ['NGA'],
    key: 'iso_3166_2',
    terms: { singular: 'state', plural: 'states', kinds: [{ singular: 'state', plural: 'states' }, { singular: 'federal capital territory', plural: 'federal capital territories' }] },
    units: {
      'NG-AB': { code: 'AB', name: 'Abia', kind: 'State' },
      'NG-AD': { code: 'AD', name: 'Adamawa', kind: 'State' },
      'NG-AK': { code: 'AK', name: 'Akwa Ibom', kind: 'State' },
      'NG-AN': { code: 'AN', name: 'Anambra', kind: 'State' },
      'NG-BA': { code: 'BA', name: 'Bauchi', kind: 'State' },
      'NG-BY': { code: 'BY', name: 'Bayelsa', kind: 'State' },
      'NG-BE': { code: 'BE', name: 'Benue', kind: 'State' },
      'NG-BO': { code: 'BO', name: 'Borno', kind: 'State' },
      'NG-CR': { code: 'CR', name: 'Cross River', kind: 'State' },
      'NG-DE': { code: 'DE', name: 'Delta', kind: 'State' },
      'NG-EB': { code: 'EB', name: 'Ebonyi', kind: 'State' },
      'NG-ED': { code: 'ED', name: 'Edo', kind: 'State' },
      'NG-EK': { code: 'EK', name: 'Ekiti', kind: 'State' },
      'NG-EN': { code: 'EN', name: 'Enugu', kind: 'State' },
      'NG-GO': { code: 'GO', name: 'Gombe', kind: 'State' },
      'NG-IM': { code: 'IM', name: 'Imo', kind: 'State' },
      'NG-JI': { code: 'JI', name: 'Jigawa', kind: 'State' },
      'NG-KD': { code: 'KD', name: 'Kaduna', kind: 'State' },
      'NG-KN': { code: 'KN', name: 'Kano', kind: 'State' },
      'NG-KT': { code: 'KT', name: 'Katsina', kind: 'State' },
      'NG-KE': { code: 'KE', name: 'Kebbi', kind: 'State' },
      'NG-KO': { code: 'KO', name: 'Kogi', kind: 'State' },
      'NG-KW': { code: 'KW', name: 'Kwara', kind: 'State' },
      'NG-LA': { code: 'LA', name: 'Lagos', kind: 'State' },
      'NG-NA': { code: 'NA', name: 'Nasarawa', kind: 'State' },
      'NG-NI': { code: 'NI', name: 'Niger', kind: 'State' },
      'NG-OG': { code: 'OG', name: 'Ogun', kind: 'State' },
      'NG-ON': { code: 'ON', name: 'Ondo', kind: 'State' },
      'NG-OS': { code: 'OS', name: 'Osun', kind: 'State' },
      'NG-OY': { code: 'OY', name: 'Oyo', kind: 'State' },
      'NG-PL': { code: 'PL', name: 'Plateau', kind: 'State' },
      'NG-RI': { code: 'RI', name: 'Rivers', kind: 'State' },
      'NG-SO': { code: 'SO', name: 'Sokoto', kind: 'State' },
      'NG-TA': { code: 'TA', name: 'Taraba', kind: 'State' },
      'NG-YO': { code: 'YO', name: 'Yobe', kind: 'State' },
      'NG-ZA': { code: 'ZA', name: 'Zamfara', kind: 'State' },
      'NG-FC': { code: 'FC', name: 'Federal Capital Territory', kind: 'Federal capital territory', aliases: ['FCT'] },
    },
    reviewed: {
      'BY': 'Bayelsa: islets and coastline the country map draws as sea (many pieces of 3 km² or less, none on another country); left out, as the country map is the authority',
      'RI': 'Rivers: islets and coastline the country map draws as sea (many pieces of 3 km² or less, none on another country); left out, as the country map is the authority',
    },
    expect: { State: 36, 'Federal capital territory': 1 },
    notes: [
      'The 36 states and the Federal Capital Territory of the constitution (section 3); the territory is played.',
      'Natural Earth spells Nasarawa "Nassarawa" and types the Federal Capital Territory as a state; ATLAS uses the official spelling and kind.',
    ],
    enabled: true,
  },
];

// A profile must account for every source row (`keys`: the source keys, or group values, of the country's rows), use
// distinct codes and names, and give every unit a declared kind. The build stops on any error.
export function validateProfile(p: Admin1Profile, keys: string[]): string[] {
  const errors: string[] = [];
  if (!ROSTER.some(r => r.id === p.country)) errors.push(`${p.country} is not a roster country`);
  const listed = new Set([...Object.keys(p.units), ...Object.keys(p.exclude ?? {}), ...Object.keys(p.mergeInto ?? {})]);
  for (const k of keys) if (!listed.has(k)) errors.push(`source row ${k} is neither in units nor in exclude`);
  for (const m of p.moveParts ?? []) {
    if (!p.units[m.from] || !p.units[m.to]) errors.push(`moveParts ${m.from} → ${m.to}: both must be units`);
    if (!m.reason) errors.push(`moveParts ${m.from} → ${m.to} needs a reason`);
  }
  for (const [k, m] of Object.entries(p.mergeInto ?? {})) {
    if (!p.units[m.into]) errors.push(`${k} is merged into ${m.into}, which is not a unit`);
    if (!m.reason) errors.push(`${k}: a merged row needs a reason`);
  }
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
