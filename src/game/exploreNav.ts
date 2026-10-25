// Where the player is in Explore: the world, a country, or a country's regions (first-level subdivisions), with one
// region selected or none. Every move between them is a pure function, so navigation is tested without a browser and the
// app only applies the result (loading data and moving the camera). See docs/subdivisions.md, Phase 4.
export type ExploreNav = {
  country: string | null;                                // the country opened in Explore (roster id)
  regions: { country: string; unit: string | null } | null;   // its regions view, when open
};
export const WORLD: ExploreNav = { country: null, regions: null };

// A click on a country on the globe. In a regions view a click on another country leaves it and opens that country;
// a click on the same country (outside its regions, e.g. a gap) changes nothing.
export function clickCountry(n: ExploreNav, id: string): ExploreNav {
  if (n.regions?.country === id) return n;
  return { country: id, regions: null };
}

// A click on the ocean or on land that is not a country. In a regions view it clears the selected region and stays;
// otherwise it closes the country.
export function clickNothing(n: ExploreNav): ExploreNav {
  return n.regions ? { ...n, regions: { ...n.regions, unit: null } } : WORLD;
}

// Opens a country's regions (from its panel, or after a round). The country stays selected.
export const openRegions = (_n: ExploreNav, country: string): ExploreNav => ({ country, regions: { country, unit: null } });

// A click on a region (on the globe or in the list): selects it, or clears it when it is already selected from the list.
export function selectRegion(n: ExploreNav, unit: string | null, toggle = false): ExploreNav {
  if (!n.regions) return n;
  return { ...n, regions: { ...n.regions, unit: toggle && n.regions.unit === unit ? null : unit } };
}

// Back from the regions view to the country's panel.
export const backToCountry = (n: ExploreNav): ExploreNav => ({ country: n.regions?.country ?? n.country, regions: null });

// To the world view: nothing selected.
export const toWorld = (_n: ExploreNav): ExploreNav => WORLD;

// Leaving a regions round (× or "Back to …" on the results): back to that country's regions in Explore.
export const afterRound = (country: string): ExploreNav => ({ country, regions: { country, unit: null } });

// Whether a country can show regions: it has data, and the data is enabled (development builds show the rest too).
export const hasRegions = (index: { countries: { [id: string]: { enabled: boolean } } } | null, id: string, dev = false) =>
  !!index?.countries[id] && (index.countries[id].enabled || dev);
