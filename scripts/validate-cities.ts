// Checks the built City Rush data (public/data/cities) and reports what a release changes. Run with
// `npm run cities:validate` (optionally `-- --against <git ref>`, default HEAD). Exits 1 on any failure.
//
//   failures  definite errors: the files disagree with the index, an id repeats, a coordinate is impossible, a city in a
//             score's denominator cannot be named, a part of a city points nowhere, a national capital is missing…
//   warnings  for a person to review: suspected overlapping populations, unusual names, facility settlements, and how much
//             each country's denominator moved since the release it is compared with
//
// The data test runs validateCities() too, so `npm test` fails on the same errors.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bookOf, regionNamesOf, type CityFile, type CityIndex } from '../src/data/cities.ts';
import { ROSTER } from '../src/data/roster.ts';
import { awards, bookVersion, findCity, foldCity } from '../src/game/cityMatch.ts';
import { distanceKm } from '../src/game/geo.ts';

export type Change = { country: string; before: { findable: number; population: number; version: string } | null; after: { findable: number; population: number; version: string } | null };
export type Report = { failures: string[]; warnings: string[]; changes: Change[]; summary: { countries: number; cities: number; findable: number; population: number } };

const nonLatin = (s: string) => [...s].some(ch => /\p{L}/u.test(ch) && !/[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(ch));

export function validateCities(dir = 'public/data/cities', opts: { previous?: CityIndex | null; geonames?: string | null } = {}): Report {
  const failures: string[] = [], warnings: string[] = [];
  const fail = (s: string) => failures.push(s), warn = (s: string) => warnings.push(s);
  const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')) as CityIndex;
  const playable = Object.entries(index.countries).filter(([, e]) => e.playable).map(([id]) => id).sort();
  const files = readdirSync(dir).filter(f => f !== 'index.json').map(f => f.replace('.json', '')).sort();
  if (files.join() !== playable.join()) fail(`files and index disagree: ${files.filter(f => !playable.includes(f)).concat(playable.filter(p => !files.includes(p))).join(', ')}`);
  const roster = new Set(ROSTER.map(r => r.id));
  for (const id of Object.keys(index.countries)) if (!roster.has(id)) fail(`${id}: not a roster country`);
  if (!index.source.inputs?.length) fail('index: no input provenance');

  const seen = new Map<number, string>();
  let cities = 0, findable = 0, population = 0;
  const latinNames = new Set<string>();
  for (const id of files) {
    const f = JSON.parse(readFileSync(`${dir}/${id}.json`, 'utf8')) as CityFile, e = index.countries[id], book = bookOf(f), regions = regionNamesOf(f);
    cities += f.cities.length; findable += book.reachable.size; population += book.total;
    // The index and the file tell the same story, and the game computes the same denominator the build wrote.
    if (f.country !== id) fail(`${id}: file says ${f.country}`);
    if (f.cities.length !== e?.cities) fail(`${id}: ${f.cities.length} cities, index says ${e?.cities}`);
    if (book.reachable.size !== e?.findable) fail(`${id}: ${book.reachable.size} findable, index says ${e?.findable}`);
    if (book.total !== e?.population || f.population !== e?.population) fail(`${id}: denominator ${book.total}, index ${e?.population}, file ${f.population}`);
    if (bookVersion(book) !== f.version || f.version !== e?.version) fail(`${id}: data version mismatch`);
    if (awards(book, [...book.reachable]).reduce((a, b) => a + b, 0) !== book.total) fail(`${id}: naming every findable city does not reach 100%`);
    if (f.regions.length !== f.admin1.length) fail(`${id}: regions and admin1 differ in length`);
    // Rows: unique ids, real coordinates, populations, names that can be typed.
    for (const [gid, name, lng, lat, pop, a1, , partOf] of f.cities) {
      if (seen.has(gid)) fail(`${id}: id ${gid} (${name}) also in ${seen.get(gid)}`); else seen.set(gid, id);
      if (!(Math.abs(lng) <= 180 && Math.abs(lat) <= 90)) fail(`${id}: ${name} has impossible coordinates ${lng}, ${lat}`);
      if (!Number.isInteger(pop) || pop < 0) fail(`${id}: ${name} has population ${pop}`);
      if (!(a1 >= 0 && a1 < f.admin1.length)) fail(`${id}: ${name} has no region index`);
      if (!foldCity(name)) fail(`${id}: ${name} cannot be typed`);
      if (nonLatin(name)) fail(`${id}: ${name} is not shown in Latin script`);
      if (/[?�]/.test(name)) fail(`${id}: ${name} has lost letters`);
      if (/\[[^\]]+\]/.test(name)) warn(`${id}: ${name}: a facility or locality type in brackets (review whether it is a settlement)`);
      if (partOf !== undefined) {
        const parent = f.cities.find(r => r[0] === partOf);
        if (!parent) fail(`${id}: ${name} is part of ${partOf}, which is not in the file`);
        else if (parent[7] !== undefined) fail(`${id}: ${name} is part of ${parent[1]}, itself a part`);
        else if (!book.reachable.has(`gn:${partOf}`)) fail(`${id}: ${name}'s city ${parent[1]} cannot be named`);
      }
      latinNames.add(`${id}:${gid}`);
    }
    // Every city in the denominator can be named: by a name or alias of its own, alone or with its region.
    const keysOf = new Map<string, string[]>();
    for (const [k, ids] of book.names) for (const cid of ids) keysOf.set(cid, [...(keysOf.get(cid) ?? []), k]);
    for (const cid of book.reachable) {
      const c = book.cities.get(cid)!, keys = keysOf.get(cid) ?? [];
      const named = keys.some(k => findCity(book, k)?.id === cid || regions[c.region].some(r => findCity(book, `${k}, ${r}`)?.id === cid));
      if (!named) fail(`${id}: ${c.name} (${c.admin1 || 'no region'}) counts toward the total but no guess reaches it`);
    }
    // Suspected overlap: a city of 1M+ with no listed parts, and listed places within 10 km adding up to a quarter of it.
    const parents = new Set(f.cities.flatMap(r => (r[7] !== undefined ? [r[7]] : [])));
    for (const p of f.cities) {
      if (p[4] < 1_000_000) break;
      if (parents.has(p[0]) || p[7] !== undefined) continue;
      const near = f.cities.filter(r => r !== p && r[7] === undefined && r[4] < p[4] * 0.3 && distanceKm([p[2], p[3]], [r[2], r[3]]) < 10);
      const sum = near.reduce((s, r) => s + r[4], 0);
      if (sum > p[4] * 0.25) warn(`${id}: ${p[1]} (${(p[4] / 1e6).toFixed(2)}M) has ${near.length} listed places within 10 km totalling ${(sum / 1e6).toFixed(2)}M (${Math.round((sum / p[4]) * 100)}%): districts or separate towns? (largest: ${near.sort((a, b) => b[4] - a[4]).slice(0, 3).map(r => r[1]).join(', ')})`);
    }
  }

  // National capitals of playable countries, from the raw GeoNames file when it is at hand.
  const raw = opts.geonames ?? (existsSync('data-raw/geonames/cities1000.txt') ? 'data-raw/geonames/cities1000.txt' : null);
  if (raw) {
    const byIso2 = new Map(ROSTER.map(r => [r.iso2, r.id]));
    for (const line of readFileSync(raw, 'utf8').split('\n')) {
      const c = line.split('\t');
      if (c[7] !== 'PPLC') continue;
      const id = byIso2.get(c[8]);
      if (id && playable.includes(id) && !seen.has(Number(c[0]))) fail(`${id}: national capital ${c[1]} is missing`);
    }
  } else warn('national capitals not checked: no GeoNames file at hand');

  // What changes against the previous release: every country whose denominator or version moved.
  const changes: Change[] = [];
  if (opts.previous) {
    const ids = new Set([...Object.keys(opts.previous.countries), ...Object.keys(index.countries)]);
    for (const id of [...ids].sort()) {
      const a = opts.previous.countries[id], b = index.countries[id];
      const pick = (e: typeof a) => (e?.playable ? { findable: e.findable, population: e.population, version: e.version } : null);
      const before = pick(a), after = pick(b);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      changes.push({ country: id, before, after });
      if (before && after && Math.abs(after.population - before.population) > before.population * 0.05)
        warn(`${id}: denominator moves ${(((after.population - before.population) / before.population) * 100).toFixed(1)}% since the previous release`);
    }
  }
  return { failures, warnings, changes, summary: { countries: files.length, cities, findable, population } };
}

// ---- Command line -----------------------------------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--against'), ref = at > 0 ? process.argv[at + 1] : 'HEAD';
  let previous: CityIndex | null = null;
  try { previous = JSON.parse(execFileSync('git', ['show', `${ref}:public/data/cities/index.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { console.log(`(no city index at ${ref}: release changes not compared)`); }
  const r = validateCities('public/data/cities', { previous });
  const s = r.summary;
  console.log(`${s.countries} playable countries, ${s.cities.toLocaleString()} cities, ${s.findable.toLocaleString()} findable, ${(s.population / 1e9).toFixed(3)}B people in the denominators.`);
  console.log(`\nFailures (${r.failures.length}):${r.failures.length ? `\n  ${r.failures.join('\n  ')}` : ' none'}`);
  console.log(`\nWarnings (${r.warnings.length}):${r.warnings.length ? `\n  ${r.warnings.join('\n  ')}` : ' none'}`);
  if (previous) {
    console.log(`\nChanged since ${ref} (${r.changes.length} countries): denominator and findable cities, before → after`);
    for (const c of r.changes) {
      const f = (e: Change['before']) => (e ? `${e.population.toLocaleString()} people, ${e.findable.toLocaleString()} cities` : 'not playable');
      const d = c.before && c.after ? ` (${c.after.population - c.before.population >= 0 ? '+' : ''}${(c.after.population - c.before.population).toLocaleString()})` : '';
      console.log(`  ${c.country}: ${f(c.before)} → ${f(c.after)}${d}`);
    }
  }
  process.exit(r.failures.length ? 1 : 0);
}
