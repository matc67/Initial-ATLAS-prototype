# Subdivisions: architecture and plan

First-level administrative divisions (states, provinces, territories, prefectures, regions…) for every country, played through the same globe, game engine and records as countries. This document records the decisions taken, how the data is built, and the staged plan. It supersedes the subdivision parts of [geography.md](geography.md).

**Status:** Phases 2 and 3 are approved. Phase 4 (Explore integration and Progress) is built and awaiting review: players can now open a country's regions in Explore and play Find the Region and Name the Region. Canada is the only country with region data so far.

## Decisions

Approved after the Phase 1 review (2026-10-24):

1. **Dataset: Natural Earth Admin-1 (1:10m)**, the same pinned release as the country borders, public domain. Per-country profiles, stable ATLAS-owned ids, shared borders and lazy loading as designed below.
2. **Explore is the entry point.** Selecting a country in Explore shows its subdivisions and starts Find the Region or Name the Region from the existing country panel.
3. **One globe throughout.** The same MapLibre globe moves smoothly into the country's subdivision view; leaving a challenge returns to Explore with that country still selected.
4. **Challenge sizes.** A 10-question Sprint for countries with at least 10 playable subdivisions, plus a full challenge with every subdivision. A country with fewer than 10 has only the full challenge (it is already short), never a Sprint that repeats or pads questions.
5. **Disputed boundaries are a separate, documented policy decision.** Building subdivisions never changes existing country geometry; inconsistencies are flagged for review (see [Disputed and inconsistent areas](#disputed-and-inconsistent-areas)).
6. **Staged delivery.** The data pipeline and Canada first. The gameplay engine is not refactored until the subdivision map and Explore integration work.
7. **Nothing existing changes.** Country modes, scoring, saved records and map performance are preserved. The app loads no subdivision data unless it is used.

One change from the Phase 1 proposal, required by decision 5: the proposal rebuilt `countries.topo.json` from a combined world topology. Instead, **the country file is left untouched and is the authority**: each subdivision is clipped to the country shape the globe already draws, and any land between the subdivision data and that shape is assigned to the nearest subdivision. Coasts and international borders therefore come out identical to the country map without rebuilding it.

## Why Natural Earth, not geoBoundaries

Checked against the live data on 2026-10-24.

**geoBoundaries gbOpen ADM1** (199 countries) is a patchwork. Licences vary per country: 84 use ODbL 1.0 (share-alike, with obligations on derived databases), 14 use CC share-alike licences, and the rest are spread over 12 other licences (Canada is the Open Government Licence – Canada 2.0, not CC BY 4.0 as geography.md stated). Quality varies too: India has 1 unit, Kosovo's ADM1 is its 48 municipalities, Brazil and Fiji date from 2006, and many countries come from a 2017 OpenStreetMap extract with "Unknown" unit types. Each country comes from its own survey, so coasts and borders would not match the Natural Earth country map.

**Natural Earth Admin-1 1:10m** at commit `ca96624` (the country data's commit): 4,596 units covering all 200 roster countries, one public-domain licence. Its outer edges share 99.3–100% of their vertices with the Natural Earth country shapes (Canada and Australia 100%, USA, Brazil, Indonesia and Fiji 99.9%, Morocco 98.7%). Useful fields: `ne_id` (unique), `adm1_code` (unique), `iso_3166_2`, `wikidataid`, `type_en`, `name_en`/`name_fr`/…, `postal`, `region`, `geonunit`.

Its weaknesses, and how they are handled:

| Weakness | Examples | Handling |
|---|---|---|
| Wrong level for some countries | UK 232 units, France 101 departments, Italy 110 provinces, Slovenia 193 municipalities | A profile groups rows by Natural Earth's own fields, keeping the aligned geometry: UK by `geonunit` → 4 nations; France by `region` → 13 metropolitan regions; Italy → 20 regions; Philippines → 17 regions |
| Out of date | Indonesia 33 provinces (38 today), Morocco 16 regions (12 since 2015), Kazakhstan 16 | The country stays disabled until reviewed; never invented |
| ISO codes incomplete | 188 rows without a clean ISO 3166-2 code, 60 codes used twice | ISO is used for the ATLAS code only where clean and unique; otherwise the profile assigns a code |
| Unreviewed alternate names | Canada's `name_alt` holds "Upper Canada", "Acadia" (for both New Brunswick and Nova Scotia), "New Caledonia" (British Columbia), and a mis-encoded "Yuk¢n" | Aliases come only from the reviewed profile, never straight from `name_alt` |

geoBoundaries stays useful as a cross-check of counts and names. If its geometry is ever used for a country, that country's licence must be recorded in the manifest and its terms honoured.

## Identifiers

```
admin1:CAN:ON        <kind>:<country roster id>:<code>
```

- **Code**: the ISO 3166-2 suffix where it is clean and unique within the country (CA-ON → `ON`), otherwise a code set in the profile. Never derived from a name.
- The id belongs to ATLAS, not to the source: a source update, or a change of dataset, keeps it. A real reorganisation (new provinces) gives new ids, and the challenge version changes on its own.
- Source ids are kept as a crosswalk on each unit: `ne` (Natural Earth `ne_id`s; a grouped unit lists all of them), `iso`, `wikidata`.
- The map feature id is the full entity id, used for feature-state like country ids are today.

## Data

Built by `npm run admin1` (`scripts/build-admin1.ts`) into `public/data/admin1/`. The app never fetches upstream data.

### Profiles

`src/data/admin1Profiles.ts` holds one reviewed entry per country: which Natural Earth rows belong to it (`sources`, normally the country's own ADM0_A3), optional grouping (`groupBy`), rows left out with a reason (`exclude`), the terms the country uses (`terms`), every unit's code, display name, kind, aliases and abbreviation (`units`), and `enabled`. Every source row must be listed in `units` or `exclude`, so nothing reaches the game unreviewed. This is data, not gameplay logic: no game or rendering code names a country.

### Pipeline

For each profile:

1. Validate the profile (`validateProfile`): every source row listed in `units` or `exclude`, codes unique, no name or alias shared by two units, kinds declared. The build stops on any error.
2. Read the Natural Earth rows for the profile's `sources` and group them into units.
3. Simplify the units together as one topology, so the internal borders they share stay shared (half the points kept, as for countries). Those shared borders are kept as the **internal border lines**, exact by construction.
4. Read the country's shape from the existing `public/data/countries.topo.json`, read-only.
5. Clip each unit to the country shape. Units are processed in order and each is clipped against the ones before it, so units can never overlap.
6. Assign the slivers between the units' coastline and the country's coastline (the two are simplified separately) to the nearest unit, so the units cover the country exactly.
7. Snap every point to the country file's grid, then join each unit's piece and slivers. Snapping first matters: the polygon union fails on near-coincident coastlines, and succeeds once shared edges have identical points.
8. Measure everything that does not fit: area of a unit outside the country, and land of the country covered by no unit. A disagreement larger than 1 km² **and** 0.5% of the unit is recorded as a flag in the index and printed, for review. (Two separately simplified coastlines always differ a little: up to about 0.05% for Canada's units, so that is not flagged.)
9. Colour units so that no two that touch, or that lie within 50 km of each other across water, share a colour (greedy, least-used free colour first, over the country palette's 7 classes). Touching comes from the source topology, where shared borders are exact.
10. Write one TopoJSON per country, quantised with **the country file's own transform**, so shared coastline points land on exactly the same coordinates. Write the index.

### Files

`admin1/index.json` (small; fetched the first time a subdivision view opens):

```ts
type SubdivisionIndex = {
  version: string;                       // build hash; cache-busts the per-country files
  builtAt: string;
  source: { name; url; commit; licence };
  countryData: { file: 'countries.topo.json'; sha256: string };  // the country data it was clipped to
  countries: { [countryId: string]: {
    enabled: boolean;
    file: string;                        // "admin1/CAN.topo.json"
    count: number;
    kinds: { [kind: string]: number };   // { Province: 10, Territory: 3 }
    terms: AdminTerms;                   // singular/plural, plus each kind's
    bounds: [west, south, east, north];  // east > 180 when the country crosses 180°
    flags: string[];                     // review notes from the build
  } };
};
```

`admin1/CAN.topo.json`: `objects.units`, one feature per subdivision, and `objects.borders`, the internal borders as lines. Unit properties:

```ts
type SubdivisionProps = {
  id: string;          // admin1:CAN:ON
  country: string;     // CAN
  code: string;        // ON
  name: string;        // display name in English: "Quebec"
  kind: string;        // "Province" | "Territory" (from the profile)
  aliases: string[];   // reviewed: French names, common short forms ("PEI")
  abbrev?: string;     // official abbreviation ("ON")
  label: [lng, lat];   // a point on the unit's land
  km2: number;
  frame: { center: [lng, lat]; radiusKm: number };   // where to look to see the whole unit
  color: number;       // 1–7, never shared with a neighbour
  src: { ne: number[]; iso?: string; wikidata?: string };
};
```

Internal borders are stored as lines (`objects.borders`) from step 3, not derived from the clipped units: clipping can add a point to one side of a border and not the other, after which the two sides no longer share an arc. Coasts and international borders keep coming from the country layer.

### Sizes

Measured for Canada: 13 units, 448 KB on disk, 148 KB gzipped, about 49,000 points (the country's own coastline is 32,600 of them). A test keeps every per-country file under 512 KB. The build takes about 30 s for Canada. The full Natural Earth file is 40.7 MB and 1.3 million points, which is why the app never loads it.

Where the gap between the two coastlines is thinner than one grid cell (about 50–100 m), its sliver vanishes when snapped and the source coastline is kept instead. That is why the file has about 15,000 points more than the country's coastline. They lie within about 100 m of the drawn coast, below one pixel even at the globe's maximum zoom.

## On the map

`GlobeView` gets a generic subdivision layer, with nothing Canada-specific in it:

- Sources: `sub-units` (`promoteId: 'id'`), `sub-borders` (internal borders) and `sub-islets` (coastline traces of small islands, like the country `land-edge` layers, so every Nunavut islet shows and takes clicks). Layers: `sub-fill`, `sub-edge`, `sub-border`, and `sub-outline` (the hovered or selected unit's outline, drawn from `sub-units`).
- Empty unless a subdivision view is open; one country at a time, replaced with `setData`, so the style never grows and memory stays bounded.
- Fills sit above the country fill and below the relief, so the globe keeps its look. Internal borders sit below the country borders; coasts and international borders are the existing ones.
- Hover and selection use feature-state, like countries.
- Clicks: with a subdivision view open, the subdivision layers are queried first; a click on one of its units is that unit, otherwise the click falls through to the existing country logic. Every point of the country belongs to exactly one unit, so a click on land near a border goes to the unit whose land is under the pointer, with no tolerance or guessing.
- Taps on water: units within the click reach (the same 14 px as country rings, 22 px on touch screens) are considered, so a unit only a few pixels wide can still be tapped. One unit in reach is that unit; several are reported and the map zooms in, never guessed. Over another country's land, a nearby unit never takes the click.
- Camera: the view fits the country's `bounds` with the current padding (`cameraForBounds`). Bounds are computed at build time from the widest gap in longitude, so countries across 180° (Russia, Fiji, Kiribati, the United States with the Aleutians) frame correctly.
- Other countries are dimmed while a subdivision view is open.

`src/data/subdivisions.ts` loads the index and per-country files on demand (one cached promise each, retried after a failure, like `loadPlaces`) and decodes them. Nothing loads until a subdivision view opens.

**Entry point:** Explore's country panel (Phase 4, below). The URL `#subdivisions=CAN` opens a country's regions view in development builds only.

## Edge cases

| Case | Handling |
|---|---|
| Multipolygons and islands | A unit is one feature however many parts it has (Nunavut has over 200 islands). Islands under 3,000 km² get coastline traces, so even islets smaller than a pixel show and take clicks. |
| 180° | Bounds by largest longitude gap; seam cuts are removed from borders by the existing `borderRuns`; distances use unit vectors (as in Mystery Country). Chukotka and Fiji's Northern Division touch 180° in the source. |
| Very small subdivisions | Decided in screen pixels at the country's framing, not km². Below the threshold a unit needs a ring marker and the existing `resolvePick` rules; that is built when the first such country is added (Washington, DC, Berlin, Bremen, Basel-Stadt). Canada needs none on desktop (Prince Edward Island, the smallest at 5,700 km², is clickable at the default framing). On a phone, all of Canada fits only at zoom 1, where PEI is about one pixel; the tap reach over water and pinch-zoom cover it, and Phase 3 should reconsider rings for units under about 4 px at the framing zoom. |
| Disputed land | Units are clipped to the ATLAS country shape. Land outside it is measured and flagged, never moved silently. See below. |
| Different administrative systems | Each unit's `kind` and each country's `terms` come from the profile, so titles read "10 provinces and 3 territories", never a guessed "states". |
| Names and diacritics | The existing `normalize` folds case, accents and punctuation ("Quebec" = "Québec"). A test checks that no name or alias matches two units of the same country. |

## Disputed and inconsistent areas

**Policy:** subdivisions follow the country map; they never redraw it. The country map's own choices are a separate policy decision, made in `scripts/build-countries.ts` and documented there. When the two sources disagree, the subdivision build measures the disagreement and records it as a flag in `admin1/index.json`.

**Flagged for review** (none of these affects Canada, and none has been changed):

| Area | Country map today | Natural Earth Admin-1 | Note |
|---|---|---|---|
| Crimea and Sevastopol | Inside Russia (Natural Earth's de facto view) | Under Russia (`adm0_a3: RUS`), with Ukrainian ISO codes UA-43 and UA-40 | Inconsistent with how ATLAS plays Western Sahara, Cyprus and Somalia whole, along internationally recognised lines. A policy decision for the country map; the subdivision build will follow whichever line it uses. |
| Western Sahara | ATLAS plays the territory whole (south of 27°40′N) | Morocco's regions MA-15 and MA-16 extend over it | Morocco's profile must clip or exclude them; Western Sahara gets no subdivision challenge until reviewed. |
| Somaliland, Northern Cyprus, Baikonur, Guantánamo Bay | Merged into Somalia, Cyprus, Kazakhstan and Cuba | Separate rows under SOL, CYN, KAB, USG | Each country's profile lists these in `sources` or excludes them, with a reason. Somalia's data in the Somaliland area is incomplete. |
| Kashmir | India and Pakistan as Natural Earth draws them | IN-JK, IN-LA, PK-GB and PK-JK match the country map | Consistent today; recheck when India is added. |

## Gameplay (Phase 3)

**One engine.** A subdivision round is an ordinary round: `game/scoring.ts` (points, streak bonuses, first-try accuracy, mistakes, Show me, the clock), the HUD, the answer feedback and sounds, the Sprint and full results and the review list are the country ones, unchanged. What differs is data:

- `Game.sub` is the country's subdivision data (null for country rounds) and `Game.places` the targets by id: the country map, or the units (`subdivisionPlayables`). Everything that shows or matches a target goes through `Playable` (`game/playable.ts`: id, name, aliases, a point on its land, a flag or a framing), which a `Country` already is.
- Challenges come from `subdivisionChallenge(countryId, name, mode, kind, ids)` and `subdivisionKinds(count)`: `can-admin1-sprint-find`, `can-admin1-find`, `can-admin1-sprint-name`, `can-admin1-name`. A Sprint only when the country has at least 10 units.
- Wording takes the country's own terms: "Name this province or territory", "Provinces and territories to review", "That was the ocean. Click a province or territory." Nothing in the gameplay code names Canada.
- **Starting a round:** `startSubdivisionRound(countryId, mode, kind)` in `App.tsx`, called from the country's Explore view (development builds for now: Find the Region and Name the Region, each as a 10-question Sprint or all 13). Phase 4 puts the same calls in the real country panel. Leaving a round, or "Back to Canada" on the results, returns to Explore with the country selected and its subdivisions shown.

**Map.** The same globe throughout. In a round the subdivision layer takes the round's statuses (found, missed, answer, target) through `setSubStatuses`, with the same colours as countries (muted until found, steel blue once found, gold target, red missed); other countries fade. Find the Region frames the country; Name the Region frames each target (its `frame` from the build). Show me frames the answer. Hover names appear only for units already found, as for countries.

**Wrong clicks never name the unit.** A wrong click flashes red and counts as a mistake; the HUD says "Incorrect — try again" with the next attempt's points. The clicked unit is recorded by id for the review after the round, as for countries. Clicks on the ocean or another country are explained, never counted.

**Tiny units (Prince Edward Island on a phone).** `resolveSubPick` in `map/pick.ts`, pure and tested: a click on land is the unit under it, unless a unit that is tiny on screen (under 10 px across) is also within the click reach (14 px, 22 px on touch screens); then it is too close to call, the map zooms in two levels, and nothing is counted. Over water, one unit in reach is that unit; several are too close to call. The rule depends only on what is on screen, never on the answer: checked in the browser, a tap between Nova Scotia and PEI zooms in identically whether PEI is the answer or not. No markers were needed for Canada.

**Records.** Subdivision runs go to their own store, `atlas-subdivision-records-v1` (`loadSubdivisionRecords` / `saveSubdivisionRecords`), with the same format and functions as country records. Country records, country stats and Progress never see them, and the country store is not written at all. Keys are the challenge id and version (`can-admin1-find@13-…`), from stable unit ids.

**Phase 3 results** (2026-10-25): typecheck, 134 tests and the production build pass. In the browser on desktop and on a phone with touch: a Find the Region Sprint, a full Find the Region, a full Name the Region and a Name the Region Sprint all played to the end, with a deliberate wrong answer and Show me; wrong clicks named nothing; names were accepted with accents, case and spaces folded and by French names and short forms ("québec", "PEI", "Terre-Neuve-et-Labrador"); records were saved under the subdivision store while the country store stayed byte-for-byte the same; leaving returned to Explore with Canada selected. The country Sprint, Mystery Country and the Canada view still pass.

**Known limitations of Phase 3**

- The only entry is the development Explore view; players get it in Phase 4.
- Subdivision records are saved but not yet shown in Progress (Phase 4). The Explore view shows each challenge's best.
- After Show me, the camera stays on the revealed unit, as in country rounds; the player zooms back out (Find the Region does not reframe on its own).
- On a first run, the full results mark every stat "New best", as country Full Challenges do.

## Explore and Progress (Phase 4)

**Explore is the entry point.** Opening a country in Explore loads the small region index (once; never at startup):

- A country with region data shows a one-line shortcut under its name ("10 provinces and 3 territories · Explore and play", visible without scrolling on a phone) and a regions block among its challenges: the count in the country's own terms, "Show on the globe", and Find the Region and Name the Region with a choice of a 10-question Sprint or all of them (no choice below 10 regions). Each shows its best, or "Not played yet".
- A country without region data shows one quiet line: "Regions of France are not available yet." Nothing broken or empty is ever offered.
- **The regions view** (`components/Regions.tsx`, `RegionsPanel`) replaces the development inspector: the same globe framed on the country, other countries faded, region names on hover or tap, a selected region's name and kind, the games at the top, and a list of every region. "← Canada" returns to the country's panel, still selected; "World view" returns to the whole world. Development builds also show each region's id, ISO code and area, and the build's flags.
- Navigation is a small pure module, `game/exploreNav.ts` (`clickCountry`, `clickNothing`, `openRegions`, `selectRegion`, `backToCountry`, `toWorld`, `afterRound`), tested on its own; the app applies its results. A click on another country leaves the regions view and opens that country; the ocean clears the selected region and stays; leaving a round returns to the country's regions.
- `#subdivisions=CAN` remains a development-only shortcut.

**Progress → Regions.** For every country with region data: each game (Find, Name) and length (Sprint, All) with its best score out of the maximum, first-try accuracy, best time and completion status ("Completed 3 times · 1 perfect", or "Not played yet"), how many of its challenges have been completed, and a button back to the country in Explore. Built by `regionRecords` (`game/regionRecords.ts`) from the region records store and the index alone, without loading any geometry.

**Records keys.** Unchanged from Phase 3, from stable ids: `can-admin1-sprint-find@s10-13-13qavlb.sc2` = challenge id (country, game, length) @ unit-list fingerprint and scoring version. The index carries each country's `unitsVersion` (the fingerprint of its unit ids), so `subdivisionKey` builds the same key as the game without loading the country's file; a test checks the two agree. Records made for a different unit list or scoring version stay in the store and are not shown as current. Country records are never read or written by any of this.

**Phase 4 results** (2026-10-25): typecheck, 140 tests and the production build pass. In the browser on desktop and on a phone with touch: no region requests at startup; the index on opening a country and Canada's file on showing its regions; France's "not available yet"; region selection on the globe and in the list; back to Canada and World view; Find and Name the Region launched from the country panel and from the regions view; × and "Back to Canada" return to the regions view; a perfect Sprint shows in Progress → Regions as 1,400 / 1,400, 100%, its time, and "Completed 1 time · 1 perfect". The country Sprint, Mystery Country and a Name the Region round still pass.

**Known limitations of Phase 4**

- Canada is the only country with region data; every other country shows "not available yet" (Phase 5 adds the United States, Phase 6 the rest).
- Progress lists only records of the current unit list and scoring version; older ones are kept but not shown.
- The Progress "Your stats · all time" summary covers countries only, by design; regions have their own section.

## Challenges (Phase 3 onwards)

- Ids like `can-admin1-find` and `can-admin1-sprint-name`, with `entityType: 'admin1'` and `scopeId: 'country:CAN'`. The version comes from the target ids, as for countries, so records are only compared between identical lists.
- **Sprint**: 10 subdivisions drawn at random, only when the country has at least 10. **Full**: every subdivision. Below 10, only the full challenge.
- The round engine, scoring, streak bonuses, Sprint, records and sounds already work on any list of ids. The refactor is replacing the `Country`-typed plumbing in `App.tsx` and the HUD with one `Playable` type (`id`, `name`, `aliases`, `center`, optional flag). It starts only after the map and Explore integration work (decision 6).
- Records: separate per country, mode and challenge kind, keyed by stable ids. Country stats ("countries answered") count country targets only.

## Phases

| Phase | Scope | Done when |
|---|---|---|
| 2 (built) | Data pipeline; Canada profile; generic subdivision layer; development-only entry | 13 units, exact coast alignment, every unit selectable, existing modes unaffected, all checks pass |
| 3 (built) | Gameplay: Find the Region and Name the Region on the shared engine; full and Sprint challenges; results | Canada playable end to end; country modes and records unchanged |
| 4 (built) | Explore integration (the real entry point, return to Explore with the country selected) and Progress records per country, mode and challenge | Countries without data show a quiet "not available yet" state |
| 5 | United States (50 states; a documented policy for Washington, DC and the territories, never silently mixed in); onboarding guide for the next country | A new country is data and configuration only |
| 6 | Worldwide in reviewed batches (Brazil, Mexico, India, Germany, Japan, Australia, France, Nigeria first); coverage manifest | Each batch validated before the next |

## Canada acceptance (Phase 2) and results

1. Startup downloads nothing new; country modes load and play as before. **Met:** production builds contain no subdivision loading code; the Sprint and Mystery Country play as before.
2. Opening the Canada view fetches the index and `CAN.topo.json` once; reopening fetches nothing. **Met** (checked in the browser).
3. Exactly 13 units, `admin1:CAN:<ISO suffix>`, typed 10 provinces and 3 territories. **Met.**
4. The units cover the country shape: total area within 0.05% of Canada's, no holes, overlaps under 1 km², and the country's outline points reused. **Met:** 9,893,607 km² against 9,893,517 km² (0.0009%); 32,057 of the outline's 32,210 points appear exactly; `countries.topo.json` is unchanged.
5. Every unit is selectable anywhere on its land, including Nunavut's and British Columbia's islands, Newfoundland and Labrador on both the island and the mainland, and Prince Edward Island. **Met:** all 13 by click at their label points in the browser; 31 named places by geometry; PEI by touch at Maritimes zoom on a phone.
6. Clicks either side of a land border select the unit on that side. **Met:** points 1 km either side of every long border segment and every 9th short one (over 100 points) each fall in exactly one unit, different on each side.
7. `npm run typecheck`, `npm test` and `npm run build` pass. **Met.**

**Known limitations of Phase 2**

- On a phone, Canada fits only at zoom 1, where the smallest units are one or two pixels wide; players pinch-zoom (see Very small subdivisions).
- About 15,000 coastline points come from the source coastline rather than the country's, within about 100 m of the drawn coast (see Sizes).
- Frame rates were measured only with software rendering in headless Chrome: opening the view and zooming are no slower than plain Explore there. Not yet measured on real phones.
- The development entry (Explore button and `#subdivisions=CAN`) is temporary and appears in development builds only.

## Adding a country (preliminary; finalised in Phase 5)

1. Add a profile to `src/data/admin1Profiles.ts`: sources, grouping if the Natural Earth level is wrong, every unit with code, English name, kind, reviewed aliases; exclusions with reasons; `enabled: false`.
2. Run `npm run admin1` and read the flags it prints.
3. Add the country to the data tests (counts, kinds, named points that must land in the right unit).
4. Review names, codes and any flags; then set `enabled: true`.
