# ATLAS — World Mastery (prototype v0.1)

A playable first iteration of ATLAS: a persistent dark 3D globe with country guessing, points, region selection, and browser-local mastery.

## Run locally

1. Install Node.js 20.19+ (or Node.js 22+).
2. In this folder run `npm install`.
3. Run `npm run dev`.
4. Open the local URL Vite prints (normally `http://localhost:5173`).

To make a production bundle run `npm run build`.

## Included

- MapLibre GL JS globe, solid-fill countries, selected-country highlighting
- Find the Country and Name the Country modes
- Worldwide and continent filters
- Score: 100, 50, 25 for the 1st, 2nd and 3rd attempt, then 10; Show me gives 0
- Streak bonuses for first-try answers in a row: +50 at 3, +100 at 5, +250 at 10, +500 at 20, +1,500 at 50, +4,000 at 100 (a perfect 10-Country Sprint scores 1,400). Records are kept per scoring version, so runs from before bonuses are kept but not ranked against new ones
- Flags: a flag is shown and you click its country on the globe; Sprint or Full Challenge for any area and either country set, scored like Find it with its own records (Progress → Records → Flags). Indonesia/Monaco and Chad/Romania look the same in the flag artwork, so clicking the twin is a neutral note, not a mistake (`src/game/flagQuiz.ts`)
- Mystery Country: find a hidden country (from the 200 or the Classic 195) by clicking or typing guesses; each wrong guess is coloured from pale rose (far) to deep red (close). Distance is the shortest great-circle distance between the two countries' land as drawn on the globe (0 km for neighbours; see `src/game/distance.ts`). Ranked by fewest guesses, then time, with its own records; a puzzle in progress survives a refresh
- Regions: open Canada (10 provinces and 3 territories) or the United States (50 states; Washington, DC is shown but not played) in Explore and play Find the Region or Name the Region, as a 10-question Sprint or all of them; records in Progress → Regions. Built by `npm run admin1` from Natural Earth; adding a country is a profile and its tests (see `docs/subdivisions.md`, Adding a country)
- Optional sound effects (Web Audio, no music): off by default, toggled from the HUD speaker or Help, with a volume slider; both remembered
- Progress in `localStorage` without login; two separate first-attempt successes count as mastered
- Optional mastery overlay; country selection when not playing

## Prototype limitations / next work

- Country GeoJSON is loaded over the network from [datasets/geo-countries](https://github.com/datasets/geo-countries). Internet access is required. For production, bundle/version the dataset and explicitly review licensing, boundaries, and country roster.
- Continent assignment uses dataset properties if available and a coarse fallback; **validate all assignments** before treating continent mode as a complete authoritative roster.
- No country subdivisions, city layer, user accounts, or backend yet.
- Some small islands and disputed boundaries need custom selection UX and policy.
- Country-name validation needs a comprehensive aliases/localized names list.
- The first version does not yet persist round history or provide spaced repetition scheduling.
- The globe uses a simple blank basemap with polygons, not a finished terrain/atmosphere treatment.

## Architecture

React + TypeScript + Vite + MapLibre. No backend required for the first prototype.
