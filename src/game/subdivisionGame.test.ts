// Subdivision gameplay (Phase 3): the country round engine, scoring and records reused for a country's first-level
// subdivisions, from its data alone. Uses the real Canada data in public/data/admin1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SPRINT_SIZE, subdivisionChallenge, subdivisionKinds } from './challenges.ts';
import { FEEDBACK } from './feedback.ts';
import { nameMatches, normalize } from './names.ts';
import { addRun, loadPerformance, loadSubdivisionRecords, perfKey, saveSubdivisionRecords, savePerformance, SUBDIVISION_RECORDS_KEY, toGameRun } from './records.ts';
import { guess, maxScoreFor, newRound, next, reveal, statsOf, typedGuess, type Round } from './scoring.ts';
import { CATALOG, overview } from './stats.ts';
import { decodeSubdivisions, subdivisionPlayables, type SubdivisionIndex } from '../data/subdivisions.ts';
import { resolveSubPick, TINY_UNIT_PX } from '../map/pick.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
const index = read('admin1/index.json') as SubdivisionIndex;
const can = decodeSubdivisions('CAN', index.countries.CAN, read(index.countries.CAN.file));
const places = subdivisionPlayables(can);
const ids = can.units.features.map(u => u.properties.id);
const id = (code: string) => `admin1:CAN:${code}`;

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}
// Plays a whole round: plan[i] = n wrong clicks before the right one, or 'hint' for Show me.
function play(queue: string[], plan: (number | 'hint')[] = []): { round: Round; now: number } {
  let r = newRound(queue, 0), t = 0;
  queue.forEach((target, i) => {
    const p = plan[i] ?? 0;
    if (p === 'hint') { r = next(reveal(r, (t += 1000)), t); return; }
    for (let k = 0; k < p; k++) r = guess(r, queue.find(x => x !== target && !r.answers.some(a => a.id === x))!, (t += 1000)).round;
    r = guess(r, target, (t += 1000)).round;
  });
  return { round: r, now: t };
}

test('challenge sizes: a Sprint only with 10 or more subdivisions; otherwise the full challenge alone', () => {
  assert.deepEqual(subdivisionKinds(13), ['sprint', 'full']);
  assert.deepEqual(subdivisionKinds(SPRINT_SIZE), ['sprint', 'full']);
  assert.deepEqual(subdivisionKinds(9), ['full']);
  assert.deepEqual(subdivisionKinds(3), ['full']);
  assert.throws(() => subdivisionChallenge('XYZ', 'Small', 'find', 'sprint', ['a', 'b', 'c']), /too few/);
});

test('Canada challenges: Find and Name the Region, full (13) and Sprint (10), apart from every country challenge', () => {
  const all = (['find', 'name'] as const).flatMap(m => subdivisionKinds(ids.length).map(k => subdivisionChallenge('CAN', 'Canada', m, k, ids)));
  assert.deepEqual(all.map(c => [c.id, c.kind, c.size, c.interaction]), [
    ['can-admin1-sprint-find', 'sprint', 10, 'map-click'], ['can-admin1-find', 'full', 13, 'map-click'],
    ['can-admin1-sprint-name', 'sprint', 10, 'text-entry'], ['can-admin1-name', 'full', 13, 'text-entry'],
  ]);
  for (const c of all) { assert.equal(c.entityType, 'admin1'); assert.equal(c.scopeId, 'country:CAN'); }
  const countryKeys = new Set(CATALOG.map(c => c.key)), countryIds = new Set(CATALOG.map(c => c.id));
  for (const c of all) { assert.ok(!countryIds.has(c.id)); assert.ok(!countryKeys.has(perfKey(c))); }
  // The version follows the list of subdivisions, not its order, and changes with it.
  assert.equal(subdivisionChallenge('CAN', 'x', 'find', 'full', [...ids].reverse()).version, all[1].version);
  assert.notEqual(subdivisionChallenge('CAN', 'x', 'find', 'full', ids.slice(1)).version, all[1].version);
});

test('the country engine scores subdivisions the same way: points, streak bonuses, mistakes, Show me', () => {
  const perfect = play(ids);
  const s = statsOf(perfect.round, perfect.now);
  assert.deepEqual([s.base, s.bonus, s.score, s.maxScore, s.longestStreak, s.perfect], [1300, 400, 1700, maxScoreFor(13), 13, true]);
  const sprint = play(ids.slice(0, SPRINT_SIZE));
  assert.equal(statsOf(sprint.round, sprint.now).score, 1400);
  // A wrong click, then Show me: 100×11 + 50 + 0, streaks 1-2-0 (wrong) … and Show me breaks the streak again.
  const mixed = play(ids, [0, 0, 1, 0, 0, 'hint']);
  const m = statsOf(mixed.round, mixed.now);
  assert.deepEqual([m.base, m.totalMistakes, m.hintsUsed, m.firstTryCorrect, m.perfect], [1150, 1, 1, 11, false]);
  assert.equal(mixed.round.answers[2].wrongIds.length, 1);   // the wrong subdivision is recorded by id, for the review
});

test('subdivision records are kept apart from country records, and existing country data is untouched', () => {
  const storage = memory();
  // An existing country record.
  const countryStore = { 'africa-countries-find@x': addRun(undefined, { id: 'r1', challengeId: 'africa-countries-find', version: 'x', scoring: 2, completedAt: '2026-10-01T00:00:00Z', activeTimeMs: 1000, results: [] }).performance };
  savePerformance(countryStore, storage);
  const before = storage.data.get('atlas-performance-v2');
  // A Canada run saved the way the app does it.
  const c = subdivisionChallenge('CAN', 'Canada', 'find', 'full', ids);
  const { round, now } = play(ids);
  const subStore = { [perfKey(c)]: addRun(undefined, toGameRun(round, c, now)).performance };
  saveSubdivisionRecords(subStore, storage);
  assert.equal(storage.data.get('atlas-performance-v2'), before);            // country data byte-for-byte the same
  assert.ok(storage.data.has(SUBDIVISION_RECORDS_KEY));
  assert.deepEqual(Object.keys(loadPerformance(storage)), Object.keys(countryStore));
  assert.deepEqual(Object.keys(loadSubdivisionRecords(storage)), [perfKey(c)]);
  assert.equal(loadSubdivisionRecords(storage)[perfKey(c)].bestScore, 1700);
  // Country stats never count subdivision runs.
  assert.equal(overview(loadPerformance(storage)).games, 1);
  // Corrupt or missing subdivision data gives empty records, not an error.
  storage.setItem(SUBDIVISION_RECORDS_KEY, '{oops');
  assert.deepEqual(loadSubdivisionRecords(storage), {});
  assert.deepEqual(loadSubdivisionRecords(null), {});
});

test('Name the Region: names, French names and short forms, folded for case, spaces and accents; never ambiguous', () => {
  const p = (code: string) => places.get(id(code))!;
  for (const typed of ['Quebec', 'québec', '  QUEBEC ', 'Québec']) assert.ok(nameMatches(p('QC'), typed), typed);
  assert.ok(nameMatches(p('PE'), 'PEI'));
  assert.ok(nameMatches(p('PE'), 'prince edward island'));
  assert.ok(nameMatches(p('PE'), 'Ile-du-Prince-Edouard'));
  assert.ok(nameMatches(p('NL'), 'Terre-Neuve-et-Labrador'));
  assert.ok(nameMatches(p('NT'), 'NWT'));
  assert.ok(nameMatches(p('BC'), 'Colombie-Britannique'));
  for (const wrong of ['Newfoundland', 'Labrador', 'Ont', 'Quebec City', 'Upper Canada', '']) assert.ok(![...places.values()].some(u => nameMatches(u, wrong)), wrong);
  // Every name and alias matches exactly one subdivision.
  for (const u of places.values()) for (const n of [u.name, ...u.aliases]) assert.deepEqual([...places.values()].filter(v => nameMatches(v, n)).map(v => v.id), [u.id], n);
  // A typed wrong answer is recorded by its text, like countries.
  const r = typedGuess(newRound([id('QC')], 0), 'Ontario', nameMatches(p('QC'), 'Ontario'), 1000);
  assert.deepEqual([r.outcome, r.round.wrong], ['wrong', ['typed:ontario']]);
});

test('feedback in a subdivision round never names what was clicked', () => {
  const messages = [FEEDBACK.wrong, FEEDBACK.tooClose, FEEDBACK.units.ocean(can.meta.terms.singular), FEEDBACK.units.outside('Canada')];
  assert.equal(FEEDBACK.units.ocean('province or territory'), 'That was the ocean. Click a province or territory.');
  const names = [...places.values()].flatMap(u => [u.name, ...u.aliases]).map(normalize);
  for (const m of messages) assert.ok(!names.some(n => ` ${normalize(m)} `.includes(` ${n} `)), m);
});

test('tiny subdivisions: a click that could mean one is too close to call, decided by the map alone', () => {
  const NS = id('NS'), PE = id('PE'), NB = id('NB');
  // On land, with only large units in reach: exactly the unit under the pointer.
  assert.deepEqual(resolveSubPick({ direct: NS, near: [{ id: NS, sizePx: 60 }, { id: NB, sizePx: 50 }], overOtherLand: false }), { kind: 'country', id: NS });
  // Prince Edward Island a couple of pixels wide beside the click (all of Canada on a phone): zoom in, no guess.
  assert.deepEqual(resolveSubPick({ direct: NS, near: [{ id: NS, sizePx: 6 }, { id: PE, sizePx: 2 }], overOtherLand: false }), { kind: 'ambiguous', ids: [NS, PE].sort() });
  // Tapping PEI itself still counts for PEI when nothing else tiny is in reach.
  assert.deepEqual(resolveSubPick({ direct: PE, near: [{ id: PE, sizePx: 2 }, { id: NS, sizePx: 40 }], overOtherLand: false }), { kind: 'country', id: PE });
  // Zoomed in, PEI is large: no assist needed.
  assert.deepEqual(resolveSubPick({ direct: NS, near: [{ id: NS, sizePx: 300 }, { id: PE, sizePx: TINY_UNIT_PX + 40 }], overOtherLand: false }), { kind: 'country', id: NS });
  // Over water: one unit in reach is that unit; several are too close to call; another country's land is never a unit.
  assert.deepEqual(resolveSubPick({ direct: null, near: [{ id: PE, sizePx: 2 }], overOtherLand: false }), { kind: 'country', id: PE });
  assert.equal(resolveSubPick({ direct: null, near: [{ id: PE, sizePx: 2 }, { id: NS, sizePx: 8 }], overOtherLand: false }).kind, 'ambiguous');
  assert.equal(resolveSubPick({ direct: null, near: [{ id: NB, sizePx: 30 }], overOtherLand: true }).kind, 'none');
  assert.equal(resolveSubPick({ direct: null, near: [], overOtherLand: false }).kind, 'none');
});

test('every Canadian subdivision is a round target with a name, a point on its land and a framing', () => {
  assert.equal(places.size, 13);
  for (const p of places.values()) {
    assert.ok(p.name && p.frame && p.frame.radiusKm > 0, p.id);
    assert.ok(Math.abs(p.center[0]) <= 180 && Math.abs(p.center[1]) <= 90);
  }
  // Prince Edward Island's framing is small enough to show it clearly in Name the Region.
  assert.ok(places.get(id('PE'))!.frame!.radiusKm < 200);
});
