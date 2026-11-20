// City Rush data: one file per country (public/data/cities/<ID>.json) and a small index of which countries have enough
// cities to play, built by `npm run cities` from GeoNames (CC BY 4.0). Nothing loads until City Rush is opened, and a
// country's file loads only when that country is chosen. See docs/cities.md.
import type { LngLat } from '../game/geo';
import { buildBook, type CityBook, type RushCity } from '../game/cityMatch.ts';

// A compact row per city, largest first: GeoNames id, name, longitude, latitude, population (0 when GeoNames has none),
// index into `admin1`, the reviewed aliases (absent when there are none and the city is no part; [] when it is a part), and
// the GeoNames id of the city it lies inside, when GeoNames lists both (Brooklyn in New York City).
export type CityRow = [id: number, name: string, lng: number, lat: number, population: number, admin1: number, aliases?: string[], partOf?: number];
export type CityFile = {
  country: string;                 // roster id
  version: string;                 // fingerprint of what can be scored (cityMatch.bookVersion): records key on it
  frame: { center: LngLat; radiusKm: number };  // where to look to see the whole country
  admin1: string[];                // first-level divisions, by index
  regions: string[][];             // other names each division can be typed as ("ME" for Maine), by the same index
  population: number;              // the people a player can claim (cityMatch.CityBook.total), for checking
  // Real smaller places (GeoNames cities1000, not on the list) one typo away from a listed name: typed exactly, they are
  // never corrected into a listed city. Only those, so the file stays small; they never score.
  nearby?: string[];
  cities: CityRow[];
};
// `findable`: the cities a guess can claim; `population`: their people, the denominator of City Population Coverage.
export type CityIndexEntry = { cities: number; findable: number; population: number; version: string; playable: boolean };
export type CityIndex = {
  source: {
    name: string; url: string; licence: string; attribution: string;
    dataDate: string;            // when the GeoNames files were downloaded (the newest), YYYY-MM-DD
    // Each input: its size and SHA-256 (the alternate names: the SHA-256 of the rows the build reads), and when it was
    // published and downloaded. `npm run cities -- --verify` checks a rebuild against these.
    inputs: { file: string; bytes: number | null; sha256: string | null; rowsSha256?: string; lastModified: string | null; downloadedAt: string }[];
    generator: string;           // SHA-256 of the build script and the matching rules it uses
  };
  minPopulation: number;           // the dataset's own threshold: "places with at least 1,000 people"
  minNames: number;                // a country needs this many findable cities to be playable
  countries: { [countryId: string]: CityIndexEntry };
};

export const cityRow = (r: CityRow, admin1: string[]): RushCity => ({
  id: `gn:${r[0]}`, name: r[1], lng: r[2], lat: r[3], population: r[4], admin1: admin1[r[5]] ?? '', region: r[5],
  aliases: r[6] ?? [], partOf: r[7] ? `gn:${r[7]}` : null,
});
export const citiesOf = (f: CityFile): RushCity[] => f.cities.map(r => cityRow(r, f.admin1));
// Each division's typeable names: its own name, then the others.
export const regionNamesOf = (f: Pick<CityFile, 'admin1' | 'regions'>): string[][] => f.admin1.map((n, i) => [n, ...(f.regions?.[i] ?? [])]);
export const bookOf = (f: CityFile): CityBook => buildBook(citiesOf(f), regionNamesOf(f), f.nearby ?? []);

const base = () => import.meta.env?.BASE_URL ?? '/';
function fetchJson<T>(path: string): Promise<T> {
  return fetch(`${base()}${path}`).then(res => {
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status}).`);
    return res.json() as Promise<T>;
  });
}

// One promise per file, so reopening a country is instant. A failed load is forgotten, so it can be retried.
let index: Promise<CityIndex> | null = null;
const files = new Map<string, Promise<CityFile>>();
export function loadCityIndex(): Promise<CityIndex> {
  index ??= fetchJson<CityIndex>('data/cities/index.json');
  index.catch(() => { index = null; });
  return index;
}
export function loadCityFile(countryId: string): Promise<CityFile> {
  let p = files.get(countryId);
  if (!p) {
    p = fetchJson<CityFile>(`data/cities/${countryId}.json`);
    files.set(countryId, p);
    p.catch(() => files.delete(countryId));
  }
  return p;
}
