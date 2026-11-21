import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coverageOf, elapsedMs, exactPeople, finishRush, formatClock, formatCoverage, formatPeople, guessRush, isExpired, milestoneCrossed, newRush,
  pauseRush, remainingMs, resumeRush, DEFAULT_DURATION, DURATIONS, MENU_DURATIONS, rushName,
} from './cityRush.ts';

const T0 = 1_700_000_000_000;

test('a new city scores, a repeat does not, and unknown or empty guesses change nothing', () => {
  let r = newRush('CAN', 'v1', 'timed', T0);
  let o = guessRush(r, 'Toronto', 'toronto', T0 + 1000);
  assert.equal(o.outcome, 'new');
  r = o.rush;
  assert.deepEqual(r.found, ['toronto']);
  assert.deepEqual(r.foundAt, [1000]);
  o = guessRush(r, 'TORONTO', 'toronto', T0 + 2000);
  assert.equal(o.outcome, 'duplicate');
  assert.equal(o.rush, r);
  assert.equal(guessRush(r, 'Atlantis', null, T0 + 3000).outcome, 'unknown');
  assert.equal(guessRush(r, '   ', null, T0 + 3000).outcome, 'empty');
  assert.equal(r.found.length, 1);
});

test('the timed clock runs to a fixed deadline, whatever the ticks do', () => {
  const r = newRush('CAN', 'v1', 'timed', T0, 300);
  assert.equal(remainingMs(r, T0), 300_000);
  assert.equal(remainingMs(r, T0 + 299_000), 1000);
  assert.equal(remainingMs(r, T0 + 900_000), 0);
  assert.equal(isExpired(r, T0 + 299_999), false);
  assert.equal(isExpired(r, T0 + 300_000), true);
  // Pausing is for explorer runs only: a timed run keeps its deadline.
  assert.equal(pauseRush(r, T0 + 10_000), r);
  assert.equal(elapsedMs(r, T0 + 900_000), 300_000);
});

test('a guess at or after the deadline never counts, even before the run is marked done', () => {
  const r = newRush('CAN', 'v1', 'timed', T0, 300);
  assert.equal(guessRush(r, 'Toronto', 'toronto', T0 + 299_999).outcome, 'new');
  assert.equal(guessRush(r, 'Toronto', 'toronto', T0 + 300_000).outcome, 'over');
  assert.equal(guessRush(r, 'Toronto', 'toronto', T0 + 400_000).rush.found.length, 0);
});

test('a timed run noticed late (a reopened tab) ends at its deadline, not when it was noticed', () => {
  let r = guessRush(newRush('CAN', 'v1', 'timed', T0, 300), 'Toronto', 'toronto', T0 + 5000).rush;
  r = finishRush(r, T0 + 3_600_000);
  assert.equal(r.phase, 'done');
  assert.equal(r.endedAt, T0 + 300_000);
  assert.equal(elapsedMs(r, T0 + 9_999_999), 300_000);
  assert.equal(guessRush(r, 'Ottawa', 'ottawa', T0 + 1000).outcome, 'over');
  // Finishing early stops the clock where it was.
  const early = finishRush(newRush('CAN', 'v1', 'timed', T0, 300), T0 + 60_000);
  assert.equal(elapsedMs(early, T0 + 200_000), 60_000);
});

test('explorer runs have no limit and count only active time', () => {
  let r = newRush('CAN', 'v1', 'explorer', T0);
  assert.equal(remainingMs(r, T0 + 1e9), Infinity);
  assert.equal(isExpired(r, T0 + 1e9), false);
  r = pauseRush(r, T0 + 10_000);
  assert.equal(elapsedMs(r, T0 + 500_000), 10_000);
  r = resumeRush(r, T0 + 500_000);
  assert.equal(elapsedMs(r, T0 + 505_000), 15_000);
  r = finishRush(r, T0 + 510_000);
  assert.equal(elapsedMs(r, T0 + 999_000), 20_000);
});

test('coverage milestones: only the highest one a guess crosses', () => {
  assert.equal(milestoneCrossed(0, 9.9), null);
  assert.equal(milestoneCrossed(9.9, 10), 10);
  assert.equal(milestoneCrossed(10, 24), null);
  assert.equal(milestoneCrossed(5, 60), 50, 'one big city crossing 10, 25 and 50 shows 50');
  assert.equal(milestoneCrossed(89, 100), 90);
  assert.equal(milestoneCrossed(90, 100), null);
});

test('coverage is people over the findable total, and is formatted honestly', () => {
  assert.equal(coverageOf(25, 100), 25);
  assert.equal(coverageOf(5, 0), 0);
  assert.equal(coverageOf(120, 100), 100);
  assert.equal(formatCoverage(0), '0%');
  assert.equal(formatCoverage(42.84), '42.8%');
  assert.equal(formatCoverage(0.456), '0.46%');
  assert.equal(formatCoverage(0.004), '<0.01%');
  assert.equal(formatCoverage(99.97), '99.9%', 'never 100% before everyone is found');
  assert.equal(formatCoverage(100), '100%');
  assert.equal(formatPeople(2_794_356), '2.79M');
  assert.equal(formatPeople(132_485), '132K');
  assert.equal(formatPeople(950), '950');
  assert.equal(exactPeople(2_794_356), '2,794,356');
});

test('clock formatting', () => {
  assert.equal(formatClock(300_000, true), '5:00');
  assert.equal(formatClock(299_001, true), '5:00');
  assert.equal(formatClock(299_000, true), '4:59');
  assert.equal(formatClock(400, true), '0:01');
  assert.equal(formatClock(0, true), '0:00');
  assert.equal(formatClock(61_900), '1:01');
  assert.equal(formatClock(3_723_000), '1:02:03');
});

test('the menu offers Quick (3 min) and Classic (10 min, the default) with City Explorer; 5 and 20 minutes still play', () => {
  assert.deepEqual([...DURATIONS], [180, 300, 600, 1200]);
  assert.deepEqual([...MENU_DURATIONS], [180, 600]);
  assert.equal(DEFAULT_DURATION, 600);
  assert.deepEqual(DURATIONS.map(d => rushName(d * 1000)), ['Quick Rush', '5-Minute Rush', 'Classic Rush', '20-Minute Rush']);
  assert.equal(rushName(null), 'City Explorer');
  for (const d of DURATIONS) {
    const r = newRush('CAN', 'v1', 'timed', T0, d);
    assert.equal(remainingMs(r, T0), d * 1000);
    assert.equal(isExpired(r, T0 + d * 1000 - 1), false);
    assert.equal(isExpired(r, T0 + d * 1000), true);
    assert.equal(formatClock(remainingMs(r, T0), true), `${d / 60}:00`);
  }
});
