# Geography data and the road to provinces and cities

> **Subdivisions:** the dataset choice and plan for first-level divisions are now in [subdivisions.md](subdivisions.md), which supersedes the subdivision parts of this page. In particular, geoBoundaries ADM1 is not uniformly CC BY 4.0 (licences vary per country), and ATLAS uses Natural Earth Admin-1 instead.

How ATLAS stores places today, what is reusable, and how first-level divisions (states, provinces, prefectures…) and cities plug into the game without slowing the World game down.

## What exists today

| Piece | Where | Notes |
|---|---|---|
| Country borders | `public/data/countries.topo.json` (≈ 2.3 MB), built by `npm run data` | Natural Earth Admin 0 1:10m, pinned to commit `ca96624`, public domain. TopoJSON, so each shared border is stored once and simplified once. |
| Island halos, tiny-country rings | `halos.geojson`, `markers.geojson` | Derived from the same borders. |
| Relief | `relief.webp`, built by `npm run relief` | Natural Earth GRAY_50M_SR. |
| Roster (the 200 countries) | `src/data/roster.ts` | Hand-curated. `id` = Natural Earth ADM0_A3 (ISO alpha-3, except PSX and SDS). |
| Capitals and major cities | `public/data/places.json` (≈ 165 KB, ≈ 40 KB gzipped), built by `npm run places` | Natural Earth Populated Places 1:10m at the same commit. Capitals use Natural Earth's `adm0cap` flag, with a short, commented list of corrections in `scripts/build-places.ts` (multiple capitals, Dodoma, disputed cases). Fetched only when a country is opened in Explore. |
| Map rendering and hit-testing | `src/map/GlobeView.ts` | One GeoJSON source per layer kind, `promoteId: 'id'`. Colours come from feature-state (`status`, `act`, `dim`, `focus`), so changing what is shown never rebuilds tiles. Clicks use `queryRenderedFeatures` on the ring, halo and country layers, in that order. |
| Rules of a round | `src/game/scoring.ts` | Pure. Works on plain string ids. |
| Challenges | `src/game/challenges.ts` | `GeographyChallenge`: id, entity type, scope, interaction, target ids, version. |
| Runs and records | `src/game/records.ts` | `GameRun` (per-country results) and `Performance` (personal records), keyed by challenge id and version. |
| Entity hierarchy | `src/data/entities.ts` | World → continent → country → admin1 → city, with namespaced, stable ids. |

Attribution is shown in the app footer (Natural Earth, flag-icons). Natural Earth is public domain; flag-icons is MIT.

**Not available yet:** a city list beyond capitals and about six major cities per country. First-level divisions now exist for ten countries (see [subdivisions.md](subdivisions.md)).

Each country's label point (`lx`, `ly`) is always on its own land: where Natural Earth's falls in the sea (Equatorial Guinea, New Zealand, Trinidad and Tobago and a few archipelagos), `npm run data` moves it onto the largest island. The camera, answer pulses and Mystery Country look at it.

## How the globe draws land

MapLibre's globe draws every layer from Web Mercator vector tiles built in the browser from the GeoJSON sources. geojson-vt simplifies each tile for its zoom, which is the level-of-detail system: distant views get light geometry, close views get the full 1:10m detail. Nothing is reprocessed per frame.

- **Fills** (`country-base`, `country-active`) come from `countries`. A WebGL fill only covers pixels whose centre lies inside the shape, so an island smaller than a pixel draws nothing.
- **Islet traces** (`land-edge-*`) come from `islets`: the outer coastline of every island under 3,000 km², drawn as a line in the land's own colour. A line is always at least about 1 px wide, so every island in the data shows as land in the right colour and takes clicks. That's about 21% of coastline points.
- **Borders** (`country-line`) come from `outlines`: the shapes' rings without the cuts Natural Earth makes along 180° and the pole (`src/map/outlines.ts`).
- **Relief** is a Web Mercator image, shaded against the land around each pixel only (a masked, normalised blur), wrapped east–west and cut to the land outline (`scripts/build-relief.ts`).
- **Click areas** are separate from what is drawn: ring markers for tiny countries and invisible halos around island countries (`src/map/pick.ts`). Neither is ever drawn as land.
- **Poles:** tiles end at ±85.05°. The globe fills the polar caps from shapes touching that edge, so no coastline may cross it (`clampToMercator` in `scripts/build-countries.ts`).

## Entity ids

```
world
continent:north-america
country:CAN                      (roster id = map feature id)
admin1:CAN:<source id>           (from the boundary dataset, never from a name)
city:ne:1159151299               (Natural Earth ne_id)
```

City names are not unique (London, Ontario; Victoria, Seychelles and British Columbia; Córdoba, Spain and Argentina), so every lookup goes through an id and a context: a challenge only ever searches the cities of its own scope (`matchCities` in `src/game/names.ts`). More than one match inside a scope is ambiguous and must not be guessed.

## What stays the same for every new challenge

The round engine (`scoring.ts`), records (`records.ts`), the HUD, timer, streaks, results screen and Progress dashboard already work on any list of ids. A new challenge needs:

1. **Targets**: a `GeographyChallenge` with `entityType`, `scopeId`, `interaction` and `targetIds`. Its `version` is computed from the ids, so records stay comparable only between identical lists.
2. **A map layer** for its geometry (polygons for divisions, points for cities), with the same feature-state statuses (`found`, `missed`, `first`, `retry`, `hinted`…), so Play and Progress colour it without new logic.
3. **Hit-testing** for its interaction:
   - `map-click` on polygons: the existing pick logic, pointed at the division layer.
   - `point-click` (cities): the nearest target within a tolerance in pixels on screen (about 18 px), not in km, so it feels the same at every zoom. The tolerance lives on the challenge.
   - `text-entry`: `normalize` plus aliases, matched only within the challenge's scope.
4. **Names**: division and city aliases from the dataset (ASCII forms, local names).

## Administrative terminology

Never assume "states" or "provinces". `AdminTerms` in `entities.ts` carries the singular and plural, plus mixed kinds where a country has more than one (Canada: provinces and territories; Australia: states and territories; India: states and union territories). It is filled from the boundary dataset's own type field per country and reviewed by hand. No country shows a division count or term until that data is in.

## Recommended data sources

| Need | Source | Licence | Why |
|---|---|---|---|
| First-level divisions (states, provinces…) | **geoBoundaries ADM1** (gbOpen) | CC BY 4.0, attribution required | Per-country files, so Canada can load without the world. Stable `shapeID`s, ISO codes, maintained by William & Mary. |
| Fallback / world overview of divisions | Natural Earth Admin 1 (1:10m) | Public domain | One file and the same pipeline as the borders, but uneven granularity: the UK has about 230 units, France has departments. Fine for an overview, not as the source of truth. |
| Division names and types | geoBoundaries metadata + Wikidata (P31 "instance of", P300 ISO 3166-2) | CC0 (Wikidata) | Localised terms, ISO 3166-2 codes for stable joins. |
| Cities | **GeoNames** `cities15000` (or `cities5000`) | CC BY 4.0 | Stable `geonameid`, alternate names, `admin1` codes, population, feature class (PPLC = capital, PPLA = division capital). Filter per country at build time. |
| Capitals (cross-check) | Wikidata P36 | CC0 | Catches out-of-date flags like the Dodoma case. |

Avoid shipping any of these whole: GeoNames `allCountries` is over 1.5 GB, and full-resolution geoBoundaries for the world is several hundred MB.

## Performance plan

- **Country data stays the default load.** Nothing new is fetched until it is needed; `places.json` already loads on first use.
- **Per-country files**: `public/data/admin1/CAN.topo.json`, `public/data/cities/CAN.json`, built by script, simplified for a country-level zoom (Canada at zoom 3–5), quantised TopoJSON, typically 50–300 KB each.
- **Cache**: one in-memory promise per file (as `loadPlaces` does), so reopening a country is instant; the browser HTTP cache does the rest.
- **One source per level**: add the country's divisions to a single `admin1` source with `setData`, not one source per country, so the style never grows.
- **No re-renders of the globe**: statuses keep going through feature-state diffs (`setStatuses`), never through new layers or filters.

## Roadmap for the next geography modes

1. **Divisions data pipeline**: `scripts/build-admin1.ts` for a first set of countries (United States, Canada, Australia, India, Brazil, Japan, France, Germany, Mexico, China), with terms and aliases reviewed by hand. *Done when*: per-country files exist, every division has a stable id, and the tests check parents and counts against ISO 3166-2.
2. **Explore: divisions on the globe**: opening one of those countries fades its divisions in (feature-state `act`, as regions do today); Explore shows the real count and term ("10 provinces, 3 territories").
3. **Guess the divisions** (`canada-provinces-find`, `usa-states-find`…): reuse the round engine, HUD and records with `entityType: 'admin1'`, the camera fitted to the country, and the Explore panel's challenge list linking to it. Progress gets the same dashboard per challenge.
4. **Name the divisions**: the same targets with `text-entry`.
5. **City markers and Find the city**: GeoNames-based per-country city files and a point layer, then `point-click` with a pixel tolerance. Start with capitals (world capitals, US state capitals), where the target list is unambiguous.
6. **Name every city you know**: a new round shape. There is no queue: the player types, each matching city in scope is added, and duplicates are rejected. It reuses the clock, records and results, with "cities named" as the score. It needs `matchCities` with scope and minimum-population rules, and a clear rule for ambiguous names within one country (accept once, and mark both).
7. **Practice mistakes**: the latest run's review list is already stored in `Performance.latestRun.results`.
