// Release-versioned data (see src/data/release.ts). A production build serves public/data from dist/data/<hash>/, where
// <hash> depends only on the data's contents: the same data gives the same folder, so a release that changes only code
// keeps every player's cached data, and a release that changes data gets a new folder no old page will ask for.
// dist/release.json names the folder, for out-of-date pages and for checking a deploy.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

// A short hash of every file's path and contents, in a fixed order.
export function dataHash(dir: string): string {
  const h = createHash('sha256');
  for (const f of filesUnder(dir).map(p => relative(dir, p).split(sep).join('/')).sort()) {
    h.update(`${f}\0${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}\n`);
  }
  return h.digest('hex').slice(0, 12);
}
export const dataDirOf = (hash: string) => `data/${hash}/`;

// Moves the copied public data in dist/data into dist/data/<hash>/ and writes dist/release.json.
export function placeReleaseData(dist: string, hash: string) {
  const tmp = join(dist, '.data-release');
  renameSync(join(dist, 'data'), tmp);
  mkdirSync(join(dist, 'data'));
  renameSync(tmp, join(dist, 'data', hash));
  writeFileSync(join(dist, 'release.json'), JSON.stringify({ dataDir: dataDirOf(hash) }) + '\n');
}
