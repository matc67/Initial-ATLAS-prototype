import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPRINT_SIZE } from './challenges.ts';
import { helpTopic } from './helpTopics.ts';

const round = { kind: 'round' as const, sprint: true, unit: 'country', units: 'countries', scope: 'Europe', regions: false };

test('each round mode explains its own action', () => {
  assert.match(helpTopic({ ...round, mode: 'find' }).rules[0], /^Find it: we name a country; click it/);
  assert.match(helpTopic({ ...round, mode: 'name' }).rules[0], /^Name it: a country lights up in gold; type its name/);
  assert.match(helpTopic({ ...round, mode: 'flag' }).rules[0], /^Flags: we show a flag; click its country/);
});

test('a Sprint and a Full challenge say how long they are', () => {
  const s = helpTopic({ ...round, mode: 'find' }), f = helpTopic({ ...round, mode: 'find', sprint: false });
  assert.equal(s.title, 'Sprint');
  assert.ok(s.rules.includes(`Sprint: ${SPRINT_SIZE} countries from Europe.`));
  assert.equal(f.title, 'Full challenge');
  assert.ok(f.rules.includes('Full challenge: every country in Europe, once each.'));
});

test('a Regions round uses the country\'s own words, with the right article', () => {
  const t = helpTopic({ ...round, mode: 'find', unit: 'emirate', units: 'emirates', scope: 'the United Arab Emirates', regions: true });
  assert.equal(t.title, 'Regions: emirates');
  assert.match(t.rules[0], /we name an emirate/);
  assert.ok(t.rules.includes('Sprint: 10 emirates from the United Arab Emirates.'));
});

test('rounds and mysteries say the clock pauses; a timed City Rush says it does not', () => {
  assert.ok(helpTopic({ ...round, mode: 'name' }).rules.some(r => /clock is paused while Help is open/.test(r)));
  assert.ok(helpTopic({ kind: 'mystery' }).rules.some(r => /clock is paused while Help is open/.test(r)));
  const timed = helpTopic({ kind: 'rush', mode: 'timed', durationMs: 600_000, country: 'Canada' });
  assert.equal(timed.title, 'Classic Rush · Canada');
  assert.ok(timed.rules.some(r => /clock keeps running while Help is open/.test(r)));
  const explorer = helpTopic({ kind: 'rush', mode: 'explorer', durationMs: null, country: 'Canada' });
  assert.equal(explorer.title, 'City Explorer · Canada');
  assert.ok(explorer.rules.some(r => /No clock: your map is saved/.test(r)));
});
