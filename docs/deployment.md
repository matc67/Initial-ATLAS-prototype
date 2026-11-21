# Deploying ATLAS

ATLAS is a static site on Netlify. `netlify.toml` holds everything Netlify needs: the build (`npm run build` into
`dist/`, Node 22), cache rules, security headers and the Content Security Policy. There is no server code and there are
no environment variables. The production site is https://atlasxp.netlify.app/, deployed from the branch set as
Netlify's production branch (currently `prelaunch/polish`).

## Before deploying: the checklist

Run these on the commit you mean to deploy, from a clean working tree. Every step must pass; write down anything you
skip and why.

| # | Check | Command | Passes when |
|---|---|---|---|
| 1 | Unit and data tests | `npm test` | all pass (includes the city data validation and `netlify.toml` checks) |
| 2 | Types | `npm run typecheck` | no errors |
| 3 | Production build | `npm run build` | builds; `dist/release.json` names `data/<hash>/` |
| 4 | Browser regression tests | `npm run test:e2e:only` (after step 3), or `npm run test:e2e` | all pass, performance last |
| 5 | City data | `npm run cities:validate` | 0 failures; read the warnings and the list of countries whose totals changed |
| 6 | Dependencies | `npm audit` | no new findings beyond the known ones below |
| 7 | Release notes | | what changed for players, and whether any data (and so any record) changed |

The browser tests need Playwright's Chromium once per machine: `npx playwright install chromium`. On a Mac they draw
the globe with Metal; elsewhere with SwiftShader (software WebGL). If the performance test fails on a slow machine,
check it with `PERF_BUDGET_SCALE=2 npm run test:e2e:only -- --project=performance --no-deps` before suspecting the code.

### Known audit findings

- **maplibre-gl (GHSA-jrc7-96c5-q579).** `npm audit` flags every version up to 6.4.0, including 5.24.1, because the
  advisory lists only 6.4.1 as patched. 5.24.1 contains the same fix (maplibre-gl-js #8189) and replaces the attribution
  sanitiser with an allow list. ATLAS does not reach the vulnerable code in any version: the map has no attribution
  control, no popups and no HTML from data. Moving to MapLibre 6 is a separate, planned upgrade.
- **sharp.** A build-time tool for `npm run relief`; it is not shipped to players and only ever reads Natural Earth's
  relief raster.

## Deploying

Pushing to the production branch deploys it. Netlify builds the commit, then switches the whole site at once (atomic):
visitors never see half a release.

To check a release before it goes live, open a pull request: Netlify builds a deploy preview with its own URL, served
with the production headers. The browser tests can run against it:

```sh
E2E_BASE_URL=https://deploy-preview-<n>--atlasxp.netlify.app/ npx playwright test gameplay security help
```

## After deploying: verification

1. `curl -sI https://atlasxp.netlify.app/ | grep -i content-security-policy` shows the policy.
2. `curl -s https://atlasxp.netlify.app/release.json` names the same `data/<hash>/` as your `dist/release.json`.
3. Open the site in a private window with the browser console open: play a Sprint, a Mystery (refresh in the middle),
   open Canada's regions in Explore, and play a City Rush to its results. No errors, no CSP messages, no failed requests.
4. On a phone: start a game, open Help (?) in its panel, close it, finish, fold the results with Show map.
5. Optional and quick: `E2E_BASE_URL=https://atlasxp.netlify.app/ npx playwright test security` against production.

## Data versions and pages left open

Production builds put `public/data` in `dist/data/<hash>/`, where the hash depends only on the data's contents
(`scripts/release-data.ts`), and write `dist/release.json` naming that folder. The app asks only for files in its own
folder (`src/data/release.ts`), and the folder is cached for good.

- A release that changes only code keeps the same folder, so returning players keep their cached data.
- A release that changes data gets a new folder. A page opened before the deploy keeps asking for the old folder,
  which no longer exists, so it gets a 404 rather than new data its code was not written for. It then reads
  `release.json`, sees another folder, and shows "ATLAS has been updated. Reload to continue." Saved progress is in the
  browser's storage and is untouched by the reload; a timed City Rush in progress resumes with its original deadline.
- Records stay compatible regardless: City Rush records and learning history are keyed by each country's data version
  (computed from the city data itself), so records from different data are kept but never compared.

The first deploy with release folders moves the data from `/data/...` to `/data/<hash>/...`. A page still open from the
release before it (which predates the update notice) shows its ordinary "could not load" message the next time it
needs a file, and works again after a reload. This happens once.

## Content Security Policy

`default-src 'self'`, with only these exceptions: Google Fonts (`fonts.googleapis.com` styles, `fonts.gstatic.com`
fonts), `blob:` workers (MapLibre), and `data:`/`blob:` images (MapLibre's image decoding). No inline scripts, no
`eval`, no inline styles, no framing. The browser tests serve the build with the headers from `netlify.toml`
(`scripts/serve-dist.ts`) and fail on any violation.

If a production problem is traced to the policy, the quickest safe change is to rename the header to
`Content-Security-Policy-Report-Only` in `netlify.toml` and deploy: the browser then reports violations in the console
without blocking anything. Fix the cause, then switch it back.

## Rolling back

**Fastest: republish the previous deploy in Netlify (no rebuild, takes seconds).**

1. Netlify → the ATLAS site → *Deploys*.
2. Find the last good production deploy (each lists its commit and branch) and open it.
3. Click *Publish deploy*. The site switches to that deploy at once.
4. Pushes to the production branch will publish again as normal. If a fix will take a while, use *Stop auto publishing*
   on the Deploys page so the next push does not replace the rollback by surprise, and turn it back on afterwards.

The rolled-back deploy brings back its own `release.json` and data folder, so pages opened on the bad release show the
update notice and reload onto the restored one. Nothing is lost from players' browsers: records written by the bad
release stay in storage; records keyed to a data version the restored release does not have are kept but not compared.

**Then make the code match: revert the commit.**

```sh
git revert <bad commit>          # a new commit that undoes it; history is kept
git push origin prelaunch/polish # Netlify deploys the revert
```

Never force-push the production branch to roll back.

**Local check of an older release.** `git worktree add ../atlas-<sha> <sha>`, then `npm ci && npm run build` and
`npm run serve:dist` in that folder serves it as Netlify would.
