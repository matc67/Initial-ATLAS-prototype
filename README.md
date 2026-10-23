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
- Score: 100, 60, 30, 10, then 0 points depending on prior wrong guesses
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
