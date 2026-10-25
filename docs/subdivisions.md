# Subdivisions: architecture and plan

First-level administrative divisions (states, provinces, territories, prefectures, regions…) for every country, played through the same globe, game engine and records as countries. This document records the decisions taken, how the data is built, and the staged plan. It supersedes the subdivision parts of [geography.md](geography.md).

**Status:** Phases 2–5 are built. Phase 6 (worldwide) is under way: the audit and coverage manifest are done and batch 1 (Brazil, Mexico, India, Germany, Japan, Australia, France, Nigeria) is built and awaiting review. 10 countries have region data; coverage is in [subdivision-coverage.md](subdivision-coverage.md).

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
    count: number;                       // playable units: the challenges' size
    unitsVersion: string;                // fingerprint of the playable unit ids: record keys use it
    kinds: { [kind: string]: number };   // { Province: 10, Territory: 3 }
    terms: AdminTerms;                   // singular/plural, plus each kind's
    bounds: [west, south, east, north];  // east > 180 when the country crosses 180°
    flags: string[];                     // review notes from the build
    others?: { id; name; kind; note }[]; // units drawn but not played (Washington, DC)
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
  playable?: false;    // drawn and named, never asked (Washington, DC); with a `note` saying why
  note?: string;
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
| Remote parts (Alaska, Hawaii) | Every part stays in its unit and is clickable. Framing ignores specks: a unit is framed by the parts holding 99% of its land (`CORE_SHARE`), so Hawaii is framed on its main islands, not stretched 1,600 km to Laysan; the country is framed by every unit's core, so Alaska and Hawaii are in view with the 48 states. |
| Multipolygons and islands | A unit is one feature however many parts it has (Nunavut has over 200 islands). Islands under 3,000 km² get coastline traces, so even islets smaller than a pixel show and take clicks. |
| 180° | Bounds by largest longitude gap; seam cuts are removed from borders by the existing `borderRuns`; distances use unit vectors (as in Mystery Country). Chukotka and Fiji's Northern Division touch 180° in the source. |
| Very small subdivisions | Decided in screen pixels at the country's framing, not km². Handled by `resolveSubPick` (Phase 3): a tap that could mean a unit under 10 px is too close to call and zooms in. Rhode Island and Delaware use it on a phone; no ring markers have been needed. Washington, DC is drawn but not played (Phase 5). Canada needs none on desktop (Prince Edward Island, the smallest at 5,700 km², is clickable at the default framing). On a phone, all of Canada fits only at zoom 1, where PEI is about one pixel; the tap reach over water and pinch-zoom cover it, and Phase 3 should reconsider rings for units under about 4 px at the framing zoom. |
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
| Kashmir | India and Pakistan as Natural Earth draws them; Siachen and Aksai Chin are separate, non-playable land | IN-JK and IN-LA match the country map | **Checked with India (batch 1):** consistent, no build flags. Recheck when Pakistan and China are added. |
| Arunachal Pradesh | In India | IN-AR, in India | Claimed by China. Played as India's, following the country map; noted in India's profile. |
| Southern Kuril Islands | In Russia | Not in Hokkaido | Claimed by Japan. Following the country map; noted in Japan's profile. |
| Liancourt Rocks, Senkaku Islands | Liancourt in South Korea's shape; the Senkakus are not drawn | In no Japanese unit | Claimed by Japan (both) and by South Korea and China/Taiwan. Nothing changed; noted here. |

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

## United States (Phase 5)

**What is played: the 50 states.** `admin1:USA:<USPS code>` (`AL` … `WY`), kind State, from Natural Earth's 51 USA rows. The profile declares `expect: { State: 50 }`, so the build stops if a state is missing or an extra one is played.

**Policy for Washington, DC and the territories** (in the profile's `notes`; nothing is mixed in silently):

| Place | In Natural Earth | In ATLAS |
|---|---|---|
| Washington, DC | A USA row, US-DC, "Federal District" | **Drawn and named, never asked.** A unit with `playable: false` and a note: it keeps its own 162 km² (never merged into Maryland), is listed in Explore under "Also on the map, not played", and looks like land outside the game during a round. Clicking it in a round is a neutral note, "That is not one of the 50 states in this game.", never a mistake and never named. Typing "Washington, DC" is an ordinary wrong answer; "Washington" is the state. |
| Puerto Rico | Its own entity (PRI) | One of the 200 countries in ATLAS, played as a country. Not part of the United States' regions. |
| Guam, US Virgin Islands, American Samoa, Northern Mariana Islands, US Minor Outlying Islands | Their own entities (GUM, VIR, ASM, MNP, UMI) | Outside the United States' country shape: shown on the globe as territories of the United States (Explore explains this), not playable and not regions. |

The same `playable: false` mechanism serves any country with a unit that is mapped but not one of the set being played (a capital district, an unorganised area). Such a unit needs a `note`; the index lists it under `others`, and its `count`, `kinds` and `unitsVersion` cover the playable units only, so the challenges and their record keys never include it.

**Geometry.** 50 states and DC, 305 KB (100 KB gzipped), built in about 75 s with no review flags: coverage of the country map within 0.05%, no holes or overlaps, every border sampled 1 km either side. Alaska (181 parts, across 180° at Attu) and Hawaii (14 parts, out to Laysan Island) are single units; every part is clickable.

**Framing.** The country bounds cross 180° (the western Aleutians), handled by `boundsOf`; Find the Region opens with every state's label on screen, on desktop and on a phone (checked in the browser). Name the Region frames each state by its core (see Edge cases). On a phone the smallest states are a few pixels at the opening view; the too-close-to-call zoom covers them.

**Wording.** Country names take "the" in a sentence where English does (`inSentence` in `data/roster.ts`: "50 states in the United States", "Back to the United States", "That is outside the United States."). Titles keep the bare name.

**Phase 5 results** (2026-10-25): typecheck, 162 tests and the production build pass. Rebuilt with `npm run admin1`, Canada's geometry, ids and unit-list fingerprint are unchanged, so its records keys are too; only the framing of five units moved slightly with core-part framing (New Brunswick 237 → 216 km, Northwest Territories 1,316 → 1,271 km, Nunavut 1,841 → 1,785 km, Nova Scotia and Newfoundland and Labrador by a few km). In the browser on desktop and on a phone with touch: nothing loads at startup, the index on opening the United States and `USA.topo.json` on showing its states; Find the Region over all 50 and as a Sprint, Name the Region over all 50, each with a deliberate wrong answer and Show me; DC selected in Explore with its note, and clicked in a round with the neutral note and no mistake; records under `usa-admin1-*`, country records unchanged; "Back to the United States"; Progress → Regions lists Canada and the United States. Canada's Find the Region (all 13) and Name the Region Sprint, and the country Find it and Name it rounds, still pass.

**Known limitations of Phase 5**

- On a phone, the whole United States fits only when the 48 states are small; Rhode Island, Delaware and the Northeast need the zoom assist or a pinch.
- The games are still called Find the Region and Name the Region for every country (their descriptions use the country's own word: "We name a state; you click it.").
- Two-letter postal codes ("NY") are deliberately not accepted as typed answers.

## Worldwide (Phase 6)

### Data and licensing audit

| Source | Licence | Verdict |
|---|---|---|
| **Natural Earth Admin-1 1:10m** (in use) | Public domain | Used for every country: one consistent release, the same one as the country map, which its outer edges match (99–100% shared vertices). |
| geoBoundaries (gbOpen) | CC BY 4.0 for most countries; some releases under other terms | A fallback for a country Natural Earth gets wrong; would need attribution in the app and a per-country licence check. Not used. |
| GADM | Free for non-commercial use only; no redistribution | Not usable. |
| OpenStreetMap | ODbL (share-alike) | Not used: the share-alike terms would extend to the derived files. |
| Wikidata | CC0 | Only as a crosswalk (each unit's `src.wikidata`). |

**Coverage manifest:** `npm run admin1:audit` (`scripts/audit-admin1.ts`) audits Natural Earth's rows for all 200 countries and writes [subdivision-coverage.md](subdivision-coverage.md):
- Supported countries, and each country's row count and types.
- Clean, unique ISO codes, and rows without a name or type.
- Rows coded under another country (Crimea's UA-43 and UA-40 under Russia).
- Rows that probably need grouping (more than 60).
- The rows' area against the country map, where a large difference means disputed or misattributed land (Morocco +43% for Western Sahara, France +16% for its overseas departments).

Each country gets a grade (A 134, B 52, C 14) as a starting point for review, and a proposed order for the next batches. The row count is not the official count: each profile is checked against an official source and declares its own `expect`.

### Policy: capital districts and territories

Each country plays its first-level divisions as its own constitution or national government lists them. A unit that is mapped but not one of that set is drawn and named, never asked (`playable: false`). Nothing is merged into a neighbour.

| Country | Played | Drawn, not played | Why |
|---|---|---|---|
| United States | 50 states | Washington, DC | The 50 states are the constituent units; DC is a federal district outside them (Phase 5). |
| Brazil | 26 states + Federal District | – | The constitution lists 27 federative units, the Federal District among them. |
| Mexico | 31 states + Mexico City | – | The constitution lists 32 federal entities. |
| Nigeria | 36 states + Federal Capital Territory | – | The constitution lists 36 states and the FCT. |
| India | 28 states + 8 union territories | – | The national list of states and union territories. |
| Australia | 6 states + ACT + Northern Territory | Jervis Bay Territory | The 6 states and 2 self-governing mainland territories; Jervis Bay (about 70 km²) is administered federally. |
| France | 13 metropolitan regions | – (overseas regions are separate land) | The 5 overseas regions are not part of ATLAS's France on the country map. |

Overseas and external territories (Puerto Rico, Guam, French Guiana, Réunion, Christmas Island…) follow the country map: playable countries are countries, and other land stays non-playable.

### New generic tools (all in the profile and the build; no game or map code names a country)

- `mergeInto`: rows that are part of another unit (Macquarie Island → Tasmania; Arrecife Alacranes → Yucatán), each with a reason. Rows that share a code are merged automatically (Lord Howe Island, coded AU-NSW). The unit takes its label, ISO code and Wikidata id from its own main row.
- `moveParts`: whole islands that Natural Earth files under the wrong unit move to the right one, by a box, with a reason. The build stops if a part would be cut, or if nothing moves; no line is ever drawn. Used once: **the Amami Islands are Kagoshima's, but Natural Earth has them in Okinawa** (6 islands, 1,150 km²). The place tests found this.
- `reviewed`: build flags reviewed by hand, by unit code, with what was found. A test fails on any flag not reviewed, and on a reviewed flag that no longer occurs. Batch 1's five flags (Andaman and Nicobar, Lakshadweep, Okinawa, Bayelsa, Rivers) are all islets and mangrove coast that the country map draws as sea: up to 77 km² in total per unit, in pieces of 3 km² or less, none on another country. They are left out, since the country map is the authority.
- **Codes** are the current ISO 3166-2 codes, set in the profile where Natural Earth's are out of date (India's CG, OD, TS and UK from 2023; Mexico City's CMX from 2016). The source code stays in `src.iso` as a crosswalk.
- **Grouping**: France's 96 metropolitan departments are grouped into its 13 regions by Natural Earth's `region` field.
- **Labels** sit on a unit's core, so each is inside its unit's framing (Kagoshima's source label is on an outlying island).
- **Enclaves**: the coverage test allows a hole only when another unit fills it (the Federal District in Goiás, Berlin in Brandenburg, the ACT in New South Wales, Yanam in Andhra Pradesh) or when the country map has the same hole.
- **Ring markers** for units too small to see. A unit under 10 px across at the current zoom, measured by its largest part, carries a ring like a tiny country's, which fades out as the unit grows (`ringUntilZoom` in `map/pick.ts`). Clicks are unchanged: the tap reach and the too-close-to-call zoom already cover a ring's area. On desktop, India's opening view rings Lakshadweep, Chandigarh, Delhi, Puducherry and Dadra and Nagar Haveli and Daman and Diu; the US rings Rhode Island, DC and Hawaii. On a phone, Prince Edward Island, the small northeastern states and nine Japanese prefectures are ringed.
- **Per-country rebuild**: `npm run admin1 -- JPN` rebuilds only Japan and keeps every other country as built.

### Batch 1

| Country | Played | File (gzipped) | Data issues found and resolved |
|---|---|---:|---|
| Brazil | 26 states and 1 federal district | 176 KB (59 KB) | None. The Federal District is an enclave in Goiás. |
| Mexico | 31 states and 1 capital city | 117 KB (39 KB) | Mexico City named "Distrito Federal" under MX-DIF: now Mexico City, CMX. An unnamed reef row merged into Yucatán. Bare "Mexico" is not accepted, since it would be ambiguous. |
| India | 28 states and 8 union territories | 168 KB (56 KB) | Four outdated codes; Himachal Pradesh typed as a union territory and Gujarat untyped. Two coastal flags reviewed. Kashmir checked against the country map. |
| Germany | 16 states | 64 KB (21 KB) | None. English names, with the German names as aliases. Berlin, Hamburg and Bremen (with its exclave Bremerhaven) are city-states. |
| Japan | 47 prefectures | 91 KB (30 KB) | The Amami Islands are in Okinawa in the source and were moved to Kagoshima. One coastal flag reviewed. |
| Australia | 6 states and 2 territories | 102 KB (33 KB) | Lord Howe Island shares the New South Wales code (merged); Macquarie Island has no code (merged into Tasmania); Jervis Bay is drawn but not played. |
| France | 13 regions | 54 KB (14 KB) | The rows are departments: grouped into regions. The overseas departments are excluded (separate land on the map). |
| Nigeria | 36 states and 1 federal capital territory | 56 KB (19 KB) | "Nassarawa" spelt Nasarawa; the FCT was typed as a state. Two coastal flags reviewed. |

All 10 files together are 1.6 MB, 520 KB gzipped. Each country's file is fetched only when its regions are shown; the largest is still Canada (149 KB gzipped). Canada's and the United States' files are unchanged by batch 1.

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
| 5 (built) | United States (50 states; a documented policy for Washington, DC and the territories, never silently mixed in); onboarding guide for the next country | A new country is data and configuration only |
| 6 (batch 1 built) | Worldwide in reviewed batches (Brazil, Mexico, India, Germany, Japan, Australia, France, Nigeria first); coverage manifest | Each batch validated before the next |

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

## Adding a country

A country is data and configuration: a profile, a build, and its tests. No game, map or Explore code changes. The United States was added this way, apart from two generic additions it was the first to need (units drawn but not played, and core-part framing), which now serve every country.

1. **Check the source.** Start from the country's row in [subdivision-coverage.md](subdivision-coverage.md) (`npm run admin1:audit`), then List the country's Natural Earth rows (`adm0_a3`) in `data-raw/…ne_10m_admin_1_states_provinces.geojson`: their `iso_3166_2`, `name`, `type_en`. Count them against an official source for the first-level divisions. Look for rows under other `adm0_a3` codes that belong to the country (see [Disputed and inconsistent areas](#disputed-and-inconsistent-areas)), and for rows below the first level (then use `groupBy`).
2. **Write the profile** in `src/data/admin1Profiles.ts`:
   - `sources`, `key` (`iso_3166_2` when clean and unique), and `groupBy` if needed.
   - `terms`: the country's own words, singular and plural, with each kind ("province or territory"; "state" and "federal district").
   - `units`: every row, with code (the ISO 3166-2 suffix), English name, kind, reviewed `aliases` (official names in other languages, well-established short forms; never historical names or bare abbreviations), and `abbrev`.
   - `mergeInto` for rows that are part of another unit, and `moveParts` for whole islands filed under the wrong unit, each with a reason.
   - `exclude`: rows left out entirely, each with a reason. For a unit that is drawn but not one of the set played, use `playable: false` with a `note` instead, so its land is never merged into a neighbour.
   - `expect`: the playable count of each kind, from the official source.
   - `notes`: any policy decision (what is not played, and why).
   - `enabled: false` until reviewed.
3. **Build:** `npm run admin1 -- <ID>` (only that country; `npm run admin1` rebuilds them all). It stops on any profile error (a row not reviewed, a duplicate code or name, a missing note, a wrong count) and prints flags for any disagreement with the country map larger than 1 km² and 0.5% of a unit. Read every flag; resolve it in the profile, or record what you found in the profile's `reviewed`. Never change `countries.topo.json` to make a flag go away.
4. **Test:** `npm test`. `src/data/admin1Countries.test.ts` runs on every country in the index without changes: ids, counts, the index's fingerprint, names that match exactly one unit, coverage of the country map without holes or overlaps, every label point, both sides of every internal border, colours, framing, and the file size limit (512 KB). Then add a block of country checks there, as for the United States: the exact list of codes, places that must land in the right unit (islands, exclaves, remote parts and cities near borders), points either side of straight borders, any `playable: false` unit, and typed names.
5. **Check in the browser** on desktop and on a phone: open the country in Explore, show its regions, play Find and Name the Region (a Sprint when it has 10 or more), check the opening view shows every unit and that tiny ones can be chosen, and that Progress → Regions lists it.
6. **Review and enable:** names, codes, policy notes and flags reviewed, then `enabled: true` and rebuild. A disabled country is visible in development builds only.

If a country needs something no profile option covers, add it to the profile format and the build generically (as `playable: false` was for Washington, DC), never as a case for one country in game or map code.
