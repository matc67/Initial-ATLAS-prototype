import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awards, bookVersion, buildBook, findCity, foldCity, keptAliases, matchGuess, oneEdit, typoKeys, type RushCity } from './cityMatch.ts';
import { guessRush, newRush } from './cityRush.ts';

let n = 0;
const city = (name: string, population: number, aliases: string[] = [], region = 0, partOf: string | null = null): RushCity =>
  ({ id: `gn:${++n}`, name, aliases, population, lng: 0, lat: 0, admin1: `R${region}`, region, partOf });
const found = (book: ReturnType<typeof buildBook>, guess: string) => findCity(book, guess)?.id ?? null;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test('folding forgives case, accents, punctuation and common abbreviations', () => {
  assert.equal(foldCity('MONTRÉAL'), foldCity('montreal'));
  assert.equal(foldCity('Saint-Jean-sur-Richelieu'), foldCity('st jean sur richelieu'));
  assert.equal(foldCity("St. John's"), foldCity('Saint Johns'));
  assert.equal(foldCity('Ste-Foy'), foldCity('Sainte Foy'));
  assert.equal(foldCity('Mt. Pearl'), foldCity('Mount Pearl'));
  assert.equal(foldCity('Ft. Worth'), foldCity('Fort Worth'));
  // Letters Unicode does not decompose are folded too, so they are never dropped.
  assert.equal(foldCity('Tromsø'), 'tromso');
  assert.equal(foldCity('Ærøskøbing'), 'aeroskobing');
  assert.equal(foldCity('Łódź'), 'lodz');
  assert.equal(foldCity('Großenhain'), 'grossenhain');
  assert.equal(foldCity('  '), '');
});

test('a city is found by its name, its ASCII form and its aliases, with any capitalisation or accents', () => {
  const munich = city('München', 1_500_000, ['Munich', 'Muenchen']), koln = city('Köln', 1_000_000, ['Cologne']);
  const book = buildBook([munich, koln]);
  for (const g of ['München', 'munchen', 'MUNICH', 'Muenchen']) assert.equal(found(book, g), munich.id, g);
  assert.equal(found(book, 'cologne'), koln.id);
  assert.equal(found(book, 'KOLN'), koln.id);
});

test('no fuzzy matches: near misses, prefixes and empty guesses find nothing', () => {
  const book = buildBook([city('Toronto', 2_700_000), city('Yorkton', 16_000)]);
  for (const g of ['Toront', 'Torontoo', 'York', 'ork', '', '   ', '!!!']) assert.equal(findCity(book, g), null, g);
});

test('a shared name means the largest city of that name; a region picks another', () => {
  const or = city('Portland', 650_000, [], 0), me = city('Portland', 68_000, [], 1), tx = city('Portland', 15_000, [], 2);
  const book = buildBook([tx, me, or], [['Oregon', 'OR'], ['Maine', 'ME'], ['Texas', 'TX']]);
  assert.equal(found(book, 'portland'), or.id);
  assert.deepEqual(findCity(book, 'Portland'), { id: or.id, qualified: false });
  for (const g of ['Portland, Maine', 'portland maine', 'Portland (ME)', 'PORTLAND ME']) assert.deepEqual(findCity(book, g), { id: me.id, qualified: true }, g);
  assert.equal(found(book, 'Portland, Oregon'), or.id);
  assert.equal(found(book, 'Portland Texas'), tx.id);
  assert.equal(findCity(book, 'Portland, Ohio'), null, 'no Portland in that region');
  assert.equal(findCity(book, 'Maine'), null, 'a region alone is not a city');
  // Every one of them can be reached, so every one counts toward the total.
  assert.equal(book.reachable.size, 3);
  assert.equal(book.total, 650_000 + 68_000 + 15_000);
});

test('same name in the same region: the largest is reachable, the rest are left out of the total', () => {
  const a = city('San José', 200_000, [], 0), b = city('San José', 30_000, [], 0);
  const book = buildBook([a, b], [['Santa Catarina']]);
  assert.equal(found(book, 'San Jose, Santa Catarina'), a.id);
  assert.deepEqual([...book.reachable], [a.id]);
  assert.equal(book.total, 200_000);
});

test('a whole city name wins over a name plus region', () => {
  const kc = city('Kansas City', 500_000, [], 0), kck = city('Kansas City', 150_000, [], 1), k = city('Kansas', 9_000, [], 0);
  const book = buildBook([kc, kck, k], [['Missouri'], ['Kansas']]);
  assert.equal(found(book, 'Kansas'), k.id);
  assert.equal(found(book, 'Kansas City Kansas'), kck.id);
});

test('an alias never takes another city’s own name', () => {
  // A small place whose alias is "Paris" must not answer for Paris.
  const paris = city('Paris', 2_100_000), other = city('Paris-l’Hôpital', 5_000, ['Paris']);
  const book = buildBook([paris, other]);
  assert.equal(found(book, 'Paris'), paris.id);
  assert.deepEqual(keptAliases(book, other), []);
});

test('an alias shared by two cities goes to the largest only when it dwarfs the other; otherwise it is dropped', () => {
  const main = city('Frankfurt am Main', 750_000, ['Frankfurt']), oder = city('Frankfurt (Oder)', 57_000, ['Frankfurt']);
  assert.equal(found(buildBook([main, oder]), 'Frankfurt'), main.id);
  const a = city('Newport North', 40_000, ['Newport']), b = city('Newport South', 30_000, ['Newport']);
  assert.equal(findCity(buildBook([a, b]), 'Newport'), null);
});

test('kept aliases drop duplicates and anything that folds to the city’s own name', () => {
  const c = city('Montréal', 1_700_000, ['Montreal', 'Montréal', 'Montreal', 'Montreal City']);
  const book = buildBook([c]);
  assert.deepEqual(keptAliases(book, c), ['Montreal City']);
});

test('only the cities passed in are searched: another country’s city is never a match', () => {
  const canada = buildBook([city('Victoria', 90_000), city('London', 400_000)]);
  const seychelles = buildBook([city('Victoria', 26_000)]);
  assert.ok(findCity(canada, 'London'));
  assert.equal(findCity(seychelles, 'London'), null);
  assert.equal(findCity(canada, 'Paris'), null);
});

test('each city adds its population once, whatever spelling found it', () => {
  const toronto = city('Toronto', 2_794_356), ottawa = city('Ottawa', 1_017_449, ['Bytown']);
  const book = buildBook([toronto, ottawa]);
  assert.deepEqual(awards(book, [toronto.id, ottawa.id]), [2_794_356, 1_017_449]);
  assert.equal(book.total, 2_794_356 + 1_017_449);
});

test('a city and the districts listed inside it never count twice, in either order', () => {
  const nyc = city('New York City', 8_800_000);
  const bk = city('Brooklyn', 2_700_000, [], 0, nyc.id), qn = city('Queens', 2_300_000, [], 0, nyc.id);
  const book = buildBook([nyc, bk, qn]);
  // The total is the city's own figure: its districts are inside it.
  assert.equal(book.total, 8_800_000);
  assert.deepEqual(awards(book, [bk.id, nyc.id]), [2_700_000, 6_100_000]);
  assert.deepEqual(awards(book, [nyc.id, bk.id, qn.id]), [8_800_000, 0, 0]);
  assert.equal(sum(awards(book, [qn.id, bk.id, nyc.id])), 8_800_000);
  // Listed districts adding up to more than the city are capped at what the city has left.
  const city2 = city('Paris', 2_000_000), a = city('Paris 15', 1_500_000, [], 0, city2.id), b = city('Paris 20', 1_000_000, [], 0, city2.id);
  const book2 = buildBook([city2, a, b]);
  assert.deepEqual(awards(book2, [a.id, b.id, city2.id]), [1_500_000, 500_000, 0]);
});

test('a city with no population recorded can be found but adds no people and is not in the total', () => {
  const capital = city('Bridgetown', 0), other = city('Speightstown', 3_600);
  const book = buildBook([capital, other]);
  assert.equal(found(book, 'Bridgetown'), capital.id);
  assert.deepEqual(awards(book, [capital.id]), [0]);
  assert.equal(book.total, 3_600);
});

test('the data version changes when a population or a part changes', () => {
  const a = city('A', 100), b = city('B', 50);
  const v = bookVersion(buildBook([a, b]));
  assert.equal(bookVersion(buildBook([a, b])), v);
  assert.notEqual(bookVersion(buildBook([a, { ...b, population: 51 }])), v);
  assert.notEqual(bookVersion(buildBook([a, { ...b, partOf: a.id }])), v);
});

// ---- Typos ------------------------------------------------------------------------------------------------------------------

test('one edit: insertion, deletion, neighbour swap, substitution', () => {
  assert.equal(oneEdit('tornto', 'toronto'), 'gap');
  assert.equal(oneEdit('torotno', 'toronto'), 'gap');
  assert.equal(oneEdit('torontoo', 'toronto'), 'gap');
  assert.equal(oneEdit('toronta', 'toronto'), 'sub');
  assert.equal(oneEdit('toronto', 'toronto'), null);
  assert.equal(oneEdit('trnto', 'toronto'), null);
  assert.equal(oneEdit('otronot', 'toronto'), null);
});

test('typos of long enough names are accepted as that city, and say so', () => {
  const niagara = city('Niagara Falls', 88_071), toronto = city('Toronto', 2_794_356), vancouver = city('Vancouver', 600_000);
  const book = buildBook([niagara, toronto, vancouver]);
  assert.deepEqual(matchGuess(book, 'Niagra Falls'), { kind: 'typo', id: niagara.id, ids: [niagara.id], qualified: false, as: 'Niagara Falls' });
  assert.deepEqual(matchGuess(book, 'Tornto'), { kind: 'typo', id: toronto.id, ids: [toronto.id], qualified: false, as: 'Toronto' });
  assert.deepEqual(matchGuess(book, 'vancover'), { kind: 'typo', id: vancouver.id, ids: [vancouver.id], qualified: false, as: 'Vancouver' });
  assert.equal(matchGuess(book, 'NiagaraFalls')?.kind, 'typo', 'a missing space is one edit');
  assert.equal(matchGuess(book, 'Vancouvar')?.kind, 'typo', 'substitution in a 9-letter name');
  assert.equal(matchGuess(book, 'Trnto'), null, 'two edits are never accepted');
});

test('accents and case are forgiven exactly, before any typo rule', () => {
  const m = city('Montréal', 1_700_000), q = city('Québec', 550_000);
  const book = buildBook([m, q]);
  assert.deepEqual(matchGuess(book, 'MONTREAL'), { kind: 'exact', id: m.id, ids: [m.id], qualified: false });
  assert.deepEqual(matchGuess(book, 'quebec'), { kind: 'exact', id: q.id, ids: [q.id], qualified: false });
  assert.equal(matchGuess(book, 'Montrael')?.kind, 'typo');
});

test('short names are never corrected; substitutions need 8 letters', () => {
  const book = buildBook([city('Rome', 2_800_000), city('Lima', 9_000), city('York', 200_000), city('Hagen', 190_000), city('Bremen', 560_000), city('Toronto', 2_794_356)]);
  for (const g of ['Rom', 'Rme', 'Lma', 'Yrok', 'Yorkk', 'Hagn', 'Haren', 'Bremer', 'Toronta']) assert.equal(matchGuess(book, g), null, g);
  assert.equal(matchGuess(book, 'Brmen')?.kind, 'typo', 'a deletion in a 6-letter name');
});

test('a correctly spelled city always wins over a typo of another', () => {
  const a = city('Hamilton', 570_000), b = city('Hamilten', 6_000);
  const book = buildBook([a, b]);
  assert.deepEqual(matchGuess(book, 'Hamilten'), { kind: 'exact', id: b.id, ids: [b.id], qualified: false });
  assert.deepEqual(matchGuess(book, 'Hamilton'), { kind: 'exact', id: a.id, ids: [a.id], qualified: false });
});

test('a typo close to two different cities is ambiguous and awards nothing', () => {
  const book = buildBook([city('Marlton', 10_000), city('Carlton', 12_000)]);
  assert.deepEqual(matchGuess(book, 'Arlton'), { kind: 'ambiguous' });
  // One city reached by two of its names is not ambiguous.
  const one = city('Kingston upon Hull', 260_000, ['Hullington']);
  assert.equal(matchGuess(buildBook([one]), 'Kingston upon Hul')?.kind, 'typo');
});

test('a typo never bypasses same-name rules: it means what the correct spelling means', () => {
  const or = city('Portland', 650_000, [], 0), me = city('Portland', 68_000, [], 1);
  const book = buildBook([or, me], [['Oregon'], ['Maine', 'ME']]);
  assert.deepEqual((matchGuess(book, 'Portlnd') as { ids: string[] }).ids, [or.id, me.id], 'a bare typo means every Portland, as the right spelling does');
  const q = matchGuess(book, 'Portlnd, Maine');
  assert.deepEqual(q, { kind: 'typo', id: me.id, ids: [me.id], qualified: true, as: 'Portland' });
  assert.equal(matchGuess(book, 'Portland, Mane'), null, 'regions are never corrected');
});

test('a real smaller place typed exactly is never corrected into a listed city', () => {
  const book = buildBook([city('Bremen', 560_000), city('Altendorf', 6_000)], [], ['Altdorf', 'Bremke']);
  assert.deepEqual(matchGuess(book, 'Altdorf'), { kind: 'small', name: 'Altdorf' });
  assert.deepEqual(matchGuess(book, 'BREMKE'), { kind: 'small', name: 'Bremke' });
  assert.equal(matchGuess(book, 'Altendorf')?.kind, 'exact');
  // A listed name is never shadowed by a smaller place of the same name.
  assert.equal(buildBook([city('Bremen', 560_000)], [], ['Bremen']).small.size, 0);
});

test('a typo of a city already found is a repeat, never a second score', () => {
  const t = city('Toronto', 2_794_356), book = buildBook([t]);
  let r = newRush('CAN', 'v', 'timed', 0);
  const id = (g: string) => { const m = matchGuess(book, g); return m && (m.kind === 'exact' || m.kind === 'typo') ? m.id : null; };
  r = guessRush(r, 'Toronto', id('Toronto'), 1).rush;
  assert.equal(guessRush(r, 'Tornto', id('Tornto'), 2).outcome, 'duplicate');
  assert.equal(guessRush(r, 'TORONTO', id('TORONTO'), 3).outcome, 'duplicate');
  assert.deepEqual(r.found, [t.id]);
  assert.equal(typoKeys(book, 'tornto').length, 1);
});

// ---- Sprint A regressions -----------------------------------------------------------------------------------------------------
test('a region whose name starts with "The" can be typed with or without it', () => {
  const lazio = city('Villanova', 9_000, [], 0), marche = city('Villanova', 1_500, [], 1);
  const book = buildBook([lazio, marche], [['Lazio'], ['The Marches', 'Marche']]);
  for (const g of ['Villanova, The Marches', 'Villanova the marches', 'Villanova, Marches', 'Villanova Marche']) assert.equal(findCity(book, g)?.id, marche.id, g);
  assert.equal(matchGuess(book, 'Vilanova, The Marches')?.kind, 'typo', 'a typo in the name, "The" in the region');
  assert.equal(findCity(book, 'Villanova')?.id, lazio.id);
});

test('a city only a nameless region could single out is not counted in the total (no guess reaches it)', () => {
  const big = city('Libertad', 20_000, [], 0), small = city('Libertad', 5_210, [], 1);
  const book = buildBook([big, small], [['Cagayan'], ['']]);
  assert.deepEqual([...book.reachable], [big.id]);
  assert.equal(book.total, 20_000);
  // With a region name it is reachable as before.
  const named = buildBook([big, small], [['Cagayan'], ['Bohol']]);
  assert.equal(named.reachable.size, 2);
});

test('a bare name finds every city of that name at once: one per region, largest first; a region narrows it to one', () => {
  const il = city('Springfield', 114_000, [], 0), ma = city('Springfield', 155_000, [], 1), mo = city('Springfield', 169_000, [], 2);
  const ilSmall = city('Springfield', 3_000, [], 0);   // a second, smaller one in Illinois: not in the total
  const other = city('Chicago', 2_700_000, [], 0);
  const book = buildBook([il, ma, mo, ilSmall, other], [['Illinois', 'IL'], ['Massachusetts', 'MA'], ['Missouri', 'MO']]);
  const all = matchGuess(book, 'springfield');
  assert.deepEqual(all, { kind: 'exact', id: mo.id, ids: [mo.id, ma.id, il.id], qualified: false });
  assert.ok(!book.reachable.has(ilSmall.id));
  assert.deepEqual(matchGuess(book, 'Springfield, Illinois'), { kind: 'exact', id: il.id, ids: [il.id], qualified: true });
  assert.deepEqual((matchGuess(book, 'Sprinfield') as { ids: string[] }).ids, [mo.id, ma.id, il.id], 'a typo finds them all too');
  // Played: one guess adds all three, with all their people; repeating it adds nothing.
  let r = newRush('USA', 'v', 'timed', 0);
  r = guessRush(r, 'Springfield, Illinois', [il.id], 1).rush;
  const o = guessRush(r, 'Springfield', (all as { ids: string[] }).ids, 2);
  assert.equal(o.outcome, 'new');
  assert.deepEqual(o.rush.found, [il.id, mo.id, ma.id], 'the one already found is not added twice');
  assert.equal(awards(book, o.rush.found).reduce((a, b) => a + b, 0), 114_000 + 169_000 + 155_000);
  assert.equal(o.rush.foundAt.length, 3);
  assert.equal(guessRush(o.rush, 'Springfield', (all as { ids: string[] }).ids, 3).outcome, 'duplicate');
  // Coverage can never pass 100%: everything a name can add is in the total.
  const every = [...book.names.keys()].flatMap(k => (matchGuess(book, k) as { ids: string[] }).ids);
  assert.equal(awards(book, [...new Set(every)]).reduce((a, b) => a + b, 0), book.total);
});
