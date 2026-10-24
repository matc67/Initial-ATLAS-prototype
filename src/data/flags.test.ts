import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { flagUrl } from './flags.ts';
import { ROSTER, isClassic } from './roster.ts';

const file = (dir: string, iso2: string) => new URL(`../../${dir}/${iso2.toLowerCase()}.svg`, import.meta.url);
// Countries that deliberately show no flag, and why. Anything else without a flag is a bug.
const NO_FLAG: { [id: string]: string } = { SAH: 'its usual flag is the Sahrawi Republic’s, one side of the dispute' };

test('every country in both sets has a flag code, except the deliberate exceptions', () => {
  for (const set of ['195', '200'] as const) {
    for (const r of ROSTER.filter(r => set === '200' || isClassic(r))) {
      if (NO_FLAG[r.id]) { assert.equal(r.iso2, '', `${r.id} should show no flag`); continue; }
      assert.match(r.iso2, /^[A-Z]{2}$/, `${r.id} (${r.name}) has flag code “${r.iso2}”`);
    }
  }
  const codes = ROSTER.map(r => r.iso2).filter(Boolean);
  assert.equal(new Set(codes).size, codes.length, 'two countries share a flag');
});

test('every expected flag is in public/flags as a valid SVG, matching the flag-icons source', () => {
  const missing: string[] = [];
  for (const r of ROSTER.filter(r => r.iso2)) {
    const served = file('public/flags', r.iso2);
    if (!existsSync(served)) { missing.push(`${r.id}:${r.iso2}`); continue; }
    const svg = readFileSync(served, 'utf8');
    assert.match(svg, /<svg[\s>]/, `${r.iso2}.svg is not an SVG`);
    assert.match(svg, /viewBox="[\d.\s-]+"/, `${r.iso2}.svg has no viewBox, so it would not scale`);
    const source = file('node_modules/flag-icons/flags/4x3', r.iso2);
    if (existsSync(source)) assert.equal(svg, readFileSync(source, 'utf8'), `${r.iso2}.svg differs from flag-icons; run npm run data`);
  }
  assert.deepEqual(missing, [], `missing flags (run npm run data): ${missing.join(' ')}`);
});

test('flag URLs are lower-case and follow the base path in development and production', () => {
  assert.equal(flagUrl('FR', '/'), '/flags/fr.svg');
  assert.equal(flagUrl('XK', '/atlas/'), '/atlas/flags/xk.svg');
  assert.equal(flagUrl('PS', '/atlas'), '/atlas/flags/ps.svg');
  // Built files: when a production build exists, it carries every flag too (Vite copies public/ into dist/).
  if (existsSync(new URL('../../dist/index.html', import.meta.url))) {
    for (const r of ROSTER.filter(r => r.iso2)) assert.ok(existsSync(file('dist/flags', r.iso2)), `dist is missing ${r.iso2}.svg`);
  }
});
