// Builds the City Rush data: one file per country in public/data/cities/, plus a small index. Run with `npm run cities`.
// Source: GeoNames (CC BY 4.0, attribution required), downloaded once into data-raw/geonames/. See docs/cities.md.
//
//   cities5000.txt        every populated place of 5,000+ people (and division capitals), ~70k
//   alternateNamesV2.txt  every name of every GeoNames feature (~800 MB unzipped): only English names and names in the
//                         country's own languages are kept, never historic or colloquial ones
//   admin1CodesASCII.txt  first-level division names, for the results list
//   countryInfo.txt       each country's languages
//   cities1000.txt        every populated place of 1,000+ people: validation only, never shipped. Places not on the list
//                         that are one typo from a listed name are written to `nearby`, so typing them exactly is never
//                         corrected into another city.
//
// Which country a place counts for: GeoNames' own country code, checked against the ATLAS map. A place must lie on that
// country's drawn shape or within BORDER_KM of it (the shapes are simplified, so border and coastal towns can fall just
// outside). Places are never moved to a neighbour because a simplified border puts them there (El Paso is not Mexican).
// The one reassignment is the one the map makes on purpose: Moroccan-coded places inside Western Sahara as ATLAS draws
// it, as build-places.ts does. Anything else is left out and reported: places outside the 200 countries (Hong Kong,
// French overseas regions…) and places in territory whose control is disputed and drawn on the other side (Crimea).
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import * as turf from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { ROSTER } from '../src/data/roster.ts';
import { bookVersion, buildBook, foldCity, keptAliases, typoKeys, type RushCity } from '../src/game/cityMatch.ts';
import { distanceKm, frameOf, type LngLat } from '../src/game/geo.ts';
import type { CityFile, CityIndex, CityRow } from '../src/data/cities.ts';

const DIR = 'data-raw/geonames';
const BASE_URL = 'https://download.geonames.org/export/dump';
const OUT = process.env.CITY_OUT ?? 'public/data/cities';
// The list: GeoNames' populated places of this many people or more (cities1000 holds every place of 1,000+), plus
// national and first-level capitals of any size. CITY_MIN overrides it for measuring (5000 reads the same file).
const MIN_POPULATION = Number(process.env.CITY_MIN ?? 1000);
const MIN_NAMES = 10;
const BORDER_KM = 25;
// Deliberate reassignments: GeoNames country code → the roster id whose drawn shape takes its places.
const REASSIGN: { [cc: string]: string } = { MA: 'SAH' };
// Populated places that are not cities in their own right: sections of a city, and historical, abandoned or destroyed places.
const EXCLUDED_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
// Division capitals are kept below the population threshold (GeoNames includes them in cities5000).
const CAPITAL_CODES = new Set(['PPLC', 'PPLA', 'PPLG']);
// Administrative suffixes GeoNames keeps in some names (city, town, district), by country code.
const SUFFIX: { [cc: string]: RegExp } = { JP: /-(shi)$/, KR: /-(si|gun|eup)$/, KP: /-(si|dong|ŭp|gun)$/ };
// Reviewed by hand: everyday names GeoNames does not list, by country and GeoNames name. Keep this short and certain;
// each alias still goes through the same collision rules (src/game/cityMatch.ts), so it can never take another city's name.
const EXTRA_ALIASES: { [country: string]: { [name: string]: string[] } } = {
  GBR: { 'Stoke-on-Trent': ['Stoke'] },
};
// Two records of one place: same name, same region, closer than this. The smaller is dropped (Hyesan, La Ceiba).
const DUPLICATE_KM = 10;
// Cities GeoNames lists inside a larger city whose own population already includes them, reviewed by hand. Without this,
// New York City (8.8M) and Brooklyn (2.7M) would both be claimed in full. The parent is the largest place of that name in
// the country. Its parts are, besides the parent:
//   area     every place sharing its admin codes down to that level ('country': the whole country)
//   a2       every place in the parent's region with one of these second-level codes
//   names    the places of these names in the parent's region
//   km       every place in the parent's region within this distance of it: for a metropolitan figure with no admin code
//            of its own, drawn conservatively inside the metro area, so a separate town is never taken for a suburb
// Only cities whose GeoNames figure plainly covers the whole municipality or its listed districts are here; the build
// prints each family's figures to check. See docs/cities.md for what is not covered.
type PartRule = { parent: string; area?: 'country' | 'a1' | 'a2' | 'a3'; a2?: string[]; names?: string[]; km?: number };
const PARTS: { [country: string]: PartRule[] } = {
  USA: [{ parent: 'New York City', names: ['Brooklyn', 'Queens', 'Manhattan', 'The Bronx', 'Staten Island'] }],
  // GeoNames gives Australia's state capitals the population of the whole metropolitan area (Greater Sydney's 5.6M).
  AUS: [{ parent: 'Sydney', km: 45 }, { parent: 'Melbourne', km: 40 }, { parent: 'Brisbane', km: 30 }, { parent: 'Perth', km: 40 }, { parent: 'Adelaide', km: 30 }],
  CAN: [{ parent: 'Montréal', area: 'a3' }, { parent: 'Ottawa', area: 'a2' }, { parent: 'Toronto', area: 'a2' }],
  MEX: [{ parent: 'Mexico City', area: 'a1' }],
  CHL: [{ parent: 'Santiago', area: 'a2' }],
  GBR: [{ parent: 'London', area: 'a2' }],
  FRA: [{ parent: 'Paris', area: 'a2' }],
  ESP: [{ parent: 'Madrid', area: 'a3' }],
  BEL: [{ parent: 'Brussels', area: 'a1' }],
  POL: [{ parent: 'Warsaw', area: 'a2' }],
  CZE: [{ parent: 'Prague', area: 'a1' }],
  RUS: [{ parent: 'Moscow', area: 'a1' }, { parent: 'Saint Petersburg', area: 'a1' }],
  TUR: [{ parent: 'Istanbul', area: 'a1' }],
  ZAF: [{ parent: 'Johannesburg', area: 'a2' }],
  NGA: [{ parent: 'Lagos', area: 'a1' }],
  COD: [{ parent: 'Kinshasa', area: 'a1' }],
  IND: [{ parent: 'Delhi', area: 'a1' }],
  THA: [{ parent: 'Bangkok', area: 'a1' }],
  VNM: [{ parent: 'Hanoi', area: 'a1' }],
  MYS: [{ parent: 'Kuala Lumpur', area: 'a1' }],
  SGP: [{ parent: 'Singapore', area: 'country' }],
  TWN: [{ parent: 'Taipei', area: 'a2' }, { parent: 'New Taipei City', area: 'a2' }],
  CHN: [
    { parent: 'Shanghai', area: 'a1' }, { parent: 'Beijing', area: 'a1' }, { parent: 'Tianjin', area: 'a1' }, { parent: 'Chongqing', area: 'a1' },
    { parent: 'Guangzhou', area: 'a2' }, { parent: 'Shenzhen', area: 'a2' },
  ],
  // Tokyo's figure is the 23 special wards; the cities of western Tokyo (Hachiōji, Machida…) are separate. Ward codes:
  // Adachi, Arakawa, Chūō, Edogawa, Itabashi, Katsushika, Kita, Kōtō, Minato, Nakano, Nerima, Ōta, Shibuya, Shinagawa,
  // Shinjuku, Suginami, Toshima (the other six have no place listed).
  JPN: [{ parent: 'Tokyo', a2: ['1865750', '1865187', '1864487', '1864242', '1861322', '1859779', '1859308', '1858665', '1857091', '1855848', '1855502', '1853655', '1852582', '1852140', '1852083', '1851510', '7475135'] }],
};

async function ensure(file: string, zip?: string) {
  if (existsSync(`${DIR}/${file}`)) return;
  mkdirSync(DIR, { recursive: true });
  const name = zip ?? file;
  console.log(`Downloading ${BASE_URL}/${name}`);
  const res = await fetch(`${BASE_URL}/${name}`);
  if (!res.ok) throw new Error(`Download failed: ${name} ${res.status}`);
  writeFileSync(`${DIR}/${name}`, Buffer.from(await res.arrayBuffer()));
  if (zip) execFileSync('unzip', ['-o', '-q', `${DIR}/${zip}`, file, '-d', DIR]);
}
await ensure('alternateNamesV2.txt', 'alternateNamesV2.zip');
await ensure('admin1CodesASCII.txt');
await ensure('countryInfo.txt');
await ensure('cities1000.txt', 'cities1000.zip');

const tsv = (file: string) => readFileSync(`${DIR}/${file}`, 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'));

// ---- Countries: roster ids, ISO2 codes, drawn shapes, languages ---------------------------------------------------------
const byIso2 = new Map(ROSTER.map(r => [r.iso2, r.id]));
const topo = JSON.parse(readFileSync('public/data/countries.topo.json', 'utf8')) as Topology<{ countries: GeometryCollection }>;
type Shape = { id: string; f: Feature<Polygon | MultiPolygon>; box: [number, number, number, number] };
const rosterIds = new Set(ROSTER.map(r => r.id));
const shapes = new Map<string, Shape>();
for (const f of (feature(topo, topo.objects.countries) as GeoJSON.FeatureCollection).features) {
  const id = String(f.properties?.id);
  if (!rosterIds.has(id) || !f.geometry) continue;
  const g = f as Feature<Polygon | MultiPolygon>;
  shapes.set(id, { id, f: g, box: turf.bbox(g) as Shape['box'] });
}
const inBox = (s: Shape, [x, y]: LngLat, padDeg = 0) => x >= s.box[0] - padDeg && x <= s.box[2] + padDeg && y >= s.box[1] - padDeg && y <= s.box[3] + padDeg;
const contains = (s: Shape, p: LngLat) => inBox(s, p) && turf.booleanPointInPolygon(p, s.f);
const nearKm = (s: Shape, p: LngLat) => (inBox(s, p, 0.5) ? turf.pointToPolygonDistance(p, s.f, { units: 'kilometers' }) : Infinity);

const languages = new Map<string, Set<string>>();
for (const c of tsv('countryInfo.txt')) languages.set(c[0], new Set((c[15] ?? '').split(',').map(l => l.split('-')[0].toLowerCase()).filter(Boolean)));
const admin1Rows = tsv('admin1CodesASCII.txt');
const admin1Names = new Map(admin1Rows.map(a => [a[0], a[1]]));
// Other ways to type a region, for "Portland, Maine" / "Portland ME": the ASCII form, the US postal code (GeoNames' own
// admin1 code there), and English names and abbreviations from the alternate names.
const regionForms = new Map<string, Set<string>>(admin1Rows.map(a => [a[0], new Set([a[2], ...(a[0].startsWith('US.') ? [a[0].slice(3)] : [])].filter(x => x && x !== a[1]))]));
const admin1ByGid = new Map(admin1Rows.map(a => [Number(a[3]), a[0]]));

// ---- Places ---------------------------------------------------------------------------------------------------------------
type Place = {
  gid: number; name: string; ascii: string; lng: number; lat: number; pop: number; cc: string; a1: string; a2: string; a3: string; code: string;
  admin1: string; country: string; aliases: Set<string>; partOf: number | null;
};
const places = new Map<number, Place>();
const report = { excludedCode: 0, small: 0, reassigned: new Map<string, number>(), dropped: new Map<string, number>(), examples: new Map<string, string[]>() };
const note = (map: Map<string, number>, k: string, example: string) => {
  map.set(k, (map.get(k) ?? 0) + 1);
  const ex = report.examples.get(k) ?? [];
  if (ex.length < 4) report.examples.set(k, [...ex, example]);
};
for (const c of tsv('cities1000.txt')) {
  const [gid, name, ascii, , lat, lng, fclass, fcode, cc, , a1, a2, a3, , pop] = c;
  if (fclass !== 'P' || EXCLUDED_CODES.has(fcode)) { report.excludedCode++; continue; }
  const population = Number(pop) || 0;
  if (population < MIN_POPULATION && !CAPITAL_CODES.has(fcode)) { report.small++; continue; }
  const p: LngLat = [Number(lng), Number(lat)];
  // Where the place is on the ATLAS map: GeoNames' own country if its shape agrees, else whichever shape holds it.
  const own = byIso2.get(cc), ownShape = own ? shapes.get(own) : undefined;
  let country: string | undefined;
  const moved = REASSIGN[cc] && shapes.get(REASSIGN[cc]);
  if (moved && contains(moved, p)) { country = moved.id; note(report.reassigned, `${cc} → ${moved.id}`, name); }
  else if (ownShape && (contains(ownShape, p) || nearKm(ownShape, p) <= BORDER_KM)) country = own;
  else note(report.dropped, cc ? `${cc}${ownShape ? ' (outside its shape)' : ' (not one of the 200)'}` : '??', name);
  if (!country) continue;
  // Japanese and Korean names sometimes carry the administrative suffix ("Fukui-shi", "Goyang-si"): players type the
  // city's name, so that becomes the name, and the full form an alias.
  const full = name.replace(/\s+/g, ' ').trim(), bare = SUFFIX[cc] ? full.replace(SUFFIX[cc], '') : full;
  places.set(Number(gid), {
    gid: Number(gid), name: bare, ascii, lng: p[0], lat: p[1], pop: population, cc, a1, a2, a3, code: fcode, partOf: null,
    admin1: admin1Names.get(`${cc}.${a1}`) ?? '', country, aliases: new Set([ascii, full].filter(x => x && x !== bare)),
  });
}

// ---- Duplicate records ---------------------------------------------------------------------------------------------------
// Same name, same region, a few km apart: one place listed twice. Twin towns across a border (Kansas City, Missouri and
// Kansas) are in different regions and both kept.
const duplicates: string[] = [];
{
  const seen = new Map<string, Place[]>();
  for (const p of [...places.values()].sort((a, b) => b.pop - a.pop || a.gid - b.gid)) {
    const k = `${p.country}|${p.a1}|${foldCity(p.name)}`, prev = seen.get(k) ?? [];
    const twin = prev.find(q => distanceKm([q.lng, q.lat], [p.lng, p.lat]) < DUPLICATE_KM);
    if (twin) { places.delete(p.gid); duplicates.push(`${p.country} ${p.name} (${p.pop.toLocaleString()}, kept ${twin.pop.toLocaleString()})`); continue; }
    seen.set(k, [...prev, p]);
  }
}

// ---- Parts of a city ------------------------------------------------------------------------------------------------------
const families: string[] = [];
for (const [country, rules] of Object.entries(PARTS)) for (const rule of rules) {
  const inCountry = [...places.values()].filter(p => p.country === country);
  const parent = inCountry.filter(p => p.name === rule.parent).sort((a, b) => b.pop - a.pop)[0];
  if (!parent) throw new Error(`PARTS: no place named ${rule.parent} in ${country}`);
  if (parent.partOf) throw new Error(`PARTS: ${rule.parent} is itself a part`);
  const same = (p: Place, lvl: 'a1' | 'a2' | 'a3') => p.a1 === parent.a1 && (lvl === 'a1' || p.a2 === parent.a2) && (lvl !== 'a3' || p.a3 === parent.a3);
  const parts = inCountry.filter(p => p !== parent && (
    rule.area === 'country' ? true
      : rule.area ? same(p, rule.area) && (rule.area === 'a1' || parent[rule.area] !== '')
      : rule.a2 ? p.a1 === parent.a1 && rule.a2.includes(p.a2)
      : rule.km ? p.a1 === parent.a1 && distanceKm([parent.lng, parent.lat], [p.lng, p.lat]) <= rule.km
      : p.a1 === parent.a1 && !!rule.names?.includes(p.name)));
  if (rule.names) for (const n of rule.names) if (!parts.some(p => p.name === n)) throw new Error(`PARTS: no ${n} in ${rule.parent}'s region`);
  for (const p of parts) {
    if (p.partOf) throw new Error(`PARTS: ${p.name} is already part of another city`);
    if ([...places.values()].some(q => q.partOf === p.gid)) throw new Error(`PARTS: ${p.name} has parts of its own`);
    p.partOf = parent.gid;
  }
  const sum = parts.reduce((s, p) => s + p.pop, 0);
  families.push(`  ${country} ${parent.name} ${(parent.pop / 1e6).toFixed(2)}M: ${parts.length} parts, ${(sum / 1e6).toFixed(2)}M listed (largest: ${parts.sort((a, b) => b.pop - a.pop).slice(0, 3).map(p => p.name).join(', ')})`);
}

// ---- Aliases ----------------------------------------------------------------------------------------------------------------
// Only Latin-script names can be typed on a standard keyboard and compared; codes (MUC, NYC) and numbered names are not names.
const LATIN = /^[\p{Script=Latin}\p{M}\s'’.\-()&,]+$/u;
const goodAlias = (a: string) => LATIN.test(a) && !/\d/.test(a) && !(/^[A-Z\s.]+$/.test(a) && a.replace(/[\s.]/g, '').length <= 5) && a.replace(/[^\p{L}]/gu, '').length >= 3;
const lines = createInterface({ input: createReadStream(`${DIR}/alternateNamesV2.txt`), crlfDelay: Infinity });
let scanned = 0;
for await (const line of lines) {
  scanned++;
  const t = line.split('\t'), gid = Number(t[1]), p = places.get(gid);
  const region = !p ? admin1ByGid.get(gid) : undefined;
  if (region) {
    // A region: English names and abbreviations ("ON" for Ontario), never historic or colloquial ones.
    const a = t[3].replace(/\s+/g, ' ').trim();
    if ((t[2] === 'en' || t[2] === 'abbr') && t[6] !== '1' && t[7] !== '1' && LATIN.test(a) && !/\d/.test(a) && a.replace(/[^\p{L}]/gu, '').length >= 2
      && a !== admin1Names.get(region)) regionForms.get(region)!.add(a);
    continue;
  }
  if (!p) continue;
  const lang = t[2], colloquial = t[6] === '1', historic = t[7] === '1';
  if (colloquial || historic || !(lang === 'en' || languages.get(p.cc)?.has(lang))) continue;
  const a = t[3].replace(/\s+/g, ' ').trim();
  if (a && a !== p.name && goodAlias(a)) p.aliases.add(a);
}
console.log(`Scanned ${scanned.toLocaleString()} alternate names.`);
for (const [country, names] of Object.entries(EXTRA_ALIASES)) for (const [name, extra] of Object.entries(names)) {
  const ps = [...places.values()].filter(p => p.country === country && p.name === name);
  if (!ps.length) throw new Error(`EXTRA_ALIASES: no place named ${name} in ${country}`);
  for (const p of ps) for (const a of extra) p.aliases.add(a);
}

// ---- Smaller places (validation only) -----------------------------------------------------------------------------------
// Every populated place of cities1000 by roster country (GeoNames' code; Moroccan-coded places count for both Morocco and
// Western Sahara here, which only widens the check). Whatever is on the list is skipped later by name.
const smallByCountry = new Map<string, Set<string>>();
for (const c of tsv('cities1000.txt')) {
  if (c[6] !== 'P') continue;
  for (const id of [byIso2.get(c[8]), REASSIGN[c[8]]]) if (id) {
    const set = smallByCountry.get(id) ?? new Set<string>();
    set.add(c[1].replace(/\s+/g, ' ').trim());
    smallByCountry.set(id, set);
  }
}
let nearbyTotal = 0;

// ---- Per-country files -------------------------------------------------------------------------------------------------------
const byCountry = new Map<string, Place[]>();
for (const p of places.values()) byCountry.set(p.country, [...(byCountry.get(p.country) ?? []), p]);
const round = (n: number) => Math.round(n * 1000) / 1000;

// The camera frame: the country's cities without the farthest 3% (so Alaska and Hawaii do not shrink the United States to
// a dot), around their median point; never tighter than 60 km.
function frameFor(ps: Place[]): CityFile['frame'] {
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const mid: LngLat = [med(ps.map(p => p.lng)), med(ps.map(p => p.lat))];
  const far = ps.map(p => distanceKm(mid, [p.lng, p.lat])).sort((a, b) => a - b);
  const cut = far[Math.min(far.length - 1, Math.floor(far.length * 0.97))];
  const core = ps.filter(p => distanceKm(mid, [p.lng, p.lat]) <= cut).map(p => [p.lng, p.lat] as LngLat);
  const f = frameOf(core.length ? core : [mid]);
  return { center: [round(f.center[0]), round(f.center[1])], radiusKm: Math.max(60, Math.round(f.radiusKm)) };
}

if (existsSync(OUT)) for (const f of readdirSync(OUT)) rmSync(`${OUT}/${f}`);
mkdirSync(OUT, { recursive: true });
const index: CityIndex = {
  source: {
    name: `GeoNames cities1000 (places of ${MIN_POPULATION.toLocaleString()}+ people) and alternate names`, url: `${BASE_URL}/`, licence: 'CC BY 4.0',
    attribution: 'Contains data from GeoNames (geonames.org), licensed under CC BY 4.0.', builtAt: new Date().toISOString(),
  },
  minPopulation: MIN_POPULATION, minNames: MIN_NAMES, countries: {},
};
let written = 0, bytes = 0;
for (const r of ROSTER) {
  const ps = (byCountry.get(r.id) ?? []).sort((a, b) => b.pop - a.pop || a.gid - b.gid);
  if (!ps.length) continue;
  const codes = [...new Set(ps.map(p => `${p.cc}.${p.a1}`))];
  const admin1 = codes.map(c => admin1Names.get(c) ?? '');
  const regions = codes.map(c => [...(regionForms.get(c) ?? [])]);
  const cities: RushCity[] = ps.map(p => ({
    id: `gn:${p.gid}`, name: p.name, aliases: [...p.aliases], lng: p.lng, lat: p.lat, population: p.pop,
    admin1: p.admin1, region: codes.indexOf(`${p.cc}.${p.a1}`), partOf: p.partOf ? `gn:${p.partOf}` : null,
  }));
  const book = buildBook(cities, admin1.map((n, i) => [n, ...regions[i]]));
  // The smaller places a typo rule could otherwise read as a listed city.
  const nearby = [...(smallByCountry.get(r.id) ?? [])].filter(n => { const k = foldCity(n); return k && !book.names.has(k) && typoKeys(book, k).length > 0; }).sort();
  nearbyTotal += nearby.length;
  for (const p of ps) if (p.partOf && !book.reachable.has(`gn:${p.partOf}`)) throw new Error(`PARTS: ${p.name}'s city cannot be found by name`);
  const version = bookVersion(book);
  const playable = book.reachable.size >= MIN_NAMES;
  index.countries[r.id] = { cities: cities.length, findable: book.reachable.size, population: book.total, version, playable };
  if (!playable) continue;
  const rows: CityRow[] = cities.map((c, i) => {
    const kept = keptAliases(book, c), p = ps[i];
    const row: CityRow = [p.gid, c.name, round(c.lng), round(c.lat), c.population, c.region];
    if (kept.length || p.partOf) row.push(kept);
    if (p.partOf) row.push(p.partOf);
    return row;
  });
  const file: CityFile = { country: r.id, version, frame: frameFor(ps), admin1, regions, population: book.total, ...(nearby.length ? { nearby } : {}), cities: rows };
  const json = JSON.stringify(file);
  writeFileSync(`${OUT}/${r.id}.json`, json);
  written++;
  bytes += json.length;
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(index));

// ---- Report ------------------------------------------------------------------------------------------------------------------
const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `  ${k}: ${n} (${report.examples.get(k)?.join(', ')})`).join('\n');
console.log(`Kept ${places.size.toLocaleString()} places; left out ${report.excludedCode} city sections or historical places and ${report.small} under ${MIN_POPULATION.toLocaleString()} people.`);
console.log(`Duplicate records dropped (${duplicates.length}):\n  ${duplicates.join('\n  ') || 'none'}`);
console.log(`Parts of a city:\n${families.join('\n')}`);
console.log(`Reassigned on purpose:\n${top(report.reassigned) || '  none'}`);
console.log(`Left out:\n${top(report.dropped) || '  none'}`);
const entries = Object.entries(index.countries);
console.log(`Wrote ${written} playable countries (${(bytes / 1e6).toFixed(1)} MB). ${entries.length - written} countries have fewer than ${MIN_NAMES} names:`,
  entries.filter(([, e]) => !e.playable).map(([id, e]) => `${id} ${e.findable}`).join(', '));
console.log(`Smaller places kept as typo guards: ${nearbyTotal.toLocaleString()}`);
console.log(`No cities at all: ${ROSTER.filter(r => !index.countries[r.id]).map(r => r.id).join(', ') || 'none'}`);
