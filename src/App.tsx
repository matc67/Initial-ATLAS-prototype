import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import Starfield from './components/Starfield';
import ChallengePicker from './components/ChallengePicker';
import Hud, { type HudFx } from './components/Hud';
import { MysteryHistory, MysteryHud, MysteryResults, MysterySearch } from './components/Mystery';
import ProgressPanel from './components/ProgressPanel';
import RegionNav from './components/RegionNav';
import { Burst, ReviewList, ScoreBreakdown, SprintResults } from './components/Results';
import { Flag, Icon } from './components/ui';
import { AMERICAS, AREA_CAMERA, SET_LABEL, STATUS_LABEL, TABS, inArea, inSet, indexCountries, tabOf, type Area, type Country, type CountrySet } from './data/countries';
import type { LngLat } from './game/geo';
import { preloadFlags } from './data/flags';
import { capitalsOf, loadPlaces, lngLat, type City, type PlacesFile } from './data/places';
import { SPRINT_SIZE, countryChallenge, sprintChallenge, subdivisionChallenge, subdivisionKinds, type ChallengeKind, type GameMode, type GeographyChallenge } from './game/challenges';
import type { Playable } from './game/playable';
import { answerEvent, FEEDBACK, type AnswerEvent } from './game/feedback';
import { nameMatches } from './game/names';
import { addRun, loadPerformance, loadSubdivisionRecords, perfKey, saveSubdivisionRecords, savePerformance, toGameRun, type GameRun } from './game/records';
import { pickRound } from './game/round';
import { bestsOf, isNewRecord, planSprint, type PersonalBests } from './game/sprint';
import {
  ATTEMPT_POINTS, LATE_POINTS, STREAK_MILESTONES, bonusesOf, elapsed, formatTime, guess as guessRound, isCompleted, isPaused, newRound, next as nextRound,
  pause, resume, reveal as revealRound, statsOf, targetOf, typedGuess,
  type Attempt, type NewBests, type Round,
} from './game/scoring';
import { AudioManager, cueFor } from './audio';
import { CountryDistances } from './game/distance';
import {
  closestOf, formatKm, guessMystery, heatColor, heatOf, missesOf, mysteryStats, newMystery, pauseMystery, pickMystery,
  rememberRecent, resumeMystery, trendsOf, type Mystery,
} from './game/mystery';
import {
  addMysteryRun, isMysteryRecord, loadActive, loadMysteryStore, loadRecent, mysteryChallenge, mysteryKey, saveActive,
  saveMysteryStore, saveRecent, toMysteryRun, type MysteryBests, type MysteryChallenge, type MysteryRecord, type MysteryRun,
} from './game/mysteryRecords';
import { ROSTER } from './data/roster';
import SubdivisionInspector from './components/SubdivisionInspector';
import { describeCount, loadSubdivisionIndex, loadSubdivisions, subdivisionPlayables, type SubdivisionIndex, type SubdivisionSet } from './data/subdivisions';
import { PACIFIC_VIEWS, type RegionView } from './map/regions';
import { COLORS, GlobeView, type Camera, type Land, type StatusMap, type Theme } from './map/GlobeView';

type View = 'explore' | 'play' | 'progress';
// A Mystery Country puzzle in the app: the rules' Mystery plus what the screen needs around it.
type MysteryGame = {
  m: Mystery; set: CountrySet; challenge: MysteryChallenge;
  held: boolean;
  message: string;                 // a neutral note: the ocean, already guessed, no such country…
  order: 'latest' | 'closest';     // how the history is listed
  before: MysteryRecord | null;    // the record as it stood before this puzzle, for the results
  bests: MysteryBests | null;
};
type Mode = GameMode;
// A round in the app: the rules' Round plus what the screen needs around it.
type Game = {
  mode: Mode; area: Area; set: CountrySet;
  challenge: GeographyChallenge;
  kind: ChallengeKind;     // a Full Challenge or a 10-Country Sprint; each keeps its own records
  round: Round;
  held: boolean;           // paused with the pause button (the clock also pauses for hidden tabs, Help or other views)
  message: string;         // a neutral note: the ocean, land outside the game… never a mistake
  miss: string | null;     // after a wrong answer, until the next answer or note: '' in Find it, `Not “…”` in Name it
  fx: HudFx | null;        // the latest answer's feedback, played once by the HUD while the next question is live
  bests: NewBests | null;  // set when the run finishes
  // What the round asks for. Countries: `sub` is null and `places` is the country map. A country's first-level
  // subdivisions: `sub` is that country's data and `places` its units. The round engine sees only ids either way.
  sub: SubdivisionSet | null;
  places: Map<string, Playable>;
  before: PersonalBests | null; // the records as they stood before this run, for the results comparison
};

const FLASH_GOOD = COLORS.good, FLASH_BAD = COLORS.bad, FLASH_SELECT = '#fff6dc';
// A wrong guess flashes red only briefly (the country is never recoloured); the player can click again at once.
const WRONG_FLASH_MS = 320;
// Flags fetched ahead of the current question (all 200 together are 2 MB, too much to fetch at once on a phone).
const FLAGS_AHEAD = 4;
const isMobile = () => window.innerWidth <= 760;
// Area zoom levels are tuned for a 1440×900 window; smaller screens zoom out so the whole area still fits.
const fit = (c: Camera): Camera => ({ ...c, zoom: c.zoom + Math.max(-1.1, Math.min(0.3, Math.log2(Math.min(window.innerWidth, window.innerHeight * 1.3) / 1150))) });
const areaTitle = (a: Area) => (a === 'World' ? 'The World' : a);
const areaShort = (a: Area) => (a === 'World' ? 'World' : a);
const SET_KEY = 'atlas-country-set';
const loadSet = (): CountrySet => { try { return localStorage.getItem(SET_KEY) === '195' ? '195' : '200'; } catch { return '200'; } };
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);
// How one country went in a recorded run, as a Progress globe status.
const runStatus = (a: Attempt): 'first' | 'retry' | 'hinted' => (a.hint ? 'hinted' : a.mistakes ? 'retry' : 'first');

export default function App() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const glowDiv = useRef<HTMLDivElement>(null);
  const shadeDiv = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeView | null>(null);
  const [countries, setCountries] = useState<Map<string, Country>>(new Map());
  const [tiny, setTiny] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('play');
  const [area, setArea] = useState<Area>('World');
  const [mode, setMode] = useState<Mode>('find');
  const [game, setGame] = useState<Game | null>(null);
  // The round as of the latest click, updated synchronously. Click and key handlers read this rather than `game`, so two
  // clicks landing before React re-renders work on the same, up-to-date round.
  const gameRef = useRef<Game | null>(null);
  const commit = (g: Game | null) => { gameRef.current = g; setGame(g); };
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLand, setSelectedLand] = useState<Land | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  const [help, setHelp] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [, setTick] = useState(0);
  const [perf, setPerf] = useState(loadPerformance);
  // Subdivision records: their own store, never mixed with country records (game/records.ts).
  const [subPerf, setSubPerf] = useState(loadSubdivisionRecords);
  // Which recorded run the Progress globe shows.
  const [runView, setRunView] = useState<'latest' | 'best'>('latest');
  // Which kind of record Progress shows: Sprints first (the arcade mode), or Full Challenges.
  const [progressKind, setProgressKind] = useState<ChallengeKind>('sprint');
  // Capitals and major cities, fetched the first time a country is opened in Explore.
  const [places, setPlaces] = useState<PlacesFile | null>(null);
  const [placesError, setPlacesError] = useState(false);
  const [countrySet, setCountrySet] = useState<CountrySet>(loadSet);
  // Arcade sounds (audio.ts): off until the player turns them on; on/off and volume are remembered. The manager is the
  // source of truth; these mirror it for the speaker button and the volume slider.
  const audio = useMemo(() => new AudioManager(), []);
  const [sound, setSound] = useState(audio.enabled);
  const [volume, setVolumeState] = useState(audio.volume);
  // Turning sound on is a click, so the browser lets audio start; a quiet click confirms it.
  const toggleSound = () => { audio.setEnabled(!audio.enabled); setSound(audio.enabled); audio.play({ kind: 'ui' }); };
  const setVolume = (v: number) => { audio.setVolume(v); setVolumeState(audio.volume); };
  const fxKey = useRef(0);
  useEffect(() => { try { localStorage.setItem(SET_KEY, countrySet); } catch { /* storage blocked: the choice lasts for this visit */ } }, [countrySet]);

  // Explore and Progress always cover all 200; rounds use the chosen set.
  const areaIds = useMemo(() => [...countries.values()].filter(c => inArea(c, area)).map(c => c.id), [countries, area]);
  const playIds = useMemo(() => areaIds.filter(id => inSet(countries.get(id)!, countrySet)), [areaIds, countries, countrySet]);
  const round = game?.round;
  const targetId = round && targetOf(round);
  const target = targetId ? game?.places.get(targetId) : undefined;
  const inRound = view === 'play' && !!round && round.phase !== 'done';
  const last = round?.answers.at(-1);
  // The full challenge for the chosen area, set and mode: what Play starts and what Progress shows records for.
  const challenge = useMemo(() => countryChallenge(area, countrySet, mode), [area, countrySet, mode]);
  const record = perf[perfKey(challenge)];
  const sprintRecord = perf[perfKey(sprintChallenge(area, countrySet, mode))];
  const progressRecord = progressKind === 'sprint' ? sprintRecord : record;
  const shownRun: GameRun | undefined = runView === 'best' ? progressRecord?.bestRun : progressRecord?.latestRun ?? progressRecord?.bestRun;
  const runResults = useMemo(() => new Map(shownRun?.results.map(a => [a.id, a]) ?? []), [shownRun]);
  // The streak bonus each country of that run earned, under the rules it was played with.
  const runBonuses = useMemo(() => {
    const b = shownRun ? bonusesOf(shownRun.results, shownRun.scoring ?? 1) : [];
    return new Map(shownRun?.results.map((a, i) => [a.id, b[i]]) ?? []);
  }, [shownRun]);

  // ---- Mystery Country state ------------------------------------------------------------------------------------------
  // Only one of a round and a mystery is ever active: starting either one ends the other.
  const distRef = useRef<CountryDistances | null>(null);
  const [mystery, setMystery] = useState<MysteryGame | null>(null);
  const mysteryRef = useRef<MysteryGame | null>(null);
  const commitMystery = (g: MysteryGame | null) => { mysteryRef.current = g; setMystery(g); };
  const [mysteryStore, setMysteryStore] = useState(loadMysteryStore);
  const [historyOpen, setHistoryOpen] = useState(false);
  const recentRef = useRef(loadRecent());
  const inMystery = view === 'play' && !!mystery;
  const mysteryPlaying = inMystery && mystery!.m.phase === 'playing';
  // Every country of the set with a shape: the possible answers, all of them guessable.
  const mysteryPool = (set: CountrySet) => [...countries.values()].filter(c => inSet(c, set) && !!distRef.current?.has(c.id)).map(c => c.id);

  // ---- Subdivisions (Phase 2: development builds only) ---------------------------------------------------------------
  // A country's first-level subdivisions on the globe, opened from Explore's country panel or with #subdivisions=CAN.
  // Production builds never load the subdivision index (import.meta.env.DEV is false there), so nothing changes for
  // players until the real Explore integration (docs/subdivisions.md, Phase 4).
  const [subIndex, setSubIndex] = useState<SubdivisionIndex | null>(null);
  const [subView, setSubView] = useState<{ set: SubdivisionSet; selected: string | null } | null>(null);
  const [subHover, setSubHover] = useState<string | null>(null);
  const subOpen = view === 'explore' && !!subView;
  // The subdivisions on the map: a subdivision round's, or the Explore view's. Never both, never another country's.
  const shownSubs = view === 'play' && game?.sub ? game.sub : view === 'explore' && subView ? subView.set : null;
  useEffect(() => { if (import.meta.env.DEV) loadSubdivisionIndex().then(setSubIndex, () => {}); }, []);

  // Map events arrive outside React, so they always call the latest handlers through this ref.
  const handlers = useRef({
    pick: (_id: string | null, _at: LngLat, _land?: Land, _ambiguous?: string[]) => {}, hover: (_id: string | null) => {},
    subPick: (_id: string | null, _at: LngLat, _ambiguous?: string[]) => {}, subHover: (_id: string | null) => {},
  });
  useEffect(() => {
    const globe = new GlobeView(mapDiv.current!, {
      onPick: (id, at, land, ambiguous) => handlers.current.pick(id, at, land, ambiguous), onHover: id => handlers.current.hover(id),
      onSubPick: (id, at, ambiguous) => handlers.current.subPick(id, at, ambiguous), onSubHover: id => handlers.current.subHover(id),
    }, { glow: glowDiv.current!, shade: shadeDiv.current! });
    globeRef.current = globe;
    // Development builds expose the map so visual checks can move the camera; production builds strip this.
    if (import.meta.env.DEV) (window as unknown as { atlasMap: unknown }).atlasMap = globe.map;
    globe.jump(fit(AREA_CAMERA.World));
    globe.load()
      .then(({ countries, tiny }) => { distRef.current = new CountryDistances(countries.features); setCountries(indexCountries(countries)); setTiny(tiny); })
      .catch(e => setError(e instanceof Error ? e.message : 'The map could not load.'));
    return () => { globe.destroy(); globeRef.current = null; };
  }, []);

  // Centre the globe in the open space: beside the side panel, or under the question card during a round.
  useEffect(() => {
    const pad = (animate: boolean) => globeRef.current?.setPadding(isMobile()
      ? { left: 0, right: 0, top: inRound ? 236 : mysteryPlaying ? 200 : 110, bottom: inRound ? 130 : mysteryPlaying ? 150 : subOpen ? window.innerHeight * 0.34 + 100 : window.innerHeight * 0.42 }
      : inRound ? { left: 100, right: 100, top: 236, bottom: 100 } : mysteryPlaying ? { left: 100, right: 360, top: 200, bottom: 110 } : { left: 110, right: 370, top: 90, bottom: 60 }, animate);
    pad(true);
    const onResize = () => pad(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [inRound, mysteryPlaying, subOpen]);
  // Frames a subdivision view once its padding is in place (this runs after the padding effect above).
  useEffect(() => {
    if (subView) globeRef.current?.frame(subView.set.meta.frame.center, subView.set.meta.frame.radiusKm, 1200);
  }, [subView?.set]);

  // The clock runs only while the round is on screen and playable: not while paused, with Help open, in another view,
  // or with the tab hidden. Elapsed time is computed from performance.now(), so it never drifts.
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const running = inRound && !game!.held && !help && visible;
  useEffect(() => {
    const g = gameRef.current;
    if (!g || g.round.phase === 'done') return;
    const now = performance.now();
    if (running && isPaused(g.round)) commit({ ...g, round: resume(g.round, now) });
    if (!running && !isPaused(g.round)) commit({ ...g, round: pause(g.round, now) });
  }, [running]);
  // The mystery's clock follows the same rules.
  const mysteryRunning = mysteryPlaying && !mystery!.held && !help && visible;
  useEffect(() => {
    const g = mysteryRef.current;
    if (!g || g.m.phase !== 'playing') return;
    const now = performance.now(), paused = g.m.clock.since === null;
    if (mysteryRunning && paused) commitMystery({ ...g, m: resumeMystery(g.m, now) });
    if (!mysteryRunning && !paused) commitMystery({ ...g, m: pauseMystery(g.m, now) });
  }, [mysteryRunning]);
  // Redraws the timer a few times a second while it runs; the value itself comes from the clock, not from this interval.
  const ticking = running || mysteryRunning;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [ticking]);

  const flyToCountry = (c: Pick<Playable, 'id' | 'center'>) => globeRef.current?.fly(fit({ center: c.center, zoom: tiny.has(c.id) ? 5.2 : 3.8 }));
  // The camera for a whole round (its area, or the country whose subdivisions are played) and for one of its targets.
  const frameScope = (g: Pick<Game, 'sub' | 'area'>) => (g.sub ? globeRef.current?.frame(g.sub.meta.frame.center, g.sub.meta.frame.radiusKm) : globeRef.current?.fly(fit(AREA_CAMERA[g.area])));
  const lookAtTarget = (p: Playable) => (p.frame ? globeRef.current?.frame(p.frame.center, Math.max(150, p.frame.radiusKm * 1.15)) : flyToCountry(p));

  function chooseArea(a: Area) {
    setArea(a);
    commit(null);
    setSelected(null);
    globeRef.current?.fly(fit(AREA_CAMERA[a]));
  }

  // Starts a Full Challenge (every country, shuffled) or a Sprint (a fresh random ten). `area` and `mode` default to the
  // current choice; Explore passes the opened country's continent to start that challenge directly.
  function startRound({ kind = 'full', area: a = area, mode: m = mode }: { kind?: ChallengeKind; area?: Area; mode?: Mode } = {}) {
    leaveMystery();
    const full = countryChallenge(a, countrySet, m);
    const pool = full.targetIds.filter(id => countries.has(id));
    let c = full, queue = pickRound(pool);
    if (kind === 'sprint') {
      const plan = planSprint(pool);
      if (!plan.ok) return;
      c = sprintChallenge(a, countrySet, m);
      queue = plan.queue;
    }
    if (!queue.length) return;
    warmFlags(queue, 0);
    setRegionView(a === 'Oceania' ? 'all' : null);
    setArea(a);
    setMode(m);
    setView('play');
    setSelected(null);
    setSelectedLand(null);
    setHelp(false);
    commit({ mode: m, area: a, set: countrySet, challenge: c, kind, round: newRound(queue, performance.now()), held: false, message: '', miss: null, fx: null, bests: null, before: null, sub: null, places: countries });
    setGuess('');
    const first = countries.get(queue[0]);
    if (m === 'name' && first) flyToCountry(first); else globeRef.current?.fly(fit(AREA_CAMERA[a]));
  }

  // Starts Find the Region or Name the Region for a country's first-level subdivisions: every one (`full`), or a Sprint of
  // SPRINT_SIZE when it has that many. The same round engine, scoring, HUD and results as countries; the challenge and its
  // records are the country's own. Started from that country's Explore panel (docs/subdivisions.md).
  function startSubdivisionRound(countryId: string, m: Mode, kind: ChallengeKind) {
    loadSubdivisions(countryId).then(set => {
      const country = countries.get(countryId), ids = set.units.features.map(u => u.properties.id);
      if (!country || !subdivisionKinds(ids.length).includes(kind)) return;
      leaveMystery();
      const terms = set.meta.terms.plural;
      const challenge = subdivisionChallenge(countryId, `${country.name}: ${terms.charAt(0).toUpperCase()}${terms.slice(1)}`, m, kind, ids);
      const queue = kind === 'sprint' ? pickRound(ids, SPRINT_SIZE) : pickRound(ids);
      const places = subdivisionPlayables(set);
      setSubView(null);
      setSubHover(null);
      setView('play');
      setSelected(countryId);
      setSelectedLand(null);
      setHelp(false);
      setRegionView(null);
      const g: Game = { mode: m, area: country.continent, set: countrySet, challenge, kind, round: newRound(queue, performance.now()), held: false, message: '', miss: null, fx: null, bests: null, before: null, sub: set, places };
      commit(g);
      setGuess('');
      if (m === 'name') lookAtTarget(places.get(queue[0])!); else frameScope(g);
    }, e => setError(e instanceof Error ? e.message : 'Subdivisions could not load.'));
  }

  // Leaving a round: a subdivision round goes back to its country in Explore, still selected, with its subdivisions shown.
  function leaveRound() {
    const g = gameRef.current;
    commit(null);
    if (!g?.sub) return;
    setView('explore');
    setSelected(g.sub.countryId);
    setSubView({ set: g.sub, selected: null });
  }

  // Fetches the flags of the next few questions ahead of time, so each one is already there when its question appears.
  const warmFlags = (queue: string[], index: number) => preloadFlags(queue.slice(index, index + FLAGS_AHEAD).map(id => countries.get(id)?.iso2));

  // Applies a new Round: moves the camera for the next question and, when the run ends, saves it and updates the
  // challenge's personal records. Everything visible changes in this one update. `event` is the answer's feedback (from
  // answerEvent), `lost` the streak a mistake or Show me just ended, `miss` the wrong-answer note.
  function apply(g: Game, r: Round, message: string, { event = null, lost = 0, miss = null }: { event?: AnswerEvent | null; lost?: number; miss?: string | null } = {}) {
    const moved = r.index !== g.round.index || (r.phase === 'done' && g.round.phase !== 'done');
    let bests: NewBests | null = g.bests, before = g.before;
    if (r.phase === 'done' && g.round.phase !== 'done') {
      frameScope(g);
      // Country runs go to the country records; subdivision runs to their own store.
      const store = g.sub ? subPerf : perf, key = perfKey(g.challenge);
      before = bestsOf(store[key]);
      const result = addRun(store[key], toGameRun(r, g.challenge, performance.now()));
      const all = { ...store, [key]: result.performance };
      if (g.sub) { setSubPerf(all); saveSubdivisionRecords(all); }
      else { setPerf(all); savePerformance(all); setRunView('latest'); setProgressKind(g.kind); }
      bests = result.bests;
      // One victory flourish for a genuine new record, however many stats improved.
      if (isNewRecord(before, result.bests)) setTimeout(() => audio.play({ kind: 'record' }), 350);
    } else if (moved && g.mode === 'name') {
      const c = g.places.get(r.queue[r.index]);
      if (c) lookAtTarget(c);
    }
    if (moved) { setGuess(''); warmFlags(r.queue, r.index + 1); }
    const fx = event || lost ? { key: ++fxKey.current, at: performance.now(), event, lost } : g.fx;
    if (event) audio.play(cueFor(event));
    commit({ ...g, round: r, message, miss, fx, bests, before });
  }

  // The globe's half of the feedback, where the answer landed: the points won, or ✕. Never a name.
  function pulseAt(at: LngLat, e: AnswerEvent) {
    if (e.kind === 'wrong') globeRef.current?.pulse(at, 'bad', '✕');
    else globeRef.current?.pulse(at, 'good', `+${e.points}`, e.bonus ? `+${e.bonus} bonus` : undefined);
  }

  handlers.current.hover = setHoverId;
  handlers.current.subHover = setSubHover;
  handlers.current.subPick = (id, at, ambiguous) => {
    const g = gameRef.current, inSubRound = view === 'play' && !!g?.sub;
    if (inSubRound && (g!.mode !== 'find' || g!.round.phase !== 'asking' || isPaused(g!.round))) return;
    // Too close to call (several units in reach, or a tiny one next to the click): zoom in so the player can choose, as
    // for tiny countries. Never a guess, never a mistake, and the same wherever the answer is.
    if (ambiguous) {
      globeRef.current?.fly({ center: at, zoom: Math.min(8, globeRef.current.map.getZoom() + 2) }, 700);
      if (inSubRound) commit({ ...g!, message: FEEDBACK.tooClose, miss: null });
      return;
    }
    if (inSubRound && id) { clickGuess(g!, id, at); return; }
    if (view === 'explore') setSubView(v => (v ? { ...v, selected: id } : v));
  };

  // Opens a country's subdivision view in Explore: the same globe, framed on the country, the rest dimmed.
  function openSubdivisions(countryId: string) {
    loadSubdivisions(countryId).then(set => {
      setView('explore');
      setSelected(countryId);
      setSelectedLand(null);
      setSubView({ set, selected: null });
    }, e => setError(e instanceof Error ? e.message : 'Subdivisions could not load.'));
  }
  // Back to Explore with the country still selected.
  function exitSubdivisions() {
    const c = subView && countries.get(subView.set.countryId);
    setSubView(null);
    setSubHover(null);
    if (c) flyToCountry(c);
  }
  handlers.current.pick = (id, at, land, ambiguous) => {
    const g = gameRef.current;
    // Rings too close together to tell apart. In a round, those that cannot be the answer (outside the round or already
    // found) are set aside; if one candidate is left it is the click. Otherwise zoom in, and never count it as a mistake.
    const mg = view === 'play' ? mysteryRef.current : null;
    if (ambiguous) {
      // In a mystery, countries already guessed and those outside the set are set aside the same way.
      const open = mg ? ambiguous.filter(c => { const k = countries.get(c); return !!k && inSet(k, mg.set) && !mg.m.guesses.some(x => x.id === c); })
        : view === 'play' && g && !g.sub ? ambiguous.filter(c => { const k = countries.get(c); return !!k && inArea(k, g.area) && inSet(k, g.set) && !isCompleted(g.round, c); }) : [];
      if (open.length === 1) id = open[0];
      else {
        globeRef.current?.fly({ center: at, zoom: Math.min(8, globeRef.current.map.getZoom() + 2) }, 700);
        if (mg?.m.phase === 'playing') commitMystery({ ...mg, message: FEEDBACK.tooClose });
        else if (view === 'play' && g && g.round.phase === 'asking') commit({ ...g, message: FEEDBACK.tooClose, miss: null });
        return;
      }
    }
    if (view !== 'play') {
      // In a subdivision view, the ocean clears the selected unit; another country leaves the view and opens that one.
      if (subView) {
        if (!id && !land) { setSubView({ ...subView, selected: null }); return; }
        setSubView(null);
        setSubHover(null);
      }
      setSelected(id);
      setSelectedLand(id ? null : land ?? null);
      if (id) globeRef.current?.flash(id, FLASH_SELECT, 600);
      return;
    }
    // Mystery Country: every click on a country in the set is a guess; the ocean and other land are only explained.
    if (mg) {
      if (mg.m.phase !== 'playing' || mg.held) return;
      if (!id) { commitMystery({ ...mg, message: land ? FEEDBACK.notInGame : FEEDBACK.ocean }); return; }
      if (!inSet(countries.get(id)!, mg.set)) { commitMystery({ ...mg, message: FEEDBACK.notInSet }); return; }
      mysteryGuess(id, 'click');
      return;
    }
    if (!g || g.mode !== 'find' || g.round.phase !== 'asking' || isPaused(g.round)) return;
    // A subdivision round: its units take clicks through subPick; anything else is outside it, never a mistake.
    if (g.sub) {
      const country = countries.get(g.sub.countryId)!;
      commit({ ...g, message: id || land ? FEEDBACK.units.outside(country.name) : FEEDBACK.units.ocean(g.sub.meta.terms.singular), miss: null });
      return;
    }
    // Clicks on the ocean, unplayable land, other areas or other country sets are explained but never count as mistakes,
    // and no message names what was clicked (see game/feedback.ts).
    if (!id) { commit({ ...g, message: land ? FEEDBACK.notInGame : FEEDBACK.ocean, miss: null }); return; }
    const clicked = countries.get(id)!;
    if (!inArea(clicked, g.area)) { commit({ ...g, message: FEEDBACK.outsideArea(areaTitle(g.area)), miss: null }); return; }
    if (!inSet(clicked, g.set)) { commit({ ...g, message: FEEDBACK.notInSet, miss: null }); return; }
    clickGuess(g, id, at);
  };

  // A click on a country or a subdivision in Find it: the same rules for both.
  function clickGuess(g: Game, id: string, at: LngLat) {
    const { round: r, outcome } = guessRound(g.round, id, performance.now());
    const event = answerEvent(g.round, r, outcome);
    if (!event) return;
    pulseAt(at, event);
    if (event.kind === 'correct') { globeRef.current?.flash(id, FLASH_GOOD, 500); apply(g, r, '', { event }); return; }
    // The wrong place is recorded by id for scoring and the results review, flashes red briefly, and stays unnamed.
    globeRef.current?.flash(id, FLASH_BAD, WRONG_FLASH_MS);
    apply(g, r, '', { event, lost: event.lostStreak, miss: '' });
  }

  function submitName(e: FormEvent) {
    e.preventDefault();
    const g = gameRef.current, t = g && g.places.get(targetOf(g.round) ?? '');
    if (!g || !t || !guess.trim()) return;
    const right = nameMatches(t, guess);
    const { round: r, outcome } = typedGuess(g.round, guess, right, performance.now());
    const event = answerEvent(g.round, r, outcome);
    if (!event) return;
    // Name it has no click: the feedback lands on the gold target, which is already shown.
    pulseAt(t.center, event);
    globeRef.current?.flash(t.id, right ? FLASH_GOOD : FLASH_BAD, right ? 500 : WRONG_FLASH_MS);
    if (event.kind === 'correct') apply(g, r, '', { event });
    else apply(g, r, '', { event, lost: event.lostStreak, miss: `Not “${guess.trim()}”` });
    setGuess('');
  }

  function reveal() {
    const g = gameRef.current, t = g && g.places.get(targetOf(g.round) ?? '');
    if (!g || !t) return;
    apply(g, revealRound(g.round, performance.now()), 'The answer is shown in gold.', { lost: g.round.streak });
    if (g.mode === 'find') lookAtTarget(t);
  }

  function next() {
    const g = gameRef.current;
    if (g?.round.phase === 'revealed') apply(g, nextRound(g.round, performance.now()), '');
  }

  // ---- Mystery Country ---------------------------------------------------------------------------------------------------
  // A new random mystery from the set, never one of the last few answers. The camera goes to the whole world, the same
  // for every answer, so it gives nothing away.
  function startMystery(set: CountrySet = countrySet) {
    leaveMystery();
    const pool = mysteryPool(set), answer = pickMystery(pool, recentRef.current);
    if (!answer) return;
    recentRef.current = rememberRecent(recentRef.current, answer);
    saveRecent(recentRef.current);
    distRef.current?.warm(answer);
    commit(null);
    setView('play');
    setSelected(null);
    setSelectedLand(null);
    setHelp(false);
    setRegionView(null);
    setHistoryOpen(false);
    commitMystery({ m: newMystery(answer, performance.now()), set, challenge: mysteryChallenge(set, pool), held: false, message: '', order: 'latest', before: null, bests: null });
    globeRef.current?.fly(fit(AREA_CAMERA.World));
  }

  // Folds a finished or abandoned puzzle into its record, and returns the record as it was before.
  function recordMystery(g: MysteryGame, run: MysteryRun) {
    const key = mysteryKey(g.challenge), prev = mysteryStore[key];
    const result = addMysteryRun(prev, g.challenge, run);
    const all = { ...mysteryStore, [key]: result.record };
    setMysteryStore(all);
    saveMysteryStore(all);
    return { prev: prev ?? null, bests: result.bests };
  }

  // Ends the mystery on screen. One left unsolved after at least one guess is recorded as abandoned.
  function leaveMystery() {
    const g = mysteryRef.current;
    if (!g) return;
    if (g.m.phase === 'playing' && g.m.guesses.length) recordMystery(g, toMysteryRun(g.m, elapsed(g.m.clock, performance.now())));
    saveActive(null);
    commitMystery(null);
  }

  // The globe moves to a typed guess (or a history entry) at the current zoom or a little closer. Never towards the answer.
  function lookAt(c: Country) {
    const z = globeRef.current?.map.getZoom() ?? 2.2;
    globeRef.current?.fly({ center: c.center, zoom: Math.max(z, tiny.has(c.id) ? 4.2 : 2.4) }, 700);
  }

  // One guess, clicked or typed: the same rules, distances and history either way.
  function mysteryGuess(id: string, via: 'click' | 'type') {
    const g = mysteryRef.current, d = distRef.current, c = countries.get(id);
    if (!g || !d || !c || g.held) return;
    const now = performance.now(), before = closestOf(missesOf(g.m))?.km ?? Infinity;
    const already = g.m.guesses.find(x => x.id === id);
    const { mystery: m, outcome } = guessMystery(g.m, id, already ? already.km : d.km(id, g.m.answer), via, now);
    if (outcome === 'ignored') return;
    if (via === 'type') lookAt(c);
    // A repeat changes nothing: no count, no sound, just a reminder of what it showed.
    if (outcome === 'duplicate') { commitMystery({ ...g, message: `Already guessed: ${c.name} · ${formatKm(already?.km ?? null)}` }); return; }
    if (outcome === 'miss') {
      const km = m.guesses.at(-1)!.km;
      globeRef.current?.flash(id, heatColor(heatOf(km)), 600);
      audio.play({ kind: 'probe', closer: km !== null && km < before });
      commitMystery({ ...g, m, message: '' });
      return;
    }
    globeRef.current?.flash(id, FLASH_GOOD, 900);
    const result = recordMystery(g, toMysteryRun(m, elapsed(m.clock, now)));
    // One sound: the victory flourish for a new personal best, otherwise the solved chime.
    audio.play({ kind: isMysteryRecord(result.bests) ? 'record' : 'solved' });
    saveActive(null);
    setHistoryOpen(false);
    commitMystery({ ...g, m, message: '', before: result.prev, bests: result.bests });
  }

  const holdMystery = (held: boolean) => { const g = mysteryRef.current; if (g) commitMystery({ ...g, held }); };
  const focusGuess = (id: string) => { const c = countries.get(id); if (c) { lookAt(c); globeRef.current?.flash(id, '#fff6dc', 700); } };

  // The puzzle in progress is saved as it changes and when the page is hidden, so a refresh carries on.
  const persistMystery = () => {
    const g = mysteryRef.current;
    if (g?.m.phase === 'playing') saveActive({ key: mysteryKey(g.challenge), set: g.set, mode: g.m.mode, answer: g.m.answer, guesses: g.m.guesses, ms: elapsed(g.m.clock, performance.now()) });
  };
  useEffect(() => { persistMystery(); }, [mystery]);
  useEffect(() => {
    window.addEventListener('pagehide', persistMystery);
    document.addEventListener('visibilitychange', persistMystery);
    return () => { window.removeEventListener('pagehide', persistMystery); document.removeEventListener('visibilitychange', persistMystery); };
  }, []);
  // After a refresh: the saved puzzle comes back once the map has loaded, with its guesses and time.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !countries.size || !distRef.current) return;
    restored.current = true;
    const a = loadActive(set => new Set(mysteryPool(set)));
    if (!a || gameRef.current) return;
    distRef.current.warm(a.answer);
    commitMystery({
      m: { answer: a.answer, mode: a.mode, guesses: a.guesses, phase: 'playing', clock: { accumulated: a.ms, since: performance.now() } },
      set: a.set, challenge: mysteryChallenge(a.set, mysteryPool(a.set), a.mode), held: false,
      message: a.guesses.length ? 'Welcome back: your mystery is just as you left it.' : '', order: 'latest', before: null, bests: null,
    });
    globeRef.current?.fly(fit(AREA_CAMERA.World));
  }, [countries]);

  // Pacific shortcuts in an Oceania round: a broad region, never the answer. Cleared when the camera moves on its own.
  const [regionView, setRegionView] = useState<string | null>(null);
  function goToRegion(v: RegionView) {
    setRegionView(v.id);
    globeRef.current?.fly(fit({ center: v.center, zoom: v.zoom }), 900);
  }

  // Same challenge, fresh run: a Sprint draws a new random ten.
  function playAgain() {
    const g = gameRef.current;
    if (g?.sub) startSubdivisionRound(g.sub.countryId, g.mode, g.kind);
    else if (g) startRound({ kind: g.kind, area: g.area, mode: g.mode });
  }

  const hold = (held: boolean) => { const g = gameRef.current; if (g) commit({ ...g, held }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelp(false);
      const typing = (e.target as HTMLElement).tagName === 'INPUT', g = gameRef.current;
      if (e.key === 'Enter' && g?.round.phase === 'revealed' && !typing) next();
      // Enter replays a finished Sprint straight away (the Play again button has focus, so this is only for clicks elsewhere).
      else if (e.key === 'Enter' && g?.round.phase === 'done' && g.kind === 'sprint' && !typing && !(e.target instanceof HTMLButtonElement)) { audio.play({ kind: 'ui' }); playAgain(); }
      // Enter starts the next mystery from the results (the Next mystery button has focus; this covers clicks elsewhere).
      else if (e.key === 'Enter' && view === 'play' && mysteryRef.current?.m.phase === 'solved' && !typing && !(e.target instanceof HTMLButtonElement)) { audio.play({ kind: 'ui' }); startMystery(mysteryRef.current.set); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // What each country looks like right now. Each view has its own colouring and they never mix: Explore keeps every
  // country's own colour, a round paints found countries slate, and Progress paints one recorded run.
  const statuses = useMemo<StatusMap>(() => {
    const s: StatusMap = {};
    if (view === 'progress') for (const [id, a] of runResults) s[id] = runStatus(a);
    if (view === 'explore' && selected) s[selected] = 'selected';
    if (view === 'play' && round && !game!.sub) {
      // Every country found by guessing gets the same status, so the globe paints them all one colour.
      for (const a of round.answers) s[a.id] = a.hint ? 'missed' : 'found';
      if (round.phase === 'revealed' && last) s[last.id] = 'answer';
      if (round.phase === 'asking' && game!.mode === 'name' && targetId) s[targetId] = 'target';
    }
    // Mystery Country: wrong guesses glow by heat (setHeat below); the answer turns green only once it is found.
    if (view === 'play' && mystery) {
      for (const x of missesOf(mystery.m)) s[x.id] = 'heat';
      if (mystery.m.phase === 'solved') s[mystery.m.answer] = 'solved';
    }
    return s;
  }, [view, selected, round, game, last, targetId, runResults, mystery]);
  // A subdivision round's statuses: the same rules as countries, on the subdivision layer.
  const subStatuses = useMemo<StatusMap>(() => {
    const s: StatusMap = {};
    if (view !== 'play' || !round || !game?.sub) return s;
    for (const a of round.answers) s[a.id] = a.hint ? 'missed' : 'found';
    if (round.phase === 'revealed' && last) s[last.id] = 'answer';
    if (round.phase === 'asking' && game.mode === 'name' && targetId) s[targetId] = 'target';
    return s;
  }, [view, round, game, last, targetId]);
  useEffect(() => { globeRef.current?.setSubStatuses(subStatuses); }, [subStatuses]);
  const heats = useMemo(() => (view === 'play' && mystery ? Object.fromEntries(missesOf(mystery.m).map(x => [x.id, heatOf(x.km)])) : {}), [view, mystery]);
  useEffect(() => { if (countries.size) globeRef.current?.setHeat(heats); }, [heats, countries]);
  const theme: Theme = view === 'progress' ? 'progress' : view === 'play' && mystery ? 'mystery' : view === 'play' && game ? 'play' : 'explore';
  useEffect(() => { if (countries.size) globeRef.current?.setStatuses(statuses); }, [statuses, countries]);
  useEffect(() => { if (countries.size) globeRef.current?.setTheme(theme); }, [theme, countries]);
  useEffect(() => {
    // In a Classic 195 round, the 5 extra ATLAS countries fade back with everything outside the area.
    // Progress shows the records of the chosen country set, so it fades the rest the same way.
    // A mystery covers the whole world: only countries outside its set fade. A subdivision view fades every other country.
    const out = (c: Country) => shownSubs ? c.id !== shownSubs.countryId : view === 'play' && mystery ? !inSet(c, mystery.set)
      : !inArea(c, area) || (view === 'play' && !!game && !inSet(c, game.set)) || (view === 'progress' && !inSet(c, countrySet));
    if (countries.size) globeRef.current?.setDimmed(new Set([...countries.values()].filter(out).map(c => c.id)));
  }, [area, countries, view, game, countrySet, mystery?.set, !!mystery, shownSubs]);
  useEffect(() => { if (countries.size) globeRef.current?.setFocus(view === 'progress' ? selected : null); }, [view, selected, countries]);
  // The subdivision layer shows only the country on view, only in Explore.
  useEffect(() => { if (view !== 'explore' && subView) setSubView(null); }, [view]);
  useEffect(() => { if (countries.size) globeRef.current?.showSubdivisions(shownSubs); }, [shownSubs, countries]);
  useEffect(() => { globeRef.current?.setSubSelected(subView?.selected ?? null); }, [subView?.selected, subView?.set]);
  // Development entry: #subdivisions=CAN opens that country's view once the map has loaded.
  useEffect(() => {
    const m = import.meta.env.DEV && countries.size ? /^#subdivisions=([A-Z]{3})$/.exec(location.hash) : null;
    if (m) openSubdivisions(m[1]);
  }, [countries]);

  // Explore: the opened country's capital and major cities, loaded on first use and drawn as markers.
  useEffect(() => {
    if (view !== 'explore' || !selected || places) return;
    loadPlaces().then(p => { setPlaces(p); setPlacesError(false); }, () => setPlacesError(true));
  }, [view, selected, places]);
  const selectedPlaces = selected ? places?.countries[selected] : undefined;
  useEffect(() => {
    const cities = view === 'explore' && !subView ? selectedPlaces?.cities ?? [] : [];
    globeRef.current?.setCities(cities.slice(0, 6).map(c => ({ id: c.id, name: c.name, at: lngLat(c), capital: !!c.capital })));
  }, [view, selectedPlaces, !!subView]);

  // Names and flags on hover everywhere except during a round (the Play start screen and results included). In a round
  // only countries already guessed correctly are named: any other label would give an answer away (Show me answers stay
  // unnamed too, since they were not guessed).
  const guessedRight = inRound && !!hoverId && !!round?.answers.some(a => a.id === hoverId && !a.hint);
  const hoverCountry = hoverId && (!inRound || guessedRight) ? countries.get(hoverId) : undefined;
  const selectedCountry = selected ? countries.get(selected) : undefined;
  const loading = !countries.size && !error;
  const legend = useMemo(() => {
    const n = { first: 0, retry: 0, hinted: 0 };
    for (const a of runResults.values()) n[runStatus(a)]++;
    return { ...n, none: Math.max(0, challenge.targetIds.length - runResults.size) };
  }, [runResults, challenge]);
  const stats = round && statsOf(round, performance.now());
  const nameOf = (id: string) => (id.startsWith('typed:') ? `“${id.slice(6)}”` : game?.places.get(id)?.name ?? countries.get(id)?.name ?? id);
  // A subdivision round's labels: the country, and its own word for what is asked ("province or territory").
  const scopeName = (g: Game) => (g.sub ? countries.get(g.sub.countryId)?.name ?? g.sub.countryId : areaShort(g.area));
  const unitWord = (g: Game) => (g.sub ? g.sub.meta.terms.singular : 'country');
  const unitsWord = (g: Game) => (g.sub ? g.sub.meta.terms.plural : 'countries');

  const answerBar = inRound && game?.mode === 'name' && round?.phase === 'asking' && !game.held;
  // Mystery Country on screen: its numbers, the countries it can take as guesses, and the record for the chosen set.
  const mStats = mystery && mysteryStats(mystery.m, performance.now());
  const mEntries = useMemo(() => ROSTER.filter(r => inSet(r, mystery?.set ?? countrySet)), [mystery?.set, countrySet]);
  const mGuessed = useMemo(() => new Map(mystery?.m.guesses.map(g => [g.id, g.km]) ?? []), [mystery]);
  const mLatest = useMemo(() => {
    const m = mystery?.m, g = m?.guesses.at(-1);
    if (!m || !g || m.phase !== 'playing') return null;
    const t = trendsOf(m).at(-1);
    return { name: nameOf(g.id), km: g.km, trend: m.guesses.length === 1 ? '' : t === 'closest' ? 'closest yet' : 'not closer' };
  }, [mystery, countries]);
  const mysteryKeyFor = useMemo(() => (set: CountrySet) => mysteryKey(mysteryChallenge(set, mysteryPool(set))), [countries]);
  const mysteryRecord = countries.size ? mysteryStore[mysteryKeyFor(countrySet)] : undefined;
  const searchBar = mysteryPlaying && !mystery!.held;
  const mHistory = mystery && {
    guesses: mystery.m.guesses, answer: mystery.m.phase === 'solved' ? mystery.m.answer : null, countries,
    order: mystery.order, onOrder: (order: 'latest' | 'closest') => { const g = mysteryRef.current; if (g) commitMystery({ ...g, order }); }, onFocus: focusGuess,
  };
  // Menu sounds: a quiet click for any button press (modes, starting a challenge, Play again, navigation). Buttons that
  // make their own sound (answers, the speaker) and map controls (zoom) are marked data-silent. Globe drags, zooms,
  // hovers and camera moves are not buttons, so they never make a sound.
  const uiClick = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b && !b.disabled && !b.closest('[data-silent]')) audio.play({ kind: 'ui' });
  };
  return <div className={`app${inRound ? ' in-round' : ''}${mysteryPlaying ? ' in-mystery' : ''}${answerBar || searchBar ? ' has-answer-bar' : ''}`} onClick={uiClick}>
    <Starfield />
    <div className="atmosphere" ref={glowDiv} />
    <div className="map" ref={mapDiv} />
    <div className="globe-shade" ref={shadeDiv} />

    <header className="topbar">
      <div className="brand"><Icon name="globe" /> ATLAS</div>
      {!inRound && !inMystery && <nav className="areas" aria-label="Area">
        <div className="tabs">{TABS.map(a => <button key={a} className={a === tabOf(area) ? 'active' : ''} onClick={() => chooseArea(a)}>{a}</button>)}</div>
        {tabOf(area) === 'Americas' && <div className="subtabs">{AMERICAS.map(o => <button key={o.area} className={o.area === area ? 'active' : ''} onClick={() => chooseArea(o.area)}>{o.label}</button>)}</div>}
      </nav>}
    </header>

    <nav className="rail" aria-label="Sections">
      {([['explore', 'Explore', 'globe'], ['play', 'Play', 'play'], ['progress', 'Progress', 'bars']] as const).map(([v, label, icon]) =>
        <button key={v} className={view === v ? 'active' : ''} onClick={() => { setView(v); setSelected(null); setSelectedLand(null); setHoverId(null); }}><Icon name={icon} /><span>{label}</span></button>)}
      <span className="rail-sep" />
      <button className={help ? 'active' : ''} aria-expanded={help} onClick={() => setHelp(h => !h)}><Icon name="help" /><span>Help</span></button>
    </nav>

    {help && <aside className="card help" aria-label="Help">
      <div className="card-head"><strong>How the map works</strong><button className="close" aria-label="Close help" onClick={() => setHelp(false)}>×</button></div>
      <ul className="key">
        <li><span className="k ring" />Very small countries have a ring you can click.</li>
        <li><span className="k land" />Grey land is not one of the 200 countries.</li>
        <li><span className="k done" />In a round, countries you find turn steel blue.</li>
        <li><span className="k miss" />Dashed red: missed. Gold: the answer.</li>
      </ul>
      <p className="fine">Points: {ATTEMPT_POINTS.join(', ')} for the 1st, 2nd and 3rd attempt, then {LATE_POINTS}. Show me gives 0. Streak bonuses for first-try answers in a row: {STREAK_MILESTONES.map(m => `+${m.bonus.toLocaleString()} at ${m.streak}`).join(', ')}. Time never changes points; it only separates runs that are equally accurate.</p>
      <div className="sound-row" data-silent>
        <button className={sound ? 'btn small on' : 'btn small'} aria-pressed={sound} onClick={toggleSound}><Icon name={sound ? 'sound' : 'mute'} />Sound {sound ? 'on' : 'off'}</button>
        <input type="range" min={0} max={1} step={0.05} value={volume} disabled={!sound} aria-label="Volume"
          onChange={e => setVolume(Number(e.target.value))} onPointerUp={() => audio.play({ kind: 'correct', streak: 1 })} />
      </div>
    </aside>}

    {inRound && game && round && target && stats && <Hud
      kindLabel={game.kind === 'sprint' ? 'Sprint' : null} area={scopeName(game)} mode={game.mode} held={game.held}
      round={round} stats={stats} target={target} unit={unitWord(game)} message={game.message} miss={game.miss} fx={game.fx} now={performance.now()}
      sound={sound} onSound={toggleSound}
      onHold={hold} onEnd={leaveRound} onReveal={reveal} onNext={next} />}

    {mysteryPlaying && mStats && <MysteryHud
      setLabel={mystery!.set === '195' ? 'Classic 195' : '200 countries'} held={mystery!.held} stats={mStats}
      closestName={mStats.closest ? nameOf(mStats.closest.id) : null} message={mystery!.message} latest={mLatest}
      historyOpen={historyOpen} onToggleHistory={() => setHistoryOpen(o => !o)}
      sound={sound} onSound={toggleSound} onHold={holdMystery} onEnd={leaveMystery} />}
    {searchBar && <MysterySearch entries={mEntries} guessed={mGuessed} disabled={mystery!.held}
      onGuess={id => mysteryGuess(id, 'type')}
      onNoMatch={text => { const g = mysteryRef.current; if (g) commitMystery({ ...g, message: `No country in this game matches “${text}”.` }); }} />}
    {mysteryPlaying && mHistory && <aside className={historyOpen ? 'card panel mystery-panel open' : 'card panel mystery-panel'} aria-label="Guess history">
      <MysteryHistory {...mHistory} />
    </aside>}
    {inMystery && mystery!.m.phase === 'solved' && mStats && mHistory && countries.get(mystery!.m.answer) && <aside className="card panel">
      <MysteryResults answer={countries.get(mystery!.m.answer)!} stats={mStats} closestName={mStats.closest ? nameOf(mStats.closest.id) : null}
        first={!mystery!.before || mystery!.before.solved === 0} record={isMysteryRecord(mystery!.bests)}
        best={mystery!.before?.best ? { guesses: mystery!.before.best.guesses, ms: mystery!.before.best.ms } : null}
        history={mHistory} onNext={() => startMystery(mystery!.set)} onBack={() => { leaveMystery(); globeRef.current?.fly(fit(AREA_CAMERA[area])); }} />
    </aside>}

    {inRound && game?.area === 'Oceania' && !game.sub && !game.held && <RegionNav label="Pacific" views={PACIFIC_VIEWS} active={regionView} onPick={goToRegion} />}

    {answerBar && <form className="answer-bar" onSubmit={submitName}>
      <input autoFocus value={guess} onChange={e => setGuess(e.target.value)} placeholder="Type your answer…" aria-label={`Name of the ${game ? unitWord(game) : 'country'}`} />
      <button type="submit" aria-label="Submit answer" data-silent><Icon name="arrow" /></button>
    </form>}

    {!inRound && !inMystery && <aside className={view === 'explore' && !selectedCountry && !selectedLand ? 'card panel slim' : view === 'explore' && subView ? 'card panel sub' : 'card panel'}>
      {view === 'play' && !game && <>
        <div className="eyebrow">{SET_LABEL[countrySet]}</div>
        <h1>{areaTitle(area)}</h1>
        <div className="segmented two" role="radiogroup" aria-label="Countries">
          <button role="radio" aria-checked={countrySet === '200'} className={countrySet === '200' ? 'on' : ''} onClick={() => setCountrySet('200')}>200 Countries</button>
          <button role="radio" aria-checked={countrySet === '195'} className={countrySet === '195' ? 'on' : ''} onClick={() => setCountrySet('195')}>Classic 195</button>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Game mode">
          <button role="radio" aria-checked={mode === 'find'} className={mode === 'find' ? 'on' : ''} onClick={() => setMode('find')}>Find it</button>
          <button role="radio" aria-checked={mode === 'name'} className={mode === 'name' ? 'on' : ''} onClick={() => setMode('name')}>Name it</button>
          <button disabled title="Coming next">Complete <em>soon</em></button>
        </div>
        <p className="muted">{mode === 'find' ? 'We name a country; you click it on the globe.' : 'A country lights up in gold; you type its name.'} Get it first try for {ATTEMPT_POINTS[0]} points, and 3, 5 or 10 in a row for a streak bonus. Every mistake costs points and breaks your streak.</p>
        <ChallengePicker area={areaShort(area)} loading={loading} poolSize={playIds.length}
          sprintBest={sprintRecord} fullBest={record} onSprint={() => startRound({ kind: 'sprint' })} onFull={() => startRound()}
          mysteryBest={mysteryRecord} mysterySize={mEntries.length} onMystery={() => startMystery()} />
      </>}

      {view === 'play' && game && round?.phase === 'done' && stats && game.kind === 'sprint' && <SprintResults
        area={scopeName(game)} modeLabel={game.sub ? (game.mode === 'find' ? 'Find the Region' : 'Name the Region') : game.mode === 'find' ? 'Find it' : 'Name it'} stats={stats} answers={round.answers}
        before={game.before} bests={game.bests} countries={game.places} nameOf={nameOf}
        onPlayAgain={playAgain} onChange={leaveRound}
        heading={unitsWord(game).replace(/^./, ch => ch.toUpperCase())} changeLabel={game.sub ? `Back to ${scopeName(game)}` : undefined} />}

      {view === 'play' && game && round?.phase === 'done' && stats && game.kind === 'full' && <>
        <div className="eyebrow">{scopeName(game)} Challenge Complete · {stats.total} {unitsWord(game).replace(/^./, ch => ch.toUpperCase())} · {game.sub ? (game.mode === 'find' ? 'Find the Region' : 'Name the Region') : game.mode === 'find' ? 'Find it' : 'Name it'}</div>
        {stats.perfect && <div className="perfect">Perfect run · {stats.score.toLocaleString()}<span>Every {unitWord(game)} first try, the maximum score. No mistakes, no hints.</span></div>}
        {isNewRecord(game.before, game.bests) && <div className="record"><Burst />New personal best<span>Your best {scopeName(game)} Challenge run yet.</span></div>}
        <div className="headline">
          <div><span>Score</span><strong>{stats.score.toLocaleString()}</strong><small>/ {stats.maxScore.toLocaleString()}</small>{game.bests?.score && <em>New best</em>}</div>
          <div><span>First-try accuracy</span><strong>{pct(stats.accuracy)}</strong>{game.bests?.accuracy && <em>New best</em>}</div>
        </div>
        <dl className="facts">
          <div><dt>Correct on first try</dt><dd>{stats.firstTryCorrect} / {stats.total}</dd></div>
          <div><dt>{unitsWord(game).replace(/^./, ch => ch.toUpperCase())} missed</dt><dd>{stats.countriesMissed}</dd></div>
          <div><dt>Incorrect guesses</dt><dd>{stats.totalMistakes}{game.bests?.mistakes && <em> · new best</em>}</dd></div>
          {stats.hintsUsed > 0 && <div><dt>Show me used</dt><dd>{stats.hintsUsed}</dd></div>}
          <div><dt>Longest perfect streak</dt><dd>{stats.longestStreak}{game.bests?.streak && <em> · new best</em>}</dd></div>
          <div><dt>Time</dt><dd>{formatTime(stats.elapsedMs)}{game.bests?.time && <em> · new best</em>}</dd></div>
        </dl>
        <ScoreBreakdown stats={stats} />
        <ReviewList answers={round.answers} countries={game.places} nameOf={nameOf} heading={unitsWord(game).replace(/^./, ch => ch.toUpperCase())} />
        <button className="btn primary" onClick={playAgain}>Play again</button>
        {!game.sub && <button className="btn" onClick={() => { setRunView('latest'); setView('progress'); }}>See this run in Progress</button>}
        <button className="btn" onClick={leaveRound}>{game.sub ? `Back to ${scopeName(game)}` : 'Change challenge'}</button>
      </>}

      {view === 'explore' && subView && selectedCountry ? <SubdivisionInspector country={selectedCountry} set={subView.set} selected={subView.selected}
        onSelect={id => setSubView({ ...subView, selected: id })} onExit={exitSubdivisions}
        onPlay={(m, kind) => startSubdivisionRound(subView.set.countryId, m, kind)} records={subPerf} />
      : view === 'explore' && (selectedCountry ? <CountryPanel
        country={selectedCountry} places={selectedPlaces} placesError={placesError} loaded={!!places}
        challengeSize={countryChallenge(selectedCountry.continent, countrySet, 'find').targetIds.length}
        onPlay={() => startRound({ area: selectedCountry.continent, mode: 'find' })} onClose={() => setSelected(null)}
        subdivisions={import.meta.env.DEV && subIndex?.countries[selectedCountry.id] ? { label: describeCount(subIndex.countries[selectedCountry.id]), open: () => openSubdivisions(selectedCountry.id) } : undefined} /> : selectedLand ? <>
        <div className="card-head"><h1>{selectedLand.name}</h1><button className="close" aria-label="Close" onClick={() => setSelectedLand(null)}>×</button></div>
        <dl className="facts"><div><dt>Status</dt><dd>{landNote(selectedLand).status}</dd></div></dl>
        <p className="muted">{landNote(selectedLand).why}</p>
      </> : <p className="muted">Explore 200 countries. Click any country to learn about it.</p>)}

      {view === 'progress' && <ProgressPanel
        store={perf} area={area} set={countrySet} mode={mode} kind={progressKind}
        onArea={chooseArea} onSet={setCountrySet} onMode={setMode} onKind={k => { setProgressKind(k); setSelected(null); }}
        record={progressRecord} runView={runView} onRunView={setRunView} legend={legend}
        selected={selectedCountry} result={selectedCountry && runResults.get(selectedCountry.id)} resultBonus={selectedCountry ? runBonuses.get(selectedCountry.id) ?? 0 : 0} onCloseCountry={() => setSelected(null)}
        nameOf={nameOf} loading={loading} poolSize={playIds.length} onPlay={k => startRound({ kind: k })}
        mysteryRecord={mysteryRecord} mysterySize={mEntries.length} countryOf={id => countries.get(id)} onMystery={() => startMystery()} />}
    </aside>}

    {/* In a round, only subdivisions already found are named, as for countries. */}
    {shownSubs && subHover && (!inRound || round?.answers.some(a => a.id === subHover && !a.hint)) ? <div className="hover-name">{shownSubs.byId.get(subHover)?.properties.name}<small>{shownSubs.byId.get(subHover)?.properties.kind}</small></div>
      : hoverCountry && <div className="hover-name"><Flag iso2={hoverCountry.iso2} />{hoverCountry.name}</div>}
    <div className="zoom" data-silent><button aria-label="Zoom in" onClick={() => globeRef.current?.zoomBy(1)}>+</button><button aria-label="Zoom out" onClick={() => globeRef.current?.zoomBy(-1)}>−</button></div>
    {error && <div className="error">{error}</div>}
    <footer className="credits">Borders and relief: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · Flags: flag-icons</footer>
  </div>;
}

// Explore: a country's facts, its capital and major cities (Natural Earth), and the challenges it leads to.
function CountryPanel({ country, places, placesError, loaded, challengeSize, onPlay, onClose, subdivisions }: {
  country: Country; places?: { cities: City[]; note?: string }; placesError: boolean; loaded: boolean; challengeSize: number; onPlay: () => void; onClose: () => void;
  subdivisions?: { label: string; open: () => void };   // development builds only, for countries with subdivision data
}) {
  const capitals = capitalsOf(places);
  const major = places?.cities.filter(c => !c.capital).slice(0, 5) ?? [];
  const pending = !loaded && !placesError;
  return <>
    <div className="card-head"><h1 className="with-flag"><Flag iso2={country.iso2} size="lg" />{country.name}</h1><button className="close" aria-label="Close" onClick={onClose}>×</button></div>
    <dl className="facts">
      <div><dt>{capitals.length > 1 ? 'Capitals' : 'Capital'}</dt><dd>{pending ? '…' : placesError ? 'Not available' : capitals.length
        ? capitals.map(c => <span key={c.id} className="cap">{c.name}{typeof c.capital === 'string' && <small> {c.capital}</small>}</span>)
        : 'None listed'}</dd></div>
      <div><dt>Continent</dt><dd>{country.continent}</dd></div>
      {country.region && <div><dt>Region</dt><dd>{country.region}</dd></div>}
      <div><dt>Status</dt><dd>{STATUS_LABEL[country.status]}</dd></div>
      <div><dt>Classic 195</dt><dd>{inSet(country, '195') ? 'Included' : 'Not included'}</dd></div>
    </dl>
    {places?.note && <p className="muted">{places.note}</p>}
    {country.note && <p className="muted">{country.note}</p>}
    {major.length > 0 && <div className="cities"><span className="eyebrow">Major cities</span><p>{major.map(c => c.name).join(', ')}</p></div>}
    <div className="eyebrow">Challenges</div>
    <button className="btn" onClick={onPlay}>Play {country.continent} · {challengeSize} countries</button>
    {subdivisions && <button className="btn dev" onClick={subdivisions.open}>Dev · Inspect {subdivisions.label}</button>}
    <p className="fine">Coming later: {country.name}’s regions and cities as challenges of their own. Capitals and cities: Natural Earth.</p>
  </>;
}

// Why a piece of land is on the globe but not in the game. Wording follows Natural Earth's own classification.
function landNote(l: Land): { status: string; why: string } {
  const part = l.sovereign && l.sovereign !== l.name;
  if (l.id === 'ATA') return { status: 'Governed by the Antarctic Treaty', why: 'Antarctica belongs to no country.' };
  if (part) return { status: `${l.kind === 'Overseas region' ? 'Overseas region' : 'Territory'} of ${l.sovereign}`, why: `It is part of ${l.sovereign}, so it is not one of the 200 countries in ATLAS.` };
  if (l.kind === 'Disputed' || l.kind === 'Indeterminate') return { status: 'Disputed or unclaimed territory', why: 'Its status is disputed or unclaimed, so it is not one of the 200 countries in ATLAS.' };
  return { status: 'Not one of the 200 countries', why: 'ATLAS plays the 193 UN member states, the 2 UN observer states, and Kosovo, Taiwan, Western Sahara, Greenland and Puerto Rico.' };
}
