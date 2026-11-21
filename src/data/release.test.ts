import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataDirOf, dataHash, placeReleaseData } from '../../scripts/release-data.ts';
import { DATA_DIR, UPDATE_EVENT, dataUrl, fetchData, releaseChanged } from './release.ts';

const tree = (files: { [path: string]: string }) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-data-'));
  for (const [p, body] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), body); }
  return dir;
};
const respond = (routes: { [url: string]: [number, unknown] }): typeof fetch => (async (url: string) => {
  const [status, body] = routes[String(url)] ?? [404, null];
  return new Response(body === null ? null : JSON.stringify(body), { status });
}) as typeof fetch;

test('outside a build, data is read from /data/', () => {
  assert.equal(DATA_DIR, 'data/');
  assert.equal(dataUrl('cities/CAN.json'), '/data/cities/CAN.json');
});

test('the data hash depends on contents and paths only, not on file order or time', () => {
  const a = tree({ 'x.json': '1', 'cities/CAN.json': '[]' }), b = tree({ 'cities/CAN.json': '[]', 'x.json': '1' });
  assert.equal(dataHash(a), dataHash(b));
  assert.match(dataHash(a), /^[0-9a-f]{12}$/);
  assert.notEqual(dataHash(a), dataHash(tree({ 'x.json': '2', 'cities/CAN.json': '[]' })), 'a changed file');
  assert.notEqual(dataHash(a), dataHash(tree({ 'y.json': '1', 'cities/CAN.json': '[]' })), 'a renamed file');
});

test('a build moves its data into the hashed folder and names it in release.json', () => {
  const dist = tree({ 'index.html': '', 'data/x.json': '1', 'data/cities/CAN.json': '[]' });
  placeReleaseData(dist, 'abc123def456');
  assert.deepEqual(readdirSync(join(dist, 'data')), ['abc123def456']);
  assert.equal(readFileSync(join(dist, 'data/abc123def456/cities/CAN.json'), 'utf8'), '[]');
  assert.deepEqual(JSON.parse(readFileSync(join(dist, 'release.json'), 'utf8')), { dataDir: dataDirOf('abc123def456') });
});

test('a page knows when the deployed release is another one', async () => {
  assert.equal(await releaseChanged(respond({ '/release.json': [200, { dataDir: 'data/new/' }] }), 'data/old/'), true);
  assert.equal(await releaseChanged(respond({ '/release.json': [200, { dataDir: 'data/old/' }] }), 'data/old/'), false);
  assert.equal(await releaseChanged(respond({}), 'data/old/'), false, 'no release.json: not out of date');
  assert.equal(await releaseChanged((async () => { throw new Error('offline'); }) as typeof fetch, 'data/old/'), false);
});

test('a missing data file rejects, and announces an update only when a newer release replaced it', async () => {
  let heard = 0;
  const target = new EventTarget();
  (globalThis as { window?: unknown }).window = target;
  target.addEventListener(UPDATE_EVENT, () => heard++);
  try {
    // The same release: a plain failure, no announcement.
    await assert.rejects(fetchData('cities/XXX.json', respond({ '/release.json': [200, { dataDir: DATA_DIR }] })), /Could not load cities\/XXX.json \(404\)/);
    assert.equal(heard, 0);
    // A newer release: announced once, however many files fail.
    const newer = respond({ '/release.json': [200, { dataDir: 'data/0123456789ab/' }] });
    await assert.rejects(fetchData('cities/CAN.json', newer));
    await assert.rejects(fetchData('cities/USA.json', newer));
    assert.equal(heard, 1);
    // A file that is there loads.
    assert.deepEqual(await fetchData('ok.json', respond({ '/data/ok.json': [200, { a: 1 }] })), { a: 1 });
  } finally { delete (globalThis as { window?: unknown }).window; }
});
