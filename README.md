# ATLAS — Master the World

A geography game on a dark 3D globe. Find countries, name them, match flags, solve Mystery Country, and learn the
first-level regions (states, provinces, territories) of ten countries. Scores, streaks and records are kept in the
browser; there is no login and no server.

## Games

- **Find it**: a country is named; click it on the globe.
- **Name it**: a country lights up in gold; type its name (aliases and accents are forgiven).
- **Flags**: a flag is shown; click its country. Indonesia/Monaco and Chad/Romania fly flags that look the same in the
  artwork, so clicking the twin is a neutral note, not a mistake (`src/game/flagQuiz.ts`).
- Each of these as a **10-Country Sprint** or a **Full Challenge**, for the World, a continent, or the Americas, and for
  **all 200 countries** or the **Classic 195** (UN members and observers).
- **Mystery Country**: find a hidden country; each wrong guess is coloured by how close it is. Ranked by fewest
  guesses, then time. A puzzle in progress survives a refresh.
- **Regions**: Find the Region and Name the Region for Australia, Brazil, Canada, France, Germany, India, Japan,
  Mexico, Nigeria and the United States, from Explore (or Play → Regions).

Scoring: 100, 50, 25 points for a 1st, 2nd or 3rd attempt, then 10; Show me gives 0. Streak bonuses for first-try
answers in a row: +50 at 3, +100 at 5, +250 at 10, +500 at 20, +1,500 at 50, +4,000 at 100. Time never changes points;
it only separates equally accurate runs. A wrong click never reveals the answer.

## Run locally

1. Install Node.js 20.19+ or 22+.
2. `npm install`
3. `npm run dev`, then open the URL Vite prints (normally http://localhost:5173).

| Command | What it does |
| --- | --- |
| `npm test` | All unit and data tests (`node --test`, no browser needed) |
| `npm run typecheck` | TypeScript, app and scripts |
| `npm run build` | Type-checks, then builds the static site into `dist/` |
| `npm run preview` | Serves `dist/` locally, to check a production build |
| `npm run data`, `relief`, `places`, `admin1` | Rebuild the map data in `public/data/` from Natural Earth (only when changing data; needs `data-raw/`) |

## Deploy to Netlify

The site is fully static: `npm run build` produces `dist/`, and `netlify.toml` holds the build command, Node version,
cache headers and security headers. No environment variables are needed.

**From Git (recommended)**

1. Push the branch to GitHub (or GitLab/Bitbucket).
2. In Netlify: *Add new site → Import an existing project*, pick the repository and the branch to deploy.
3. Netlify reads `netlify.toml`: build command `npm run build`, publish directory `dist`. Click *Deploy*.
4. Every push to that branch redeploys. Pull requests get their own preview URL.

**By hand (no Git connection)**

1. `npm ci && npm run build`
2. `npx netlify-cli deploy --dir=dist` for a draft URL; check it, then `npx netlify-cli deploy --dir=dist --prod`.

After deploying, open the site, play a Sprint, refresh mid-Mystery, and open a country's regions in Explore; the
browser console should show no errors and no failed requests.

## What a visitor downloads

About 400 KB of JavaScript (gzip; MapLibre is its own file, so it stays cached across releases), the country shapes
(~760 KB gzip, preloaded with the page), a 930 KB relief image, and flags and region files only as they are needed.

## Saved data

Everything lives in `localStorage` (records, Mystery history and the puzzle in progress, sound settings, the chosen
country set). If storage is blocked (some private modes), the game still works; records last for the visit only.
Records are keyed by challenge version, so a change to a roster or the scoring rules starts fresh records without
deleting old ones.

## Architecture

React 19 + TypeScript + Vite + MapLibre GL (globe projection). Game rules are pure functions in `src/game/` with tests
beside them; `src/map/GlobeView.ts` owns the map; `src/App.tsx` connects the two. Data: Natural Earth (public domain),
built into `public/data/` by the scripts in `scripts/`; flags from flag-icons (MIT, `public/flags/LICENSE.txt`). See
`docs/geography.md` and `docs/subdivisions.md` for the data and the regions design.

## Known limitations

- Progress is per browser; there are no accounts or sync.
- Needs WebGL. Very old devices, or browsers with hardware acceleration off, see a message instead of the globe.
- `npm audit` reports MapLibre ≤ 6.4 (an XSS in its Popup HTML sanitiser; ATLAS uses no Popups or MapLibre HTML) and
  sharp (a build-time image tool, not shipped). Upgrading MapLibre to 6.x is a planned follow-up.
- Disputed boundaries follow Natural Earth's de facto lines; Explore states each country's political status.
