import assert from 'node:assert/strict';
import { test } from 'node:test';
import { challengeLink, challengeText, comparable, outcomeOf, parseChallenge, withoutChallenge, type Challenge } from './challengeLink.ts';

const at = (c: Challenge) => new URL(challengeLink('https://atlasxp.netlify.app', '/', c)).search;
const ok = (search: string) => { const p = parseChallenge(search); assert.ok(p && 'challenge' in p, `${search} parses`); return p.challenge; };

test('every kind of challenge survives its own link', () => {
  const all: Challenge[] = [
    { kind: 'rush', country: 'CAN', durationS: 600, target: 42.8, version: '1234-abc' },
    { kind: 'rush', country: 'USA', durationS: null, target: 12.5, version: null },
    { kind: 'round', round: 'sprint', area: 'North America', mode: 'flag', set: '195', target: 1250, version: '23-x.sc2' },
    { kind: 'regions', round: 'full', country: 'CAN', mode: 'name', target: 900, version: null },
    { kind: 'mystery', set: '200', target: 4 },
  ];
  for (const c of all) assert.deepEqual(ok(at(c)), c);
});

test('a link carries the game and the target, nothing else', () => {
  const url = challengeLink('https://atlasxp.netlify.app', '/', { kind: 'round', round: 'sprint', area: 'Europe', mode: 'find', set: '200', target: 1250, version: 'v1' });
  assert.equal(url, 'https://atlasxp.netlify.app/?play=sprint&area=europe&mode=find&set=200&beat=1250&v=v1');
  assert.equal(challengeLink('https://x.app', '/', { kind: 'rush', country: 'CAN', durationS: 180, target: 7, version: null }), 'https://x.app/?rush=CAN&t=180&beat=7.0');
});

test('the plain ?rush=CAN of earlier releases still opens City Rush, with nothing to beat', () => {
  assert.deepEqual(ok('?rush=CAN'), { kind: 'rush', country: 'CAN', durationS: null, target: null, version: null });
});

test('broken or tampered links are refused, not half-used', () => {
  for (const s of ['?rush=can', '?rush=CANADA', '?rush=CAN&t=999&beat=4', '?rush=CAN&t=600&beat=101', '?rush=CAN&t=600&beat=-1', '?rush=CAN&t=600&beat=1e3',
    '?play=sprint&area=mars&mode=find&set=200&beat=10', '?play=sprint&area=europe&mode=guess&set=200&beat=10', '?play=sprint&area=europe&mode=find&set=201&beat=10',
    '?play=sprint&area=europe&mode=find&set=200&beat=99999999', '?play=sprint&area=europe&mode=find&set=200', '?play=mystery&set=200&beat=0',
    '?play=regions-sprint&country=CAN&mode=flag&beat=10', '?play=chess', '?play=mystery&set=200&beat=<script>']) {
    const p = parseChallenge(s);
    assert.ok(p && 'invalid' in p, `${s} is refused`);
  }
  assert.equal(parseChallenge(''), null);
  assert.equal(parseChallenge('?utm_source=x'), null);
  // A malformed version is dropped (not compared), the rest kept.
  assert.equal((ok('?rush=CAN&t=600&beat=4.0&v=<x>') as { version: string | null }).version, null);
});

test('reading a link removes it from the address, keeping anything else', () => {
  assert.equal(withoutChallenge('?play=sprint&area=europe&mode=find&set=200&beat=10&v=x&utm_source=chat'), '?utm_source=chat');
  assert.equal(withoutChallenge('?rush=CAN'), '');
});

test('outcomes: more is better, except a mystery\'s guesses; a tie meets the challenge', () => {
  const r: Challenge = { kind: 'rush', country: 'CAN', durationS: 600, target: 42.8, version: null };
  assert.deepEqual(outcomeOf(r, 50.04), { verdict: 'beat', gap: 7.2 });
  assert.deepEqual(outcomeOf(r, 42.8), { verdict: 'tied', gap: 0 });
  assert.deepEqual(outcomeOf(r, 40), { verdict: 'short', gap: 2.8 });
  const m: Challenge = { kind: 'mystery', set: '200', target: 4 };
  assert.equal(outcomeOf(m, 3)!.verdict, 'beat');
  assert.equal(outcomeOf(m, 6)!.verdict, 'short');
  assert.equal(outcomeOf({ kind: 'rush', country: 'CAN', durationS: null, target: null, version: null }, 10), null);
});

test('a target set on other data is flagged as not comparable', () => {
  const r: Challenge = { kind: 'rush', country: 'CAN', durationS: 600, target: 42.8, version: 'old' };
  assert.equal(comparable(r, 'old'), true);
  assert.equal(comparable(r, 'new'), false);
  assert.equal(comparable({ ...r, version: null }, 'new'), true, 'no version given: nothing to compare against');
});

test('a challenge in words', () => {
  assert.deepEqual(challengeText({ kind: 'rush', country: 'CAN', durationS: 600, target: 42.8, version: null }, 'Canada'),
    { title: 'Classic Rush · Canada', goal: 'Beat 42.8% city population coverage in 10 minutes.' });
  assert.equal(challengeText({ kind: 'rush', country: 'CAN', durationS: null, target: 12, version: null }, 'Canada').goal, 'Beat 12.0% city population coverage.');
  assert.deepEqual(challengeText({ kind: 'round', round: 'sprint', area: 'Europe', mode: 'flag', set: '200', target: 1250, version: null }, 'Europe'),
    { title: 'Sprint · Flags · Europe', goal: 'Beat 1,250 points.' });
  assert.equal(challengeText({ kind: 'mystery', set: '195', target: 1 }, '').goal, 'Solve a mystery first try.');
});
