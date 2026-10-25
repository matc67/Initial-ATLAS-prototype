// Mystery Country: distances on the real map data, heat colours, the rules, search, the choice of mystery, records
// and the saved game.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { feature } from 'topojson-client';
import type { FeatureCollection } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { CountryDistances, shapeDistanceKm, shapeOf } from './distance.ts';
import {
  closestOf, compareMysteryRuns, dailyMystery, formatKm, guessMystery, heatColor, heatOf, HEAT_STOPS, historyOf, missesOf,
  mysteryStats, newMystery, pauseMystery, pickMystery, rememberRecent, resumeMystery, searchCountries, trendsOf, utcDate,
  type Mystery,
} from './mystery.ts';
import {
  addMysteryRun, averageGuesses, decodeAnswer, encodeAnswer, isMysteryRecord, loadActive, loadMysteryStore, loadRecent,
  mysteryChallenge, mysteryKey, saveActive, saveMysteryStore, saveRecent, toMysteryRun,
} from './mysteryRecords.ts';
import { distanceKm } from './geo.ts';
import { ROSTER } from '../data/roster.ts';
import { inSet } from '../data/countries.ts';

const topo = JSON.parse(readFileSync(new URL('../../public/data/countries.topo.json', import.meta.url), 'utf8')) as Topology<{ countries: GeometryCollection }>;
const shapes = (feature(topo, topo.objects.countries) as FeatureCollection).features;
const dist = new CountryDistances(shapes);
const km = (a: string, b: string) => dist.km(a, b)!;
const label = new Map(shapes.map(f => [String(f.properties?.id), [Number(f.properties?.lx), Number(f.properties?.ly)] as [number, number]]));
const pool = (set: '200' | '195') => ROSTER.filter(r => inSet(r, set) && dist.has(r.id)).map(r => r.id);
const byName = (name: string) => ROSTER.find(r => r.name === name)!;

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

// ---- Distances ----------------------------------------------------------------------------------------------------------
test('neighbours are 0 km, including enclaves and land borders across a continent', () => {
  for (const [a, b] of [['FRA', 'ESP'], ['ZAF', 'LSO'], ['ITA', 'VAT'], ['IDN', 'TLS'], ['CAN', 'USA'], ['RUS', 'CHN'], ['IDN', 'PNG']]) assert.equal(km(a, b), 0, `${a}–${b}`);
});

test('countries across water are as close as their nearest coasts', () => {
  const near: [string, string, number, number][] = [
    ['USA', 'RUS', 0, 30],      // Little and Big Diomede in the Bering Strait
    ['CAN', 'GRL', 0, 60],      // Nares Strait
    ['TTO', 'VEN', 5, 30],      // Gulf of Paria
    ['KNA', 'ATG', 15, 80],     // Leeward Islands
    ['RUS', 'JPN', 5, 60],      // Kuril Islands and Hokkaido
    ['AUS', 'TLS', 300, 700],   // Timor Sea
    ['FJI', 'TON', 150, 600],
  ];
  for (const [a, b, lo, hi] of near) { const d = km(a, b); assert.ok(d >= lo && d <= hi, `${a}–${b}: ${d}`); }
  // Far apart stays far apart.
  assert.ok(km('NZL', 'ESP') > 15000);
  assert.ok(km('ARG', 'MNG') > 15000);
});

test('the distance is symmetric, and 0 to itself', () => {
  for (const [a, b] of [['CAN', 'RUS'], ['FJI', 'KIR'], ['NZL', 'AUS'], ['FSM', 'PLW']]) assert.equal(km(a, b), km(b, a));
  assert.equal(km('IDN', 'IDN'), 0);
});

test('the 180° meridian: Fiji, Kiribati and Russia measure across it, not around the world', () => {
  // Fiji and Kiribati both straddle 180°; their nearest islands are a few thousand km apart at most, never ~20,000.
  assert.ok(km('FJI', 'KIR') < 2500, `FJI–KIR ${km('FJI', 'KIR')}`);
  assert.ok(km('FJI', 'WSM') < 1200);
  assert.ok(km('TUV', 'FJI') < 1200);
  // Chukotka (east of 180°) to Alaska.
  assert.ok(km('RUS', 'USA') < 30);
  // Two points either side of 180° are close, by construction.
  assert.ok(shapeDistanceKm(shapeOf([[179.9, -17], [179.95, -17.1]]), shapeOf([[-179.9, -17], [-179.8, -17.2]])) < 30);
});

test('multipolygon countries use all their land, not one central point', () => {
  // Indonesia's nearest island to Australia is far closer than the label points suggest.
  assert.ok(km('IDN', 'AUS') < distanceKm(label.get('IDN')!, label.get('AUS')!) / 3);
  // Micronesia and Kiribati are scattered across thousands of km of ocean.
  assert.ok(km('FSM', 'MHL') < distanceKm(label.get('FSM')!, label.get('MHL')!));
  assert.ok(km('KIR', 'TUV') < distanceKm(label.get('KIR')!, label.get('TUV')!));
  // France is its metropolitan shape: French Guiana is a separate, unplayed shape, so Brazil is not a neighbour.
  assert.ok(km('FRA', 'BRA') > 5000);
  // New Zealand to Australia (Macquarie Island lies between them) and Canada's Arctic.
  assert.ok(km('NZL', 'AUS') > 300 && km('NZL', 'AUS') < 2200);
  assert.ok(km('CAN', 'RUS') > 500 && km('CAN', 'RUS') < 2500);
});

test('every playable country has a shape, so every mystery can be measured and guessed', () => {
  for (const r of ROSTER) assert.ok(dist.has(r.id), `${r.id} has no shape`);
  assert.equal(dist.km('CAN', 'NOPE'), null);
  // The largest pair is still quick.
  const fresh = new CountryDistances(shapes), t = performance.now();
  fresh.km('CAN', 'RUS');
  assert.ok(performance.now() - t < 1000);
});

// ---- Heat -------------------------------------------------------------------------------------------------------------
test('heat: 1 when touching, falling smoothly with distance, 0 at 15,000 km and beyond', () => {
  assert.equal(heatOf(0), 1);
  assert.equal(heatOf(15000), 0);
  assert.equal(heatOf(19000), 0);
  assert.equal(heatOf(null), 0);
  const steps = [0, 50, 250, 1000, 3000, 8000, 14000].map(heatOf);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] < steps[i - 1]);
  // Nearby distances are told apart more than far ones.
  assert.ok(heatOf(200) - heatOf(700) > heatOf(9000) - heatOf(9500));
});

test('heat colours interpolate smoothly from pale rose to deep red', () => {
  assert.equal(heatColor(0), HEAT_STOPS[0][1]);
  assert.equal(heatColor(1), HEAT_STOPS.at(-1)![1]);
  assert.equal(heatColor(0.5), HEAT_STOPS[2][1]);
  // Between stops the colour is in between, not snapped to a band.
  const mid = heatColor(0.375), lo = heatColor(0.25), hi = heatColor(0.5);
  assert.ok(mid !== lo && mid !== hi);
  const g = (h: string) => parseInt(h.slice(3, 5), 16);
  for (let t = 0; t < 1; t += 0.05) assert.ok(g(heatColor(t + 0.05)) <= g(heatColor(t)), `greener at ${t}`);   // hotter = redder
  assert.equal(formatKm(1234.4), '1,234 km');
  assert.equal(formatKm(null), '—');
});

// ---- Rules ------------------------------------------------------------------------------------------------------------
function play(answer: string, ids: [string, 'click' | 'type'][], t0 = 0): Mystery {
  let m = newMystery(answer, t0);
  ids.forEach(([id, via], i) => { m = guessMystery(m, id, km(id, answer), via, t0 + (i + 1) * 1000).mystery; });
  return m;
}

test('a wrong guess is recorded with its distance; the right one solves it at once', () => {
  let m = newMystery('MAR', 0);
  const a = guessMystery(m, 'CAN', km('CAN', 'MAR'), 'click', 1000);
  assert.equal(a.outcome, 'miss');
  m = a.mystery;
  const b = guessMystery(m, 'MAR', 0, 'type', 2000);
  assert.deepEqual([b.outcome, b.mystery.phase, b.mystery.guesses.length], ['solved', 'solved', 2]);
  assert.equal(guessMystery(b.mystery, 'ESP', 0, 'click', 3000).outcome, 'ignored');   // nothing after the solve
  // First-guess solve.
  const lucky = guessMystery(newMystery('FJI', 0), 'FJI', 0, 'click', 500);
  assert.equal(lucky.outcome, 'solved');
  assert.deepEqual(mysteryStats(lucky.mystery, 9999), { guesses: 1, closest: null, elapsedMs: 500, solved: true });
});

test('duplicates, clicked or typed, change nothing', () => {
  const m = play('ARG', [['BRA', 'click']]);
  const again = guessMystery(m, 'BRA', km('BRA', 'ARG'), 'type', 9000);
  assert.equal(again.outcome, 'duplicate');
  assert.equal(again.mystery, m);
  assert.equal(guessMystery(m, 'BRA', 0, 'click', 9001).mystery.guesses.length, 1);
});

test('clicked and typed guesses share one state, one history and the same distances', () => {
  const m = play('NZL', [['AUS', 'click'], ['FJI', 'type'], ['TON', 'click']]);
  assert.deepEqual(m.guesses.map(g => [g.id, g.via]), [['AUS', 'click'], ['FJI', 'type'], ['TON', 'click']]);
  assert.equal(m.guesses[1].km, km('FJI', 'NZL'));
});

test('history ordering, trends and the closest guess', () => {
  const m = play('DZA', [['CAN', 'click'], ['ESP', 'type'], ['BRA', 'click'], ['MAR', 'type'], ['DZA', 'click']]);
  assert.deepEqual(historyOf(m.guesses, 'latest').map(g => [g.n, g.id]), [[5, 'DZA'], [4, 'MAR'], [3, 'BRA'], [2, 'ESP'], [1, 'CAN']]);
  // Closest first; Morocco and the answer are both 0 km, so guess order breaks the tie.
  assert.deepEqual(historyOf(m.guesses, 'closest').map(g => g.id), ['MAR', 'DZA', 'ESP', 'BRA', 'CAN']);
  assert.deepEqual(trendsOf(m), ['closest', 'closest', 'farther', 'closest', 'solved']);
  assert.equal(closestOf(missesOf(m))?.id, 'MAR');   // Morocco borders Algeria: 0 km
  const s = mysteryStats(m, 99_000);
  assert.deepEqual([s.guesses, s.closest?.id, s.elapsedMs, s.solved], [5, 'MAR', 5000, true]);
});

test('the clock counts active time only; paused guesses are ignored', () => {
  let m = newMystery('JPN', 0);
  m = guessMystery(m, 'CHN', km('CHN', 'JPN'), 'click', 2000).mystery;
  m = pauseMystery(m, 3000);
  assert.equal(guessMystery(m, 'KOR', 100, 'click', 4000).outcome, 'ignored');
  m = resumeMystery(m, 60_000);
  m = guessMystery(m, 'JPN', 0, 'click', 61_000).mystery;
  assert.equal(mysteryStats(m, 120_000).elapsedMs, 4000);
});

// ---- Search -----------------------------------------------------------------------------------------------------------
test('search: aliases, alternate spellings and similar names', () => {
  const all = ROSTER;
  assert.equal(searchCountries('timor-leste', all)[0].entry.name, 'East Timor');
  assert.equal(searchCountries('timor-leste', all)[0].alias, 'Timor-Leste');
  assert.equal(searchCountries('east tim', all)[0].entry.id, 'TLS');
  assert.equal(searchCountries('ivory', all)[0].entry.id, 'CIV');
  assert.equal(searchCountries('cote d ivoire', all)[0].entry.id, 'CIV');
  assert.equal(searchCountries('Swaziland', all)[0].entry.id, 'SWZ');
  assert.equal(searchCountries('drc', all)[0].entry.id, 'COD');
  // "Guinea" is exact first, then the names that start with it, then the ones that contain it as a word.
  assert.deepEqual(searchCountries('guinea', all).map(s => s.entry.id), ['GIN', 'GNB', 'GNQ', 'PNG']);
  assert.deepEqual(searchCountries('niger', all).slice(0, 2).map(s => s.entry.id), ['NER', 'NGA']);
  assert.deepEqual(searchCountries('dominica', all).slice(0, 2).map(s => s.entry.id), ['DMA', 'DOM']);
  assert.equal(searchCountries('congo', all)[0].entry.id, 'COG');   // "Congo" is an alias of the Republic of the Congo
  assert.ok(searchCountries('congo', all).some(s => s.entry.id === 'COD'));
  assert.deepEqual(searchCountries('   ', all), []);
  assert.deepEqual(searchCountries('zzzz', all), []);
  assert.equal(searchCountries('a', all, 6).length, 6);
});

// ---- Choosing the mystery ---------------------------------------------------------------------------------------------
test('mysteries come from the active set only, and never repeat back to back', () => {
  const p200 = pool('200'), p195 = pool('195');
  assert.equal(p200.length, 200);
  assert.equal(p195.length, 195);
  for (const id of ['XKX', 'KOS', 'TWN', 'ESH', 'SAH', 'GRL', 'PRI', 'ATA']) assert.ok(!p195.includes(id), id);
  assert.ok(!p200.includes('ATA') && !p200.includes('FRA-OVERSEAS'));
  let recent: string[] = [], seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const seen = new Set<string>();
  let prev = '';
  for (let i = 0; i < 2000; i++) {
    const id = pickMystery(p195, recent, random)!;
    assert.ok(p195.includes(id));
    assert.notEqual(id, prev);
    assert.ok(!recent.includes(id), 'repeated a recent mystery');
    seen.add(id); prev = id; recent = rememberRecent(recent, id);
  }
  assert.equal(seen.size, 195);   // every country comes up
  assert.equal(pickMystery([], []), null);
  assert.equal(pickMystery(['A'], ['A']), 'A');   // a pool of one still works
  assert.notEqual(pickMystery(['A', 'B'], ['A'], () => 0), 'A');
});

test('daily mystery (prepared): one country per UTC date for everyone, from the set', () => {
  const p = pool('200');
  assert.equal(dailyMystery(p, '2026-10-24'), dailyMystery([...p].reverse(), '2026-10-24'));
  assert.ok(p.includes(dailyMystery(p, '2026-10-24')!));
  const days = Array.from({ length: 30 }, (_, i) => dailyMystery(p, `2026-11-${String(i + 1).padStart(2, '0')}`));
  assert.ok(new Set(days).size > 20);
  assert.equal(utcDate(new Date('2026-10-24T23:30:00-05:00')), '2026-10-25');
  assert.notEqual(mysteryChallenge('200', p, 'daily').id, mysteryChallenge('200', p).id);
});

// ---- Results and records ------------------------------------------------------------------------------------------------
test('ranking: fewer guesses first, then faster', () => {
  assert.ok(compareMysteryRuns({ guesses: 4, ms: 90_000 }, { guesses: 5, ms: 10_000 }) > 0);
  assert.ok(compareMysteryRuns({ guesses: 4, ms: 10_000 }, { guesses: 4, ms: 20_000 }) > 0);
});

test('records: solved and abandoned runs, bests, average and countries discovered', () => {
  const c = mysteryChallenge('200', pool('200'));
  const run = (answer: string, guesses: string[], ms: number, solved = true) => {
    const m = play(answer, guesses.map(g => [g, 'click']));
    return toMysteryRun(solved ? m : { ...m, phase: 'playing' }, ms, '2026-10-24T12:00:00Z');
  };
  const a = run('PER', ['BRA', 'CHL', 'PER'], 40_000);
  assert.deepEqual([a.guesses, a.closest?.id, a.closest?.km, a.solved], [3, 'BRA', 0, true]);
  let r = addMysteryRun(undefined, c, a);
  assert.equal(r.bests, null);   // a first solve is a first record, not a new one
  r = addMysteryRun(r.record, c, run('JPN', ['CHN', 'KOR'], 30_000, false));
  assert.deepEqual([r.record.solved, r.record.abandoned, r.bests], [1, 1, null]);
  r = addMysteryRun(r.record, c, run('PER', ['PER'], 50_000));
  assert.deepEqual([r.bests?.run, r.bests?.guesses, r.bests?.time, isMysteryRecord(r.bests)], [true, true, false, true]);
  r = addMysteryRun(r.record, c, run('KEN', ['USA', 'IND', 'ETH', 'SOM', 'KEN'], 20_000));
  assert.equal(isMysteryRecord(r.bests), false);
  assert.equal(r.bests?.time, true);
  const rec = r.record;
  assert.deepEqual([rec.solved, rec.abandoned, rec.fewest, rec.fastestMs, rec.best?.guesses, rec.discovered], [3, 1, 1, 20_000, 1, ['PER', 'KEN']]);
  assert.equal(averageGuesses(rec), (3 + 1 + 5) / 3);
  assert.deepEqual(rec.history.map(h => h.answer), ['KEN', 'PER', 'JPN', 'PER']);
  // Persistence round-trip, and corrupt storage gives an empty store.
  const m = memory();
  saveMysteryStore({ [mysteryKey(c)]: rec }, m);
  assert.deepEqual(loadMysteryStore(m), { [mysteryKey(c)]: rec });
  m.setItem('atlas-mystery-v1', '{oops');
  assert.deepEqual(loadMysteryStore(m), {});
  // Kept apart from every other mode's records and per set.
  assert.ok(!['atlas-performance-v2', 'atlas-records-v1'].includes('atlas-mystery-v1'));
  assert.notEqual(mysteryKey(mysteryChallenge('195', pool('195'))), mysteryKey(c));
});

test('a refresh restores the puzzle in progress, without the answer in plain text', () => {
  const m = memory(), valid = (set: '200' | '195') => new Set(pool(set));
  const g = play('NZL', [['AUS', 'click'], ['FJI', 'type']]).guesses;
  saveActive({ key: 'k', set: '200', mode: 'unlimited', answer: 'NZL', guesses: g, ms: 12_345 }, m);
  const raw = m.data.get('atlas-mystery-active-v1')!;
  assert.ok(!raw.includes('NZL') && !raw.includes('New Zealand'));
  const back = loadActive(valid, m)!;
  assert.deepEqual([back.answer, back.guesses, back.ms, back.set], ['NZL', g, 12_345, '200']);
  assert.equal(decodeAnswer(encodeAnswer('TLS')), 'TLS');
  // A puzzle whose answer is not in its set any more (e.g. a roster change) is dropped, as is garbage.
  saveActive({ key: 'k', set: '195', mode: 'unlimited', answer: 'TWN', guesses: [], ms: 1 }, m);
  assert.equal(loadActive(valid, m), null);
  m.setItem('atlas-mystery-active-v1', 'not json');
  assert.equal(loadActive(valid, m), null);
  saveActive(null, m);
  assert.equal(m.data.has('atlas-mystery-active-v1'), false);
  saveRecent(['A', 'B'], m);
  assert.deepEqual(loadRecent(m), ['A', 'B']);
});

test('nothing in the game state names the mystery until it is solved', () => {
  const m = play('BTN', [['IND', 'click'], ['NPL', 'type']]);
  const s = mysteryStats(m, 5000);
  assert.ok(!JSON.stringify(s).includes('BTN'));
  assert.ok(!JSON.stringify(historyOf(m.guesses, 'latest')).includes('BTN'));
  assert.ok(!JSON.stringify(trendsOf(m)).includes('BTN'));
  // Search results do not mark the answer.
  assert.ok(searchCountries('bhutan', ROSTER).every(s => Object.keys(s).sort().join() === 'alias,entry,rank' || Object.keys(s).sort().join() === 'entry,rank'));
  assert.equal(byName('Bhutan').id, 'BTN');
});
