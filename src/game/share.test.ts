import assert from 'node:assert/strict';
import { test } from 'node:test';
import { challengeFrom, challengeUrl, flagEmoji, shareText } from './share.ts';

test('flag emoji from ISO codes', () => {
  assert.equal(flagEmoji('CA'), '🇨🇦');
  assert.equal(flagEmoji('gb'), '🇬🇧');
  assert.equal(flagEmoji('XKX'), '');
});

test('the challenge link is the site’s own address with the country, and nothing else', () => {
  assert.equal(challengeUrl('https://atlas.example', '/', 'CAN'), 'https://atlas.example/?rush=CAN');
  assert.equal(challengeUrl('http://localhost:5173', '/atlas', 'USA'), 'http://localhost:5173/atlas/?rush=USA');
  assert.equal(challengeFrom('?rush=CAN'), 'CAN');
  assert.equal(challengeFrom('?rush=can'), null);
  assert.equal(challengeFrom('?rush=<script>'), null);
  assert.equal(challengeFrom(''), null);
});

test('timed share text leads with coverage, then cities and time', () => {
  const text = shareText({ countryName: 'Canada', iso2: 'CA', mode: 'timed', coverage: 42.84, count: 38, durationMs: 300_000, elapsedMs: 300_000, url: 'https://atlas.example/?rush=CAN' });
  assert.equal(text, 'ATLAS · CITY RUSH\nCanada 🇨🇦\n42.8% City Population Coverage\n38 cities discovered\nClassic Rush · 5 minutes\n\nThink you can beat me?\nhttps://atlas.example/?rush=CAN');
  assert.match(shareText({ countryName: 'Canada', iso2: 'CA', mode: 'timed', coverage: 1, count: 1, durationMs: 300_000, elapsedMs: 300_000, url: 'u' }), /\n1 city discovered\n/);
});

test('explorer share text gives coverage, count and time, never the names', () => {
  const text = shareText({ countryName: 'Japan', iso2: 'JP', mode: 'explorer', coverage: 61.25, count: 1203, durationMs: null, elapsedMs: 3_723_000, url: 'u' });
  assert.equal(text, 'ATLAS · CITY EXPLORER\nJapan 🇯🇵\n61.3% City Population Coverage\n1,203 cities discovered\n1:02:03 exploring\n\nHow much can you name?\nu');
});

test('the share text names the duration played', () => {
  const t = (sec: number) => shareText({ countryName: 'Canada', iso2: 'CA', mode: 'timed', coverage: 10, count: 5, durationMs: sec * 1000, elapsedMs: 0, url: 'u' });
  assert.match(t(180), /Quick Rush · 3 minutes/);
  assert.match(t(600), /Extended Rush · 10 minutes/);
  assert.match(t(1200), /Marathon Rush · 20 minutes/);
});
