import type { RosterEntry } from '../data/roster';

// Folds the ways people type a country name into one form: accents, case, "St." vs "Saint", "&", leading "The", punctuation.
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'saint').replace(/^the /, '').trim();
}

// Any named place: a country, or a subdivision (whose aliases come from its reviewed profile).
export function nameMatches(entry: Pick<RosterEntry, 'name' | 'aliases'>, guess: string): boolean {
  const g = normalize(guess);
  return !!g && [entry.name, ...entry.aliases].some(n => normalize(n) === g);
}

// Name every city (a future mode): the cities whose name or an alias matches the guess. Only the cities passed in are
// searched, so a guess is always read in its context: "Victoria" typed in a Canada challenge never matches the capital of
// Seychelles. More than one result means the name is ambiguous within that context, and the caller must not pick one.
export function matchCities<C extends { name: string; aliases: string[] }>(guess: string, cities: C[]): C[] {
  const g = normalize(guess);
  return g ? cities.filter(c => [c.name, ...c.aliases].some(n => normalize(n) === g)) : [];
}
