// Saves the GeoNames inputs of the current city data as a release snapshot, so a released scoring dataset can be rebuilt
// exactly later, whatever GeoNames publishes by then. Run with `npm run cities:snapshot` after `npm run cities`.
//
// The snapshot keeps cities1000, admin1CodesASCII and countryInfo whole, and only the alternate-name rows of places in
// cities1000 and of first-level regions (all the build reads), so it is tens of MB instead of most of a GB. It is written
// to data-raw/release/ (gitignored) as a folder and a .tar.gz: attach the archive to the GitHub release. To rebuild from
// it: extract, then `GEONAMES_DIR=<folder> npm run cities -- --verify` (or without --verify to write the data).
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { CityIndex } from '../src/data/cities.ts';

const SRC = process.env.GEONAMES_DIR ?? 'data-raw/geonames';
const index = JSON.parse(readFileSync('public/data/cities/index.json', 'utf8')) as CityIndex;
const name = `geonames-${index.source.dataDate}`;
const OUT = `data-raw/release/${name}`;
mkdirSync(OUT, { recursive: true });

const ids = new Set<string>();
for (const line of readFileSync(`${SRC}/cities1000.txt`, 'utf8').split('\n')) if (line) ids.add(line.slice(0, line.indexOf('\t')));
for (const line of readFileSync(`${SRC}/admin1CodesASCII.txt`, 'utf8').split('\n')) if (line) ids.add(line.split('\t')[3]);

for (const f of ['cities1000.txt', 'admin1CodesASCII.txt', 'countryInfo.txt']) copyFileSync(`${SRC}/${f}`, `${OUT}/${f}`);
// When each input was published and downloaded, as the shipped data records it: copied files have new timestamps.
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(Object.fromEntries(index.source.inputs.map(i => [i.file, { lastModified: i.lastModified, downloadedAt: i.downloadedAt }])), null, 2));
const out = createWriteStream(`${OUT}/alternateNamesV2.txt`);
let kept = 0;
for await (const line of createInterface({ input: createReadStream(`${SRC}/alternateNamesV2.txt`), crlfDelay: Infinity })) {
  const a = line.indexOf('\t'), b = line.indexOf('\t', a + 1);
  if (ids.has(line.slice(a + 1, b))) { out.write(line + '\n'); kept++; }
}
await new Promise(res => out.end(res));
writeFileSync(`${OUT}/README.txt`, [
  `GeoNames inputs of the ATLAS city data dated ${index.source.dataDate} (generator ${index.source.generator.slice(0, 12)}).`,
  'Source: https://download.geonames.org/export/dump/ — CC BY 4.0, attribution required.',
  'alternateNamesV2.txt holds only the rows of places in cities1000.txt and of first-level regions.',
  `Rebuild: GEONAMES_DIR=${OUT} npm run cities -- --verify`,
].join('\n') + '\n');
execFileSync('tar', ['-czf', `data-raw/release/${name}.tar.gz`, '-C', 'data-raw/release', name]);
console.log(`Snapshot: ${OUT} (${kept.toLocaleString()} alternate-name rows) and data-raw/release/${name}.tar.gz`);
