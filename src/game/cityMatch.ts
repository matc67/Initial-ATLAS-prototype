// City Rush name matching and what counts toward the score. Pure: no map, no React, no storage. The build script
// (scripts/build-cities.ts) and the game both use it, so what the data keeps, what a guess accepts and what the
// population total is are decided by the same rules.
//
// A guess is read only against the cities of the country being played, never the world's. There is no fuzzy matching:
// case, accents, punctuation, "St."/"Saint", "Mt."/"Mount" and "Ft."/"Fort" are forgiven, and anything else must be the
// name, the ASCII form, or a reviewed alias (English, or one of the country's own languages, from GeoNames).
import { normalize } from './names.ts';
import { versionOf } from './challenges.ts';

// Letters that Unicode does not split into a base letter and an accent, so normalize() would drop them (Tromsø → "troms").
const FOLD: { [ch: string]: string } = {
  ø: 'o', Ø: 'o', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ß: 'ss', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', ð: 'd', Ð: 'd',
  þ: 'th', Þ: 'th', ı: 'i', ħ: 'h', Ħ: 'h', ŧ: 't', ĸ: 'k', ŀ: 'l', Ŀ: 'l', ʻ: '', ʼ: '', '‘': '',
};

// The form every name and guess is compared in: "Saint-Jean-sur-Richelieu" and "st jean sur richelieu" are the same.
export function foldCity(s: string): string {
  return normalize(s.replace(/[øØæÆœŒßłŁđĐðÐþÞıħĦŧĸŀĿʻʼ‘]/g, ch => FOLD[ch] ?? ch))
    .replace(/\bste\b/g, 'sainte').replace(/\bmt\b/g, 'mount').replace(/\bft\b/g, 'fort');
}

// One city as the game sees it. `id` is "gn:<geonameid>", stable across data rebuilds. `region` indexes the country's
// first-level divisions (`admin1` is its name). `partOf` is the city this one lies inside, when GeoNames lists both and
// the larger one's population already includes it (Brooklyn in New York City): see `awards`.
export type RushCity = {
  id: string; name: string; aliases: string[]; lng: number; lat: number; population: number;
  admin1: string; region: number; partOf: string | null;
};

// Everything a guess can find in one country.
//   names     folded name → city ids, largest first. A city's own name lists every city of that name; an alias, exactly one.
//   regions   folded region name or abbreviation → region indexes ("maine", "me" → Maine)
//   reachable the cities some guess can claim (see findCity), the only ones that count toward the total
//   parts     a city → the cities listed inside it
//   total     the population a player can claim: every reachable city's, except the parts (their people are in their
//             city's figure) and cities with no population recorded
//   small     folded names of real smaller places (GeoNames cities1000, not on the list) that are one typo away from a
//             listed name: typed exactly, they are never corrected into a listed city (see matchGuess)
export type CityBook = {
  cities: Map<string, RushCity>;
  names: Map<string, string[]>;
  regions: Map<string, Set<number>>;
  reachable: Set<string>;
  parts: Map<string, string[]>;
  total: number;
  small: Map<string, string>;
};

// Builds the book for one country. Name rules, in order:
//   1. A city's own name is always accepted.
//   2. An alias that is any city's own name is dropped: "Paris" never finds anything but Paris.
//   3. An alias claimed by several cities goes to the largest only when it dwarfs the rest (DOMINANT times the next
//      largest: "Frankfurt" is Frankfurt am Main, not Frankfurt an der Oder). Otherwise it is ambiguous and dropped for
//      all of them, rather than guessed.
// `regionNames` lists, per region index, the names it can be typed as (its own name first).
export const DOMINANT = 10;
export function buildBook(cities: RushCity[], regionNames: string[][] = [], smallPlaces: string[] = []): CityBook {
  const byId = new Map<string, RushCity>(), names = new Map<string, string[]>();
  const sorted = [...cities].sort((a, b) => b.population - a.population || idNum(a.id) - idNum(b.id));
  for (const c of sorted) {
    byId.set(c.id, c);
    const k = foldCity(c.name);
    if (k) names.set(k, [...(names.get(k) ?? []), c.id]);
  }
  const claims = new Map<string, string[]>();
  for (const c of sorted) {
    const own = foldCity(c.name), seen = new Set<string>();
    for (const a of c.aliases) {
      const k = foldCity(a);
      if (!k || k === own || names.has(k) || seen.has(k)) continue;
      seen.add(k);
      claims.set(k, [...(claims.get(k) ?? []), c.id]);
    }
  }
  for (const [k, ids] of claims) {
    const [first, second] = ids.map(id => byId.get(id)!);  // already largest first
    if (!second || first.population >= DOMINANT * Math.max(1, second.population)) names.set(k, [first.id]);
  }

  const regions = new Map<string, Set<number>>();
  regionNames.forEach((forms, i) => { for (const f of forms) { const k = foldCity(f); if (k) regions.set(k, (regions.get(k) ?? new Set()).add(i)); } });

  // Reachable: the city a name finds on its own, and the largest of that name in each region ("Portland, Maine").
  const reachable = new Set<string>();
  for (const ids of names.values()) {
    reachable.add(ids[0]);
    const firstIn = new Set<number>();
    for (const id of ids) { const r = byId.get(id)!.region; if (!firstIn.has(r)) { firstIn.add(r); reachable.add(id); } }
  }
  const parts = new Map<string, string[]>();
  for (const c of sorted) if (c.partOf && byId.has(c.partOf)) parts.set(c.partOf, [...(parts.get(c.partOf) ?? []), c.id]);
  let total = 0;
  for (const id of reachable) { const c = byId.get(id)!; if (!(c.partOf && byId.has(c.partOf))) total += Math.max(0, c.population); }
  const small = new Map<string, string>();
  for (const name of smallPlaces) { const k = foldCity(name); if (k && !names.has(k) && !small.has(k)) small.set(k, name); }
  return { cities: byId, names, regions, reachable, parts, total, small };
}
const idNum = (id: string) => Number(id.slice(3)) || 0;

// What a guess finds: one city, and whether a region narrowed it. Deterministic, so the same words always mean the same
// city whatever has been found already:
//   "Portland"          the largest city of that name (Portland, Oregon)
//   "Portland, Maine"   the largest of that name in that region; "Portland ME" and "Portland (Maine)" too
// A whole name always wins over a name plus region, so a city whose name ends in a region's name is still found.
export type CityMatch = { id: string; qualified: boolean };
export function findCity(book: CityBook, guess: string): CityMatch | null {
  const k = foldCity(guess);
  if (!k) return null;
  const whole = book.names.get(k);
  if (whole) return { id: whole[0], qualified: false };
  const words = k.split(' ');
  for (let i = words.length - 1; i >= 1; i--) {
    const ids = book.names.get(words.slice(0, i).join(' ')), rs = book.regions.get(words.slice(i).join(' '));
    if (!ids || !rs) continue;
    const id = ids.find(x => rs.has(book.cities.get(x)!.region));
    if (id) return { id, qualified: true };
  }
  return null;
}

// ---- Typos -------------------------------------------------------------------------------------------------------------
// Only when nothing matches exactly. One edit, on folded strings (case, accents and spacing already forgiven), measured
// against the listed name it would correct to:
//   an inserted, missing or swapped pair of neighbouring characters   names of TYPO_MIN letters or more  ("Tornto")
//   one character replaced by another                                 names of TYPO_SUB_MIN or more      ("Vancouvar")
// Short names are never corrected: Rome, Lima and York differ from other real places by a letter.
export const TYPO_MIN = 6, TYPO_SUB_MIN = 8;
const letters = (k: string) => k.replace(/ /g, '').length;

// Whether b is one edit from a (a ≠ b): 'sub' (replace), 'gap' (insert, delete, or swap neighbours), or null.
export function oneEdit(a: string, b: string): 'sub' | 'gap' | null {
  if (a === b || Math.abs(a.length - b.length) > 1) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return 'sub';
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2) ? 'gap' : null;
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i) ? 'gap' : null;
}

// The book's names grouped by length, built once per book, so a guess is compared only with names of nearly its length.
const byLength = new WeakMap<CityBook, Map<number, string[]>>();
function namesNear(book: CityBook, len: number): string[] {
  let m = byLength.get(book);
  if (!m) {
    m = new Map();
    for (const k of book.names.keys()) m.set(k.length, [...(m.get(k.length) ?? []), k]);
    byLength.set(book, m);
  }
  return [...(m.get(len - 1) ?? []), ...(m.get(len) ?? []), ...(m.get(len + 1) ?? [])];
}
// Listed names a folded guess could be a typo of, under the rules above.
export function typoKeys(book: CityBook, g: string): string[] {
  return namesNear(book, g.length).filter(k => {
    const e = oneEdit(g, k), n = letters(k);
    return e === 'gap' ? n >= TYPO_MIN : e === 'sub' ? n >= TYPO_SUB_MIN : false;
  });
}

// What a typed guess means, in order:
//   exact       the name or an alias, whole ("Portland"), else name plus region ("Portland, Maine"): findCity
//   small       typed exactly as a real smaller place not on the list: never corrected into a listed city
//   typo        one typo from exactly one city, resolved like the name it corrects to (a shared name means the largest;
//               with a region, the largest in that region). `as` is the name it was read as.
//   ambiguous   one typo from more than one city: nothing is awarded
export type GuessMatch =
  | { kind: 'exact'; id: string; qualified: boolean }
  | { kind: 'typo'; id: string; qualified: boolean; as: string }
  | { kind: 'ambiguous' }
  | { kind: 'small'; name: string };
export function matchGuess(book: CityBook, guess: string): GuessMatch | null {
  const exact = findCity(book, guess);
  if (exact) return { kind: 'exact', ...exact };
  const k = foldCity(guess);
  if (!k) return null;
  const splits = k.split(' ').map((_, i, w) => ({ name: w.slice(0, i).join(' '), rs: book.regions.get(w.slice(i).join(' ')) }))
    .filter((x): x is { name: string; rs: Set<number> } => !!x.name && !!x.rs).reverse();
  const smallName = book.small.get(k) ?? splits.map(x => book.small.get(x.name)).find(Boolean);
  if (smallName) return { kind: 'small', name: smallName };
  const resolve = (keys: string[], rs?: Set<number>) => new Map(keys.flatMap(key => {
    const ids = book.names.get(key)!, id = rs ? ids.find(x => rs.has(book.cities.get(x)!.region)) : ids[0];
    return id ? [[id, key] as const] : [];
  }));
  const decide = (hits: Map<string, string>, qualified: boolean): GuessMatch | null => {
    if (hits.size > 1) return { kind: 'ambiguous' };
    const [hit] = [...hits];
    return hit ? { kind: 'typo', id: hit[0], qualified, as: book.cities.get(hit[0])!.name } : null;
  };
  const whole = decide(resolve(typoKeys(book, k)), false);
  if (whole) return whole;
  for (const { name, rs } of splits) {
    const m = decide(resolve(typoKeys(book, name), rs), true);
    if (m) return m;
  }
  return null;
}

// How many cities share a city's name (1 for most).
export const namesakes = (book: CityBook, c: RushCity) => book.names.get(foldCity(c.name))?.length ?? 1;

// The people each city found adds, in the order found. A city and the parts listed inside it never add up to more than
// the city's own population, in either order:
//   Brooklyn first, then New York City:  Brooklyn's 2.7M, then the rest of New York City's 8.8M
//   New York City first, then Brooklyn:  8.8M, then 0 (already counted)
// A part never adds more than its city has left, even where GeoNames' figures for the parts sum to more than the city's.
export function awards(book: CityBook, found: string[]): number[] {
  const family = new Map<string, number>();
  return found.map(id => {
    const c = book.cities.get(id);
    if (!c) return 0;
    const parent = c.partOf ? book.cities.get(c.partOf) : undefined;
    if (parent) {
      const so = family.get(parent.id) ?? 0, a = Math.min(Math.max(0, c.population), Math.max(0, parent.population - so));
      family.set(parent.id, so + a);
      return a;
    }
    if (book.parts.has(id)) {
      const a = Math.max(0, c.population - (family.get(id) ?? 0));
      family.set(id, Math.max(0, c.population));
      return a;
    }
    return Math.max(0, c.population);
  });
}

// The version of a country's data: every reachable city with its population and the city it is part of. Records and
// saved progress key on it, so a rebuild that changes what can be scored starts them fresh.
export const bookVersion = (book: CityBook) =>
  versionOf([...book.reachable].map(id => { const c = book.cities.get(id)!; return `${id}:${c.population}:${c.partOf ?? ''}`; }));

// The aliases of a city that survive the rules above, for the build script to keep (and nothing else, to keep files small).
export function keptAliases(book: CityBook, c: RushCity): string[] {
  const seen = new Set<string>([foldCity(c.name)]);
  return c.aliases.filter(a => {
    const k = foldCity(a), ids = book.names.get(k);
    if (!k || seen.has(k) || !ids || ids.length !== 1 || ids[0] !== c.id) return false;
    seen.add(k);
    return true;
  });
}
