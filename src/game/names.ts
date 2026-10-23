import type { RosterEntry } from '../data/roster';

// Folds the ways people type a country name into one form: accents, case, "St." vs "Saint", "&", leading "The", punctuation.
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'saint').replace(/^the /, '').trim();
}

export function nameMatches(entry: RosterEntry, guess: string): boolean {
  const g = normalize(guess);
  return !!g && [entry.name, ...entry.aliases].some(n => normalize(n) === g);
}
