// Checks the built City Rush data in public/data/cities (run `npm run cities` after changing the build script).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { ROSTER } from './roster.ts';
import { bookOf, type CityFile, type CityIndex } from './cities.ts';
import { awards, bookVersion, findCity, foldCity } from '../game/cityMatch.ts';

const dir = new URL('../../public/data/cities/', import.meta.url);
const read = <T>(f: string): T => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const index = read<CityIndex>('index.json');
const roster = new Map(ROSTER.map(r => [r.id, r]));
const playable = Object.entries(index.countries).filter(([, e]) => e.playable).map(([id]) => id);
const load = (id: string) => read<CityFile>(`${id}.json`);

test('the index names its source, licence and attribution, and covers only roster countries', () => {
  assert.match(index.source.licence, /CC BY 4\.0/);
  assert.match(index.source.attribution, /GeoNames/);
  for (const id of Object.keys(index.countries)) assert.ok(roster.has(id), id);
  assert.ok(playable.length >= 150, `${playable.length} playable countries`);
});

test('there is a file for exactly the playable countries, and each matches its index entry', () => {
  const files = readdirSync(dir).filter(f => f !== 'index.json').map(f => f.replace('.json', '')).sort();
  assert.deepEqual(files, [...playable].sort());
  for (const id of playable) {
    const f = load(id), e = index.countries[id], book = bookOf(f);
    assert.equal(f.country, id);
    assert.equal(f.cities.length, e.cities, `${id} cities`);
    assert.equal(book.reachable.size, e.findable, `${id} findable`);
    assert.ok(e.findable >= index.minNames, `${id} findable`);
    assert.equal(f.version, bookVersion(book), `${id} version`);
    assert.equal(f.regions.length, f.admin1.length, `${id} regions`);
    // The denominator the game computes is the one the build wrote, and finding every reachable city reaches it exactly.
    assert.equal(book.total, e.population, `${id} population`);
    assert.equal(f.population, e.population, `${id} file population`);
    assert.equal(awards(book, [...book.reachable]).reduce((a, b) => a + b, 0), book.total, `${id} 100% is reachable`);
  }
});

test('every city has a unique stable id, a name, real coordinates and a population, largest first', () => {
  const ids = new Set<number>();
  for (const id of playable) {
    const f = load(id);
    let last = Infinity;
    const gids = new Set(f.cities.map(r => r[0]));
    for (const [gid, name, lng, lat, pop, a1, aliases, partOf] of f.cities) {
      assert.ok(Number.isInteger(gid) && !ids.has(gid), `${id} ${gid}`);
      ids.add(gid);
      assert.ok(name.trim().length > 0, `${id} ${gid} name`);
      assert.ok(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, `${id} ${name} coordinates`);
      assert.ok(pop >= 0 && pop <= last, `${id} ${name} order`);
      last = pop;
      assert.ok(a1 >= 0 && a1 < f.admin1.length, `${id} ${name} admin1`);
      if (aliases) assert.ok((aliases.length > 0 || partOf) && aliases.every(a => typeof a === 'string' && a.trim()), `${id} ${name} aliases`);
      if (partOf !== undefined) assert.ok(gids.has(partOf) && partOf !== gid, `${id} ${name} part of a city in the file`);
    }
  }
});

test('well-known cities are found by their common names, and only in their own country', () => {
  const cases: [string, string, string][] = [
    ['CAN', 'Montreal', 'Montréal'], ['CAN', 'toronto', 'Toronto'], ['DEU', 'Munich', 'Munich'], ['DEU', 'Cologne', 'Köln'],
    ['DEU', 'Frankfurt', 'Frankfurt am Main'], ['CHE', 'Geneva', 'Geneva'], ['ITA', 'Florence', 'Florence'], ['GBR', 'Hull', 'Kingston upon Hull'],
    ['USA', 'New York', 'New York City'], ['JPN', 'Tokyo', 'Tokyo'], ['IND', 'Bangalore', 'Bengaluru'], ['FRA', 'Paris', 'Paris'],
  ];
  const nameOf = (id: string, guess: string) => { const b = bookOf(load(id)), m = findCity(b, guess); return m ? b.cities.get(m.id)!.name : null; };
  for (const [id, guess, name] of cases) assert.equal(nameOf(id, guess), name, `${id} ${guess}`);
  assert.equal(nameOf('CAN', 'Chicago'), null);
  assert.equal(nameOf('USA', 'Mississauga'), null);
});

test('same-name cities: a region picks one, in the real data', () => {
  const book = bookOf(load('USA'));
  const at = (g: string) => { const m = findCity(book, g); return m ? book.cities.get(m.id)!.admin1 : null; };
  assert.equal(at('Portland'), 'Oregon');
  assert.equal(at('Portland, Maine'), 'Maine');
  assert.equal(at('Portland ME'), 'Maine');
  assert.equal(at('Kansas City, Kansas'), 'Kansas');
  assert.equal(at('Springfield, Illinois'), 'Illinois');
});

test('New York City and its boroughs are never counted twice', () => {
  const book = bookOf(load('USA'));
  const id = (g: string) => findCity(book, g)!.id;
  const nyc = book.cities.get(id('New York'))!;
  for (const b of ['Brooklyn', 'Queens', 'Manhattan', 'The Bronx', 'Staten Island']) assert.equal(book.cities.get(id(b))!.partOf, nyc.id, b);
  const all = awards(book, ['Brooklyn', 'Queens', 'Manhattan', 'The Bronx', 'Staten Island', 'New York'].map(id)).reduce((a, b) => a + b, 0);
  assert.equal(all, nyc.population);
});

test('France and the Netherlands keep only their European cities, as ATLAS draws them', () => {
  for (const id of ['FRA', 'NLD']) for (const [, name, lng, lat] of load(id).cities) assert.ok(lng > -11 && lng < 30 && lat > 35 && lat < 72, `${id} ${name}`);
  assert.ok(existsSync(new URL('FRA.json', dir)));
});

test('typos in the real data: obvious ones accepted, correct spellings and short names untouched, quickly', async () => {
  const { matchGuess } = await import('../game/cityMatch.ts');
  const can = bookOf(load('CAN'));
  const name = (g: string) => { const m = matchGuess(can, g); return m && (m.kind === 'typo' || m.kind === 'exact') ? `${m.kind}:${can.cities.get(m.id)!.name}` : m?.kind ?? null; };
  assert.equal(name('Niagra Falls'), 'typo:Niagara Falls');
  assert.equal(name('Tornto'), 'typo:Toronto');
  assert.equal(name('Vancover'), 'typo:Vancouver');
  assert.equal(name('Toronto'), 'exact:Toronto');
  assert.equal(name('Montreal'), 'exact:Montréal');
  // Every listed name and alias, typed correctly, is an exact match: no typo rule ever takes over.
  for (const id of ['CAN', 'DEU', 'USA']) {
    const book = bookOf(load(id));
    for (const k of book.names.keys()) assert.equal(matchGuess(book, k)?.kind, 'exact', `${id} ${k}`);
  }
  // A guess is checked against every name quickly, even in the United States.
  const usa = bookOf(load('USA'));
  matchGuess(usa, 'warmup');
  const t = performance.now();
  for (const g of ['Sprngfield', 'Philadelpha', 'Los Angelos', 'Albuquerqe', 'Zzzzzzzzz']) matchGuess(usa, g);
  assert.ok((performance.now() - t) / 5 < 20, 'under 20 ms a guess');
});

test('real smaller places one typo from a listed name are kept as guards, and never score', () => {
  let guards = 0;
  for (const id of playable) {
    const f = load(id), book = bookOf(f);
    for (const n of f.nearby ?? []) {
      guards++;
      assert.equal(book.names.has(foldCity(n)), false);
      const m = findCity(book, n);
      assert.equal(m, null, `${id} ${n} is not a listed city`);
    }
  }
  assert.ok(guards > 1000, `${guards} guards`);
});

test('smaller towns are playable, as are capitals below 1,000 people', () => {
  const at = (id: string, guess: string) => { const b = bookOf(load(id)), m = findCity(b, guess); return m ? `${b.cities.get(m.id)!.name}, ${b.cities.get(m.id)!.admin1}` : null; };
  assert.equal(at('CAN', 'Pilot Butte'), 'Pilot Butte, Saskatchewan');
  assert.equal(at('CAN', 'Tofino'), 'Tofino, British Columbia');
  assert.equal(at('CAN', 'Iqaluit'), 'Iqaluit, Nunavut');
  assert.equal(at('AUS', 'Coober Pedy'), 'Coober Pedy, South Australia');
  assert.equal(at('USA', 'Toronto, Ohio'), 'Toronto, Ohio');
  assert.equal(index.minPopulation, 1000);
  // Parham, a parish capital of Antigua and Barbuda with fewer than 1,000 people, is kept as a capital.
  assert.ok(findCity(bookOf(load('ATG')), 'Parham'));
});

test('suburbs inside a metropolitan figure count toward it, not on top of it (Greater Sydney)', () => {
  const book = bookOf(load('AUS'));
  const sydney = book.cities.get(findCity(book, 'Sydney')!.id)!;
  const parra = book.cities.get(findCity(book, 'Parramatta')!.id)!;
  assert.equal(parra.partOf, sydney.id);
  assert.equal(awards(book, [parra.id, sydney.id]).reduce((a, b) => a + b, 0), sydney.population);
});

test('country files stay small enough to load one at a time', () => {
  for (const id of playable) {
    const kb = readFileSync(new URL(`${id}.json`, dir)).length / 1024;
    assert.ok(kb < 900, `${id}: ${kb.toFixed(0)} KB`);
  }
  assert.ok(readFileSync(new URL('index.json', dir)).length < 40 * 1024, 'the index is small');
});

// ---- Sprint A: data quality and provenance ------------------------------------------------------------------------------------
import { validateCities } from '../../scripts/validate-cities.ts';

test('the validation report finds no failures in the shipped data', () => {
  const r = validateCities(new URL('.', dir).pathname, { geonames: null });
  assert.deepEqual(r.failures, []);
});

test('every name is shown in Latin script with no lost letters; repaired names come from GeoNames itself', () => {
  for (const id of playable) for (const [, name] of load(id).cities) {
    assert.ok(!/[?�]/.test(name), `${id} ${name}`);
    assert.ok(![...name].some(ch => /\p{L}/u.test(ch) && !/[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(ch)), `${id} ${name}`);
  }
  const names = (id: string) => new Set(load(id).cities.map(r => r[1]));
  assert.ok(names('IND').has('Marpara South'));
  assert.ok(names('DZA').has('Sidi Senoussi'));
  assert.ok(names('USA').has('Mākaha-Kaʻena'), 'Hawaiian names keep the ʻokina and macrons');
});

test('housing developments and prisons are not cities; one place is never listed under two forms of its name', () => {
  const mex = load('MEX').cities.map(r => r[1]);
  assert.equal(mex.filter(n => /\[(Fraccionamiento|Unidad Habitacional|CERESO)\]|Centro de Readaptaci/i.test(n)).length, 0);
  assert.equal(load('PHL').cities.filter(r => /^Mandaluyong/.test(r[1])).length, 1);
  assert.equal(load('PLW').cities.filter(r => /^Koror/.test(r[1])).length, 1);
});

test('the index records where the data came from: every input, its checksum and date, and the generator', () => {
  assert.match(index.source.dataDate, /^\d{4}-\d{2}-\d{2}$/);
  const files = index.source.inputs.map(i => i.file).sort();
  assert.deepEqual(files, ['admin1CodesASCII.txt', 'alternateNamesV2.txt', 'cities1000.txt', 'countryInfo.txt']);
  for (const i of index.source.inputs) assert.match(i.sha256 ?? i.rowsSha256 ?? '', /^[0-9a-f]{64}$/, i.file);
  assert.match(index.source.generator, /^[0-9a-f]{64}$/);
  assert.equal('builtAt' in index.source, false, 'no build time: the same inputs give the same files');
});
