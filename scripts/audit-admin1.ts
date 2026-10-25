// Audits Natural Earth's first-level subdivisions for every ATLAS country and writes the coverage manifest,
// docs/subdivision-coverage.md. Run with `npm run admin1:audit` (after `npm run admin1`, whose index it reads for the
// supported countries). Read-only: it changes no data. See docs/subdivisions.md, Phase 6.
//
// For each country: the Natural Earth rows filed under it, their types, how many have a clean and unique ISO 3166-2
// code, rows without a name or type, and how the rows' total area compares with the country on the map (a large
// difference means disputed or misattributed land to review). The grade is a starting point for review, not a verdict:
//   A  every row has a clean, unique code, a name and a type, and the area agrees within 2%
//   B  small fixes in a profile (missing types or names, a few codes to set by hand)
//   C  review first: the area disagrees by more than 2%, or most codes are missing or duplicated
//   –  one row or none: the country has no first-level divisions in the data
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { ROSTER } from '../src/data/roster.ts';
import { PROFILES } from '../src/data/admin1Profiles.ts';

const RAW = 'data-raw/ca96624-ne_10m_admin_1_states_provinces.geojson';
const OUT = 'docs/subdivision-coverage.md';
if (!existsSync(RAW)) throw new Error(`${RAW} is missing: run \`npm run admin1\` first, which downloads it.`);
// Countries whose Natural Earth rows include other entities merged into them on the country map (build-countries.ts).
const MERGED: { [id: string]: string[] } = { SOM: ['SOL'], CYP: ['CYN'], KAZ: ['KAB'], CUB: ['USG'] };
// Player interest, for ordering the next batches: the largest and most-played countries first (a judgement, reviewed
// with each batch). Everything else follows by grade and size.
const INTEREST = ['CHN', 'RUS', 'ITA', 'ESP', 'GBR', 'IDN', 'ZAF', 'ARG', 'KOR', 'TUR', 'POL', 'PHL', 'EGY', 'COL', 'PAK', 'UKR', 'IRN', 'VNM', 'THA', 'PER',
  'CHL', 'KEN', 'ETH', 'SWE', 'NOR', 'NLD', 'BEL', 'CHE', 'AUT', 'NZL', 'IRL', 'PRT', 'GRC', 'SAU', 'MYS', 'VEN', 'BGD', 'MAR', 'DZA'];

type Row = Feature<Polygon | MultiPolygon, Record<string, any>>;
const raw = JSON.parse(readFileSync(RAW, 'utf8')) as FeatureCollection<Polygon | MultiPolygon>;
const topo = JSON.parse(readFileSync('public/data/countries.topo.json', 'utf8')) as Topology<{ countries: GeometryCollection }>;
const shapes = new Map((feature(topo, topo.objects.countries) as FeatureCollection).features.map(f => [String(f.properties?.id), f]));
const index = existsSync('public/data/admin1/index.json') ? JSON.parse(readFileSync('public/data/admin1/index.json', 'utf8')) : { countries: {} };

type Audit = { id: string; name: string; rows: number; types: string; clean: number; dupes: number; untyped: number; unnamed: number; areaPct: number | null; grade: string; supported: string; notes: string[] };
const audits: Audit[] = ROSTER.map(r => {
  const sources = [r.id, ...(MERGED[r.id] ?? [])];
  const rows = raw.features.filter(f => sources.includes(f.properties?.adm0_a3)) as Row[];
  const codes = rows.map(f => String(f.properties.iso_3166_2 ?? ''));
  const cleanCode = (c: string) => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(c);
  const counts = new Map<string, number>(); for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const clean = codes.filter(c => cleanCode(c) && counts.get(c) === 1).length;
  const dupes = [...counts.values()].filter(n => n > 1).length;
  const untyped = rows.filter(f => !f.properties.type_en).length, unnamed = rows.filter(f => !f.properties.name).length;
  const types: { [t: string]: number } = {};
  for (const f of rows) { const t = f.properties.type_en ?? 'untyped'; types[t] = (types[t] ?? 0) + 1; }
  const shape = shapes.get(r.id);
  const areaPct = rows.length && shape ? (rows.reduce((n, f) => n + turf.area(f), 0) / turf.area(shape as Row) - 1) * 100 : null;
  const notes: string[] = [];
  if (MERGED[r.id]) notes.push(`includes ${MERGED[r.id].join(', ')} rows (merged into it on the country map)`);
  // Rows coded under another country's ISO prefix: land one country administers and another's code names (Crimea).
  const foreign = codes.filter(c => cleanCode(c) && c.slice(0, 2) !== r.iso2);
  // Either disputed land (Crimea under Russia) or a territory's code in its sovereign's list (US-PR): reviewed by hand.
  if (foreign.length && rows.length > 1) notes.push(`**${foreign.length} row${foreign.length === 1 ? '' : 's'} coded under another country (${foreign.join(', ')}): check for disputed land**`);
  if (rows.length === 1) notes.push('one row, the whole country: no first-level divisions to play');
  if (rows.length > 60) notes.push('more rows than a typical first level: check whether they group into a higher level, as France\'s departments do');
  if (dupes) notes.push(`${dupes} shared ISO code${dupes === 1 ? '' : 's'}`);
  if (rows.length && clean < rows.length) notes.push(`${rows.length - clean} row${rows.length - clean === 1 ? '' : 's'} without a clean, unique code`);
  if (areaPct !== null && Math.abs(areaPct) > 2) notes.push(`rows' area ${areaPct > 0 ? 'exceeds' : 'falls short of'} the country map by ${Math.abs(areaPct).toFixed(1)}%`);
  const grade = rows.length <= 1 ? '–'
    : (areaPct !== null && Math.abs(areaPct) > 2) || clean < rows.length / 2 || foreign.length ? 'C'
    : clean === rows.length && !untyped && !unnamed ? 'A' : 'B';
  const meta = index.countries[r.id], profile = PROFILES.find(p => p.country === r.id);
  const supported = meta?.enabled ? `**${meta.count}** ${meta.count === 1 ? meta.terms.singular : meta.terms.plural}${meta.others?.length ? ` (+${meta.others.length} not played)` : ''}` : profile ? 'profile, not enabled' : '';
  return { id: r.id, name: r.name, rows: rows.length, types: Object.entries(types).map(([t, n]) => `${n} ${t}`).join(', '), clean, dupes, untyped, unnamed, areaPct, grade, supported, notes };
});

const by = (g: string) => audits.filter(a => a.grade === g).length;
const supported = audits.filter(a => a.supported.startsWith('**'));
const queue = [...INTEREST.map(id => audits.find(a => a.id === id)!), ...audits.filter(a => !INTEREST.includes(a.id)).sort((a, b) => a.grade.localeCompare(b.grade) || b.rows - a.rows)]
  .filter(a => !a.supported && a.rows > 0);
const pct = (n: number | null) => (n === null ? '' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const md = `# Subdivision coverage

Generated by \`npm run admin1:audit\` (scripts/audit-admin1.ts) from Natural Earth Admin-1 1:10m at commit \`ca96624\` and the ATLAS country map. Do not edit by hand. How countries are added: [subdivisions.md](subdivisions.md#adding-a-country).

**Supported:** ${supported.length} of ${audits.length} countries (${supported.map(a => a.name).join(', ')}). Every other country shows "Regions of … are not available yet." in Explore.

**Data grades** (a starting point for review, not a verdict): A ${by('A')} · B ${by('B')} · C ${by('C')} · no divisions ${by('–')}. Supported countries were reviewed against their grade's notes; their profiles record what was found.
A: every row has a clean, unique ISO 3166-2 code, a name and a type, and the rows' area agrees with the country map within 2%. B: small fixes in a profile. C: review first (disputed or misattributed land, or most codes missing). Natural Earth's row count is not always the official first-level count (France's rows are departments, not regions); each profile is checked against an official source and declares its own counts.

**Next batches, in order of review** (player interest, then grade): ${queue.slice(0, 16).map(a => `${a.name} (${a.grade})`).join(', ')}.

| Country | Supported | NE rows | Types | Clean codes | Area vs map | Grade | Notes |
|---|---|---:|---|---:|---:|:-:|---|
${audits.map(a => `| ${a.name} | ${a.supported} | ${a.rows} | ${a.types} | ${a.rows ? `${a.clean}/${a.rows}` : ''} | ${pct(a.areaPct)} | ${a.grade} | ${a.notes.join('; ')} |`).join('\n')}
`;
writeFileSync(OUT, md);
console.log(`Wrote ${OUT}: ${supported.length} supported; grades A ${by('A')}, B ${by('B')}, C ${by('C')}, no divisions ${by('–')}.`);
