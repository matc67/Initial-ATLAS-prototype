// Capitals and major cities per country, built by `npm run places` from Natural Earth. Fetched the first time a country is
// opened in Explore, so the World game never waits for it.
import type { LngLat } from '../game/geo';

// `id` is stable across rebuilds: Natural Earth's own ne_id. `capital` is true, or the capital's role where a country has
// several ("executive", "legislative"…). `admin1` is the first-level division's name as Natural Earth spells it.
export type City = { id: string; name: string; aliases: string[]; country: string; admin1: string; lng: number; lat: number; population: number; capital?: true | string };
export type CountryPlaces = { cities: City[]; note?: string };
export type PlacesFile = { source: { name: string; url: string; commit: string; licence: string }; countries: { [countryId: string]: CountryPlaces } };

let pending: Promise<PlacesFile> | null = null;
export function loadPlaces(): Promise<PlacesFile> {
  pending ??= fetch(`${import.meta.env.BASE_URL}data/places.json`).then(res => {
    if (!res.ok) throw new Error(`Could not load places.json (${res.status}).`);
    return res.json();
  });
  // A failed load can be retried on the next country.
  pending.catch(() => { pending = null; });
  return pending;
}

export const capitalsOf = (p: CountryPlaces | undefined) => p?.cities.filter(c => c.capital) ?? [];
export const lngLat = (c: City): LngLat => [c.lng, c.lat];
