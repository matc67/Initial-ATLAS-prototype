// Anything a round can ask for: a country, or a first-level subdivision. The HUD, name matching, results and review only
// need these fields, so the same round, scoring and records serve both. A Country already is one (flags via `iso2`).
import type { LngLat } from './geo';

export type Playable = {
  id: string;
  name: string;
  aliases: string[];
  center: LngLat;                                  // a point on its land
  iso2?: string;                                   // countries: the flag
  frame?: { center: LngLat; radiusKm: number };   // subdivisions: where to look to see all of it
};
