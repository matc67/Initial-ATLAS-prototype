// The deployment configuration as Netlify will read it: netlify.toml's headers (parsed the way the browser tests'
// server, scripts/serve-dist.ts, applies them), the Content Security Policy's allowances, and the cache rules that
// release-versioned data relies on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { headerRules, headersFor, matches } from '../scripts/serve-dist.ts';

const toml = readFileSync('netlify.toml', 'utf8');
const rules = headerRules(toml);
const csp = (headersFor(rules, '/')['Content-Security-Policy'] ?? '') as string;
const directive = (name: string) => csp.split(';').map(d => d.trim()).find(d => d.startsWith(`${name} `))?.slice(name.length + 1).split(/\s+/) ?? null;

test('netlify.toml builds the site with npm run build into dist, on Node 22', () => {
  assert.match(toml, /command = "npm run build"/);
  assert.match(toml, /publish = "dist"/);
  assert.match(toml, /NODE_VERSION = "22"/);
});

test('header patterns match as Netlify\'s do for the paths ATLAS uses', () => {
  assert.ok(matches('/*', '/'));
  assert.ok(matches('/data/*', '/data/0123456789ab/cities/CAN.json'));
  assert.ok(!matches('/data/*', '/release.json'));
  assert.ok(matches('/release.json', '/release.json'));
});

test('every page gets the security headers and a Content Security Policy', () => {
  const h = headersFor(rules, '/');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.ok(csp, 'a Content-Security-Policy header');
});

test('the policy allows what ATLAS needs and nothing it does not', () => {
  assert.deepEqual(directive('default-src'), ["'self'"]);
  assert.deepEqual(directive('script-src'), ["'self'"], 'no inline or eval scripts');
  assert.deepEqual(directive('style-src'), ["'self'", 'https://fonts.googleapis.com'], 'no inline styles');
  assert.deepEqual(directive('font-src'), ['https://fonts.gstatic.com']);
  assert.deepEqual(directive('connect-src'), ["'self'"], 'data comes only from this site');
  assert.deepEqual(directive('worker-src'), ['blob:'], 'MapLibre runs its worker from a blob: URL');
  assert.deepEqual(directive('object-src'), ["'none'"]);
  assert.deepEqual(directive('frame-ancestors'), ["'none'"]);
  assert.ok(!/unsafe-(inline|eval)/.test(csp));
  // The page itself loads only what the policy allows.
  const html = readFileSync('index.html', 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) {
    const host = new URL(url).origin;
    assert.ok(csp.includes(host), `${host} is allowed by the policy`);
  }
});

test('release data is cached for good, release.json never', () => {
  assert.match(headersFor(rules, '/data/0123456789ab/countries.topo.json')['Cache-Control'], /immutable/);
  assert.equal(headersFor(rules, '/release.json')['Cache-Control'], 'no-cache');
  assert.match(headersFor(rules, '/assets/index-abc.js')['Cache-Control'], /immutable/);
});
