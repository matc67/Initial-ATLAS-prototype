import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Starfield from './components/Starfield';
import { AMERICAS, AREA_CAMERA, SET_LABEL, STATUS_LABEL, TABS, inArea, inSet, indexCountries, tabOf, type Area, type Country, type CountrySet } from './data/countries';
import type { LngLat } from './game/geo';
import { capitalsOf, loadPlaces, lngLat, type City, type PlacesFile } from './data/places';
import { countryChallenge, type GameMode, type GeographyChallenge } from './game/challenges';
import { FEEDBACK } from './game/feedback';
import { nameMatches } from './game/names';
import { addRun, loadPerformance, perfKey, savePerformance, toGameRun, type GameRun, type RunSummary } from './game/records';
import { QUICK_ROUND, pickRound } from './game/round';
import {
  ATTEMPT_POINTS, LATE_POINTS, STREAK_MILESTONES, formatTime, guess as guessRound, isCompleted, isFirstTry, isPaused, newRound, next as nextRound,
  pause, pointsFor, resume, reveal as revealRound, reviewOf, statsOf, targetOf, typedGuess,
  type Attempt, type NewBests, type Round,
} from './game/scoring';
import { COLORS, GlobeView, type Camera, type Land, type StatusMap, type Theme } from './map/GlobeView';

type View = 'explore' | 'play' | 'progress';
type Mode = GameMode;
// A round in the app: the rules' Round plus what the screen needs around it.
type Game = {
  mode: Mode; area: Area; set: CountrySet;
  challenge: GeographyChallenge;
  full: boolean;           // every country in the challenge: only full challenges set personal records
  round: Round;
  held: boolean;           // paused with the pause button (the clock also pauses for hidden tabs, Help or other views)
  message: string;
  // The points just won, shown briefly beside the next question. `key` restarts its animation for each new answer.
  gain: { points: number; key: number } | null;
  bests: NewBests | null;  // set when a full challenge finishes
};

const FLASH_GOOD = COLORS.good, FLASH_BAD = COLORS.bad, FLASH_SELECT = '#fff6dc';
// A wrong guess flashes red only briefly; the player can click again at once.
const WRONG_FLASH_MS = 220;
const isMobile = () => window.innerWidth <= 760;
// Area zoom levels are tuned for a 1440×900 window; smaller screens zoom out so the whole area still fits.
const fit = (c: Camera): Camera => ({ ...c, zoom: c.zoom + Math.max(-1.1, Math.min(0.3, Math.log2(Math.min(window.innerWidth, window.innerHeight * 1.3) / 1150))) });
const areaTitle = (a: Area) => (a === 'World' ? 'The World' : a);
const areaShort = (a: Area) => (a === 'World' ? 'World' : a);
const SET_KEY = 'atlas-country-set';
const loadSet = (): CountrySet => { try { return localStorage.getItem(SET_KEY) === '195' ? '195' : '200'; } catch { return '200'; } };
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
// How one country went in a recorded run, as a Progress globe status.
const runStatus = (a: Attempt): 'first' | 'retry' | 'hinted' => (a.hint ? 'hinted' : a.mistakes ? 'retry' : 'first');
// Wrong guesses grouped in first-seen order: ['BOL', 'PER', 'BOL'] → [['BOL', 2], ['PER', 1]].
const wrongList = (ids: string[]) => [...ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())];

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
  // Which recorded run the Progress globe shows.
  const [runView, setRunView] = useState<'latest' | 'best'>('latest');
  // Capitals and major cities, fetched the first time a country is opened in Explore.
  const [places, setPlaces] = useState<PlacesFile | null>(null);
  const [placesError, setPlacesError] = useState(false);
  const [countrySet, setCountrySet] = useState<CountrySet>(loadSet);
  useEffect(() => { try { localStorage.setItem(SET_KEY, countrySet); } catch { /* storage blocked: the choice lasts for this visit */ } }, [countrySet]);

  // Explore and Progress always cover all 200; rounds use the chosen set.
  const areaIds = useMemo(() => [...countries.values()].filter(c => inArea(c, area)).map(c => c.id), [countries, area]);
  const playIds = useMemo(() => areaIds.filter(id => inSet(countries.get(id)!, countrySet)), [areaIds, countries, countrySet]);
  const round = game?.round;
  const targetId = round && targetOf(round);
  const target = targetId ? countries.get(targetId) : undefined;
  const inRound = view === 'play' && !!round && round.phase !== 'done';
  const last = round?.answers.at(-1);
  // The full challenge for the chosen area, set and mode: what Play starts and what Progress shows records for.
  const challenge = useMemo(() => countryChallenge(area, countrySet, mode), [area, countrySet, mode]);
  const record = perf[perfKey(challenge)];
  const shownRun: GameRun | undefined = runView === 'best' ? record?.bestRun : record?.latestRun ?? record?.bestRun;
  const runResults = useMemo(() => new Map(shownRun?.results.map(a => [a.id, a]) ?? []), [shownRun]);

  // Map events arrive outside React, so they always call the latest handlers through this ref.
  const handlers = useRef({ pick: (_id: string | null, _at: LngLat, _land?: Land, _ambiguous?: string[]) => {}, hover: (_id: string | null) => {} });
  useEffect(() => {
    const globe = new GlobeView(mapDiv.current!, { onPick: (id, at, land, ambiguous) => handlers.current.pick(id, at, land, ambiguous), onHover: id => handlers.current.hover(id) }, { glow: glowDiv.current!, shade: shadeDiv.current! });
    globeRef.current = globe;
    // Development builds expose the map so visual checks can move the camera; production builds strip this.
    if (import.meta.env.DEV) (window as unknown as { atlasMap: unknown }).atlasMap = globe.map;
    globe.jump(fit(AREA_CAMERA.World));
    globe.load()
      .then(({ countries, tiny }) => { setCountries(indexCountries(countries)); setTiny(tiny); })
      .catch(e => setError(e instanceof Error ? e.message : 'The map could not load.'));
    return () => { globe.destroy(); globeRef.current = null; };
  }, []);

  // Centre the globe in the open space: beside the side panel, or under the question card during a round.
  useEffect(() => {
    const pad = (animate: boolean) => globeRef.current?.setPadding(isMobile()
      ? { left: 0, right: 0, top: inRound ? 180 : 110, bottom: inRound ? 130 : window.innerHeight * 0.42 }
      : inRound ? { left: 100, right: 100, top: 190, bottom: 100 } : { left: 110, right: 370, top: 90, bottom: 60 }, animate);
    pad(true);
    const onResize = () => pad(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [inRound]);

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
  // Redraws the timer a few times a second while it runs; the value itself comes from the clock, not from this interval.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [running]);

  const flyToCountry = (c: Country) => globeRef.current?.fly(fit({ center: c.center, zoom: tiny.has(c.id) ? 5.2 : 3.8 }));

  function chooseArea(a: Area) {
    setArea(a);
    commit(null);
    setSelected(null);
    globeRef.current?.fly(fit(AREA_CAMERA[a]));
  }

  // Plays every country in the challenge unless a shorter round is asked for. `area` and `mode` default to the current
  // choice; Explore passes the opened country's continent to start that challenge directly.
  function startRound({ size, area: a = area, mode: m = mode }: { size?: number; area?: Area; mode?: Mode } = {}) {
    const c = countryChallenge(a, countrySet, m);
    const ids = c.targetIds.filter(id => countries.has(id));
    const queue = pickRound(ids, Math.min(size ?? ids.length, ids.length));
    if (!queue.length) return;
    setArea(a);
    setMode(m);
    setView('play');
    setSelected(null);
    setSelectedLand(null);
    setHelp(false);
    commit({ mode: m, area: a, set: countrySet, challenge: c, full: queue.length === c.targetIds.length, round: newRound(queue, performance.now()), held: false, message: '', gain: null, bests: null });
    setGuess('');
    const first = countries.get(queue[0]);
    if (m === 'name' && first) flyToCountry(first); else globeRef.current?.fly(fit(AREA_CAMERA[a]));
  }

  // Applies a new Round: moves the camera for the next question and, when a full challenge ends, saves the run and
  // updates its personal records. Everything visible changes in this one update.
  function apply(g: Game, r: Round, message: string) {
    const answered = r.answers.length > g.round.answers.length ? r.answers.at(-1)! : null;
    const moved = r.index !== g.round.index || (r.phase === 'done' && g.round.phase !== 'done');
    let bests: NewBests | null = g.bests;
    if (r.phase === 'done' && g.round.phase !== 'done') {
      globeRef.current?.fly(fit(AREA_CAMERA[g.area]));
      if (g.full) {
        const key = perfKey(g.challenge);
        const result = addRun(perf[key], toGameRun(r, g.challenge, performance.now()));
        const all = { ...perf, [key]: result.performance };
        setPerf(all);
        savePerformance(all);
        setRunView('latest');
        bests = result.bests;
      }
    } else if (moved && g.mode === 'name') {
      const c = countries.get(r.queue[r.index]);
      if (c) flyToCountry(c);
    }
    if (moved) setGuess('');
    const gain = answered && answered.points > 0 && !answered.hint ? { points: answered.points, key: r.answers.length } : moved ? null : g.gain;
    commit({ ...g, round: r, message, gain, bests });
  }

  handlers.current.hover = setHoverId;
  handlers.current.pick = (id, at, land, ambiguous) => {
    const g = gameRef.current;
    // Rings too close together to tell apart. In a round, those that cannot be the answer (outside the round or already
    // found) are set aside; if one candidate is left it is the click. Otherwise zoom in, and never count it as a mistake.
    if (ambiguous) {
      const open = view === 'play' && g ? ambiguous.filter(c => { const k = countries.get(c); return !!k && inArea(k, g.area) && inSet(k, g.set) && !isCompleted(g.round, c); }) : [];
      if (open.length === 1) id = open[0];
      else {
        globeRef.current?.fly({ center: at, zoom: Math.min(8, globeRef.current.map.getZoom() + 2) }, 700);
        if (view === 'play' && g && g.round.phase === 'asking') commit({ ...g, message: FEEDBACK.tooClose });
        return;
      }
    }
    if (view !== 'play') {
      setSelected(id);
      setSelectedLand(id ? null : land ?? null);
      if (id) globeRef.current?.flash(id, FLASH_SELECT, 600);
      return;
    }
    if (!g || g.mode !== 'find' || g.round.phase !== 'asking' || isPaused(g.round)) return;
    // Clicks on the ocean, unplayable land, other areas or other country sets are explained but never count as mistakes,
    // and no message names what was clicked (see game/feedback.ts).
    if (!id) { commit({ ...g, message: land ? FEEDBACK.notInGame : FEEDBACK.ocean }); return; }
    const clicked = countries.get(id)!;
    if (!inArea(clicked, g.area)) { commit({ ...g, message: FEEDBACK.outsideArea(areaTitle(g.area)) }); return; }
    if (!inSet(clicked, g.set)) { commit({ ...g, message: FEEDBACK.notInSet }); return; }
    const { round: r, outcome } = guessRound(g.round, id, performance.now());
    if (outcome === 'ignored') return;
    if (outcome === 'correct') { globeRef.current?.flash(id, FLASH_GOOD, 500); apply(g, r, ''); return; }
    // The wrong country is recorded by id for scoring and the results review, flashes red briefly, and stays unnamed.
    globeRef.current?.flash(id, FLASH_BAD, WRONG_FLASH_MS);
    apply(g, r, FEEDBACK.wrong);
  };

  function submitName(e: FormEvent) {
    e.preventDefault();
    const g = gameRef.current, t = g && countries.get(targetOf(g.round) ?? '');
    if (!g || !t || !guess.trim()) return;
    const right = nameMatches(t, guess);
    const { round: r, outcome } = typedGuess(g.round, guess, right, performance.now());
    if (outcome === 'ignored') return;
    globeRef.current?.flash(t.id, right ? FLASH_GOOD : FLASH_BAD, right ? 500 : WRONG_FLASH_MS);
    apply(g, r, right ? '' : `Not “${guess.trim()}”.`);
    setGuess('');
  }

  function reveal() {
    const g = gameRef.current, t = g && countries.get(targetOf(g.round) ?? '');
    if (!g || !t) return;
    apply(g, revealRound(g.round, performance.now()), 'The answer is shown in gold.');
    if (g.mode === 'find') flyToCountry(t);
  }

  function next() {
    const g = gameRef.current;
    if (g?.round.phase === 'revealed') apply(g, nextRound(g.round, performance.now()), '');
  }

  const hold = (held: boolean) => { const g = gameRef.current; if (g) commit({ ...g, held }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelp(false);
      if (e.key === 'Enter' && gameRef.current?.round.phase === 'revealed' && (e.target as HTMLElement).tagName !== 'INPUT') next();
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
    if (view === 'play' && round) {
      // Every country found by guessing gets the same status, so the globe paints them all one colour.
      for (const a of round.answers) s[a.id] = a.hint ? 'missed' : 'found';
      if (round.phase === 'revealed' && last) s[last.id] = 'answer';
      if (round.phase === 'asking' && game!.mode === 'name' && targetId) s[targetId] = 'target';
    }
    return s;
  }, [view, selected, round, game, last, targetId, runResults]);
  const theme: Theme = view === 'progress' ? 'progress' : view === 'play' && game ? 'play' : 'explore';
  useEffect(() => { if (countries.size) globeRef.current?.setStatuses(statuses); }, [statuses, countries]);
  useEffect(() => { if (countries.size) globeRef.current?.setTheme(theme); }, [theme, countries]);
  useEffect(() => {
    // In a Classic 195 round, the 5 extra ATLAS countries fade back with everything outside the area.
    // Progress shows the records of the chosen country set, so it fades the rest the same way.
    const out = (c: Country) => !inArea(c, area) || (view === 'play' && !!game && !inSet(c, game.set)) || (view === 'progress' && !inSet(c, countrySet));
    if (countries.size) globeRef.current?.setDimmed(new Set([...countries.values()].filter(out).map(c => c.id)));
  }, [area, countries, view, game, countrySet]);
  useEffect(() => { if (countries.size) globeRef.current?.setFocus(view === 'progress' ? selected : null); }, [view, selected, countries]);

  // Explore: the opened country's capital and major cities, loaded on first use and drawn as markers.
  useEffect(() => {
    if (view !== 'explore' || !selected || places) return;
    loadPlaces().then(p => { setPlaces(p); setPlacesError(false); }, () => setPlacesError(true));
  }, [view, selected, places]);
  const selectedPlaces = selected ? places?.countries[selected] : undefined;
  useEffect(() => {
    const cities = view === 'explore' ? selectedPlaces?.cities ?? [] : [];
    globeRef.current?.setCities(cities.slice(0, 6).map(c => ({ id: c.id, name: c.name, at: lngLat(c), capital: !!c.capital })));
  }, [view, selectedPlaces]);

  // Names on hover outside rounds. In a round only countries already guessed correctly are named: any other label would
  // give an answer away (Show me answers stay unnamed too, since they were not guessed).
  const guessedRight = view === 'play' && !!hoverId && !!round?.answers.some(a => a.id === hoverId && !a.hint);
  const hoverCountry = hoverId && (view !== 'play' || guessedRight) ? countries.get(hoverId) : undefined;
  const selectedCountry = selected ? countries.get(selected) : undefined;
  const loading = !countries.size && !error;
  const legend = useMemo(() => {
    const n = { first: 0, retry: 0, hinted: 0 };
    for (const a of runResults.values()) n[runStatus(a)]++;
    return { ...n, none: Math.max(0, challenge.targetIds.length - runResults.size) };
  }, [runResults, challenge]);
  const stats = round && statsOf(round, performance.now());
  const nameOf = (id: string) => (id.startsWith('typed:') ? `“${id.slice(6)}”` : countries.get(id)?.name ?? id);

  return <div className={inRound ? 'app in-round' : 'app'}>
    <Starfield />
    <div className="atmosphere" ref={glowDiv} />
    <div className="map" ref={mapDiv} />
    <div className="globe-shade" ref={shadeDiv} />

    <header className="topbar">
      <div className="brand"><Icon name="globe" /> ATLAS</div>
      {!inRound && <nav className="areas" aria-label="Area">
        <div className="tabs">{TABS.map(a => <button key={a} className={a === tabOf(area) ? 'active' : ''} onClick={() => chooseArea(a)}>{a}</button>)}</div>
        {tabOf(area) === 'Americas' && <div className="subtabs">{AMERICAS.map(o => <button key={o.area} className={o.area === area ? 'active' : ''} onClick={() => chooseArea(o.area)}>{o.label}</button>)}</div>}
      </nav>}
    </header>

    <nav className="rail" aria-label="Sections">
      {([['explore', 'Explore', 'globe'], ['play', 'Play', 'play'], ['progress', 'Progress', 'bars']] as const).map(([v, label, icon]) =>
        <button key={v} className={view === v ? 'active' : ''} onClick={() => { setView(v); setSelected(null); setSelectedLand(null); }}><Icon name={icon} /><span>{label}</span></button>)}
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
      <p className="fine">Points: {ATTEMPT_POINTS.join(', ')} for the 1st, 2nd and 3rd attempt, then {LATE_POINTS}. Show me gives 0. Time never changes points; it only separates runs that are equally accurate.</p>
    </aside>}

    {inRound && game && round && target && stats && <section className="hud" aria-live="polite">
      <div className="hud-top">
        <span className="hud-area">{game.area}</span>
        <div className="bar"><div style={{ width: `${(stats.completed / stats.total) * 100}%` }} /></div>
        <span className="hud-count"><b>{stats.completed}</b> / {stats.total}</span>
        <span className={stats.totalMistakes ? 'hud-chip bad' : 'hud-chip'} title="Incorrect guesses">✕ {stats.totalMistakes}</span>
        <span className="hud-chip" title="Active time"><Icon name="clock" />{formatTime(stats.elapsedMs)}</span>
        <button className="icon-btn" aria-label={game.held ? 'Resume' : 'Pause'} onClick={() => hold(!game.held)}><Icon name={game.held ? 'play-small' : 'pause'} /></button>
        <button className="close" aria-label="End round" onClick={() => commit(null)}>×</button>
      </div>
      {game.held ? <div className="hud-main paused">
        <div className="hud-name"><div><span className="verb">Paused</span><h2>Take your time</h2></div></div>
        <button className="btn primary small" onClick={() => hold(false)}>Resume</button>
      </div> : <>
        <div className="hud-main">
          {/* Find it shows the flag with the name; Name it keeps both hidden until the answer is revealed. */}
          {game.mode === 'find' || round.phase === 'revealed'
            ? <div className="hud-name"><Flag iso2={target.iso2} size="lg" /><div><span className="verb">{game.mode === 'find' ? 'Find' : 'It was'}</span><h2>{target.name}</h2></div></div>
            : <div className="hud-name"><div><span className="verb">Name this country</span><h2 className="muted-name">?</h2></div></div>}
          {/* Plays on its own while the next question is already live. */}
          {game.gain && game.gain.key === round.answers.length && <span className="gain" key={game.gain.key}>✓ +{game.gain.points}</span>}
        </div>
        <div className="hud-line">
          <span className={game.message ? 'hud-msg bad' : 'hud-msg'}>{game.message || (game.mode === 'find' ? 'Click it on the globe' : 'Type its name below')}</span>
          <span className="hud-meta">
            <b>{stats.score.toLocaleString()} pts</b>
            <span className={round.streak === 0 ? 'streak off' : STREAK_MILESTONES.includes(round.streak) ? 'streak milestone' : 'streak'} key={round.streak} title="Perfect streak">🔥 {round.streak}</span>
            {round.phase === 'revealed'
              ? <button className="btn primary small" onClick={next}>{round.index + 1 >= round.queue.length ? 'See results' : 'Next'} <kbd>Enter</kbd></button>
              : <>Attempt {round.wrong.length + 1} · {pointsFor(round.wrong.length, false)} pts<button className="link" onClick={reveal}>Show me</button></>}
          </span>
        </div>
      </>}
    </section>}

    {inRound && game?.mode === 'name' && round?.phase === 'asking' && !game.held && <form className="answer-bar" onSubmit={submitName}>
      <input autoFocus value={guess} onChange={e => setGuess(e.target.value)} placeholder="Type your answer…" aria-label="Country name" />
      <button type="submit" aria-label="Submit answer"><Icon name="arrow" /></button>
    </form>}

    {!inRound && <aside className={view === 'explore' && !selectedCountry && !selectedLand ? 'card panel slim' : 'card panel'}>
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
        <p className="muted">{mode === 'find' ? 'We name a country; you click it on the globe.' : 'A country lights up in gold; you type its name.'} Get it first try for {ATTEMPT_POINTS[0]} points; every mistake costs points and breaks your streak.</p>
        {record && <div className="best">
          <span className="eyebrow">Your best · {record.runs} {record.runs === 1 ? 'run' : 'runs'}</span>
          <div><b>{pct(record.best.accuracy)}</b> first try · <b>{record.best.score.toLocaleString()}</b> pts · {formatTime(record.fastestMs)} fastest{record.perfectRuns > 0 && <> · <span className="gold">{record.perfectRuns} perfect</span></>}</div>
        </div>}
        <button className="btn primary" onClick={() => startRound()} disabled={loading || !playIds.length}>
          {loading ? 'Loading the globe…' : `Play ${areaShort(area)} · ${playIds.length} countries`}</button>
        {playIds.length > QUICK_ROUND && <button className="btn" onClick={() => startRound({ size: QUICK_ROUND })} disabled={loading}>Quick round · {QUICK_ROUND} countries</button>}
      </>}

      {view === 'play' && game && round?.phase === 'done' && stats && <>
        <div className="eyebrow">{game.full ? `${areaShort(game.area)} Challenge Complete` : 'Quick Round Complete'} · {stats.total} Countries · {game.mode === 'find' ? 'Find it' : 'Name it'}</div>
        {stats.perfect && <div className="perfect">Perfect run<span>Every country first try. No mistakes, no hints.</span></div>}
        <div className="headline">
          <div><span>Score</span><strong>{stats.score.toLocaleString()}</strong><small>/ {stats.maxScore.toLocaleString()}</small>{game.bests?.score && <em>New best</em>}</div>
          <div><span>First-try accuracy</span><strong>{pct(stats.accuracy)}</strong>{game.bests?.accuracy && <em>New best</em>}</div>
        </div>
        <dl className="facts">
          <div><dt>Correct on first try</dt><dd>{stats.firstTryCorrect} / {stats.total}</dd></div>
          <div><dt>Countries missed</dt><dd>{stats.countriesMissed}</dd></div>
          <div><dt>Incorrect guesses</dt><dd>{stats.totalMistakes}{game.bests?.mistakes && <em> · new best</em>}</dd></div>
          {stats.hintsUsed > 0 && <div><dt>Show me used</dt><dd>{stats.hintsUsed}</dd></div>}
          <div><dt>Longest perfect streak</dt><dd>{stats.longestStreak}{game.bests?.streak && <em> · new best</em>}</dd></div>
          <div><dt>Time</dt><dd>{formatTime(stats.elapsedMs)}{game.bests?.time && <em> · new best</em>}</dd></div>
        </dl>
        {!game.full && <p className="fine">Quick rounds are random picks, so they do not set personal records.</p>}
        {reviewOf(round).length > 0 && <>
          <div className="eyebrow">Countries to review · {reviewOf(round).length}</div>
          <ul className="answers">{reviewOf(round).map(a => <li key={a.id}>
            <span className="who"><Flag iso2={countries.get(a.id)?.iso2} /><span>{countries.get(a.id)?.name}
              <small>{a.hint ? `Show me${a.mistakes ? ` after ${a.mistakes} wrong` : ''}` : `${a.mistakes} wrong: ${wrongList(a.wrongIds).map(([id, n]) => `${nameOf(id)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}`}</small></span></span>
            <span>{a.points}</span>
          </li>)}</ul>
        </>}
        <button className="btn primary" onClick={() => startRound({ size: round.queue.length, area: game.area, mode: game.mode })}>Play again</button>
        {game.full && <button className="btn" onClick={() => { setRunView('latest'); setView('progress'); }}>See this run in Progress</button>}
        <button className="btn" onClick={() => commit(null)}>Change mode or area</button>
      </>}

      {view === 'explore' && (selectedCountry ? <CountryPanel
        country={selectedCountry} places={selectedPlaces} placesError={placesError} loaded={!!places}
        challengeSize={countryChallenge(selectedCountry.continent, countrySet, 'find').targetIds.length}
        onPlay={() => startRound({ area: selectedCountry.continent, mode: 'find' })} onClose={() => setSelected(null)} /> : selectedLand ? <>
        <div className="card-head"><h1>{selectedLand.name}</h1><button className="close" aria-label="Close" onClick={() => setSelectedLand(null)}>×</button></div>
        <dl className="facts"><div><dt>Status</dt><dd>{landNote(selectedLand).status}</dd></div></dl>
        <p className="muted">{landNote(selectedLand).why}</p>
      </> : <p className="muted">Explore 200 countries. Click any country to learn about it.</p>)}

      {view === 'progress' && <>
        <div className="eyebrow">Your performance · {areaTitle(area)}</div>
        <div className="segmented two" role="radiogroup" aria-label="Countries">
          <button role="radio" aria-checked={countrySet === '200'} className={countrySet === '200' ? 'on' : ''} onClick={() => setCountrySet('200')}>200 Countries</button>
          <button role="radio" aria-checked={countrySet === '195'} className={countrySet === '195' ? 'on' : ''} onClick={() => setCountrySet('195')}>Classic 195</button>
        </div>
        <div className="segmented two" role="radiogroup" aria-label="Game mode">
          <button role="radio" aria-checked={mode === 'find'} className={mode === 'find' ? 'on' : ''} onClick={() => setMode('find')}>Find it</button>
          <button role="radio" aria-checked={mode === 'name'} className={mode === 'name' ? 'on' : ''} onClick={() => setMode('name')}>Name it</button>
        </div>
        {!record ? <>
          <p className="muted">No completed runs yet. Play this challenge to set your first record.</p>
          <button className="btn primary" onClick={() => startRound()} disabled={loading || !playIds.length}>Play {areaShort(area)} · {playIds.length} countries</button>
        </> : <>
          <div className="headline quad">
            <div><span>Best score</span><strong>{record.bestScore.toLocaleString()}</strong><small>/ {record.best.maxScore.toLocaleString()}</small></div>
            <div><span>Best first-try accuracy</span><strong>{pct(record.bestAccuracy)}</strong></div>
            <div><span>Fastest</span><strong>{formatTime(record.fastestMs)}</strong></div>
            <div><span>Fewest mistakes</span><strong>{record.fewestMistakes}</strong></div>
          </div>
          <dl className="facts">
            <div><dt>Completed runs</dt><dd>{record.runs}{record.perfectRuns > 0 && <span className="gold"> · {record.perfectRuns} perfect</span>}</dd></div>
            <div><dt>Longest first-try streak</dt><dd>{record.longestStreak}</dd></div>
            <div><dt>Best overall run</dt><dd>{runLine(record.best)}</dd></div>
            {record.latest && <div><dt>Latest run</dt><dd>{runLine(record.latest)}</dd></div>}
          </dl>
          {record.latestRun ? <>
            <div className="segmented two" role="radiogroup" aria-label="Run shown on the globe">
              <button role="radio" aria-checked={runView === 'latest'} className={runView === 'latest' ? 'on' : ''} onClick={() => setRunView('latest')}>Latest run</button>
              <button role="radio" aria-checked={runView === 'best'} className={runView === 'best' ? 'on' : ''} onClick={() => setRunView('best')} disabled={!record.bestRun}>Best run</button>
            </div>
            <ul className="levels compact">
              <Level color={COLORS.progress.first} label="Correct first try" n={legend.first} />
              <Level color={COLORS.progress.retry} label="Needed more attempts" n={legend.retry} />
              <Level color={COLORS.progress.hinted} label="Used Show me" n={legend.hinted} />
              <Level color={COLORS.progress.none} label="Not attempted" n={legend.none} />
            </ul>
            {selectedCountry ? <RunCountry country={selectedCountry} result={runResults.get(selectedCountry.id)} nameOf={nameOf} onClose={() => setSelected(null)} />
              : <p className="fine">Click a country to see how it went in this run.</p>}
          </> : <p className="fine">Country-by-country results are saved from your next run of this challenge.</p>}
          {record.history.length > 0 && <details className="history">
            <summary>Recent runs · {record.history.length}</summary>
            <table>
              <thead><tr><th>Date</th><th>Score</th><th>Acc.</th><th>✕</th><th>Time</th></tr></thead>
              <tbody>{record.history.map(h => <tr key={h.runId}><td>{shortDate(h.at)}</td><td>{h.score.toLocaleString()}</td><td>{pct(h.accuracy)}</td><td>{h.mistakes}</td><td>{formatTime(h.ms)}</td></tr>)}</tbody>
            </table>
          </details>}
          <button className="btn" onClick={() => startRound()} disabled={loading || !playIds.length}>Play {areaShort(area)} · {playIds.length} countries</button>
          <p className="fine">Runs rank by first-try accuracy, then score, then fewer mistakes, then time. Saved in this browser.</p>
        </>}
      </>}
    </aside>}

    {hoverCountry && <div className="hover-name"><Flag iso2={hoverCountry.iso2} />{hoverCountry.name}</div>}
    <div className="zoom"><button aria-label="Zoom in" onClick={() => globeRef.current?.zoomBy(1)}>+</button><button aria-label="Zoom out" onClick={() => globeRef.current?.zoomBy(-1)}>−</button></div>
    {error && <div className="error">{error}</div>}
    <footer className="credits">Borders and relief: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · Flags: flag-icons</footer>
  </div>;
}

// "1,025 · 83% · 2 ✕ · 4:32 · Oct 23"
const runLine = (r: RunSummary) => `${r.score.toLocaleString()} · ${pct(r.accuracy)} · ${r.mistakes} ✕ · ${formatTime(r.ms)} · ${new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

// Explore: a country's facts, its capital and major cities (Natural Earth), and the challenges it leads to.
function CountryPanel({ country, places, placesError, loaded, challengeSize, onPlay, onClose }: {
  country: Country; places?: { cities: City[]; note?: string }; placesError: boolean; loaded: boolean; challengeSize: number; onPlay: () => void; onClose: () => void;
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
    <p className="fine">Coming later: {country.name}’s regions and cities as challenges of their own. Capitals and cities: Natural Earth.</p>
  </>;
}

// Progress: how one country went in the run shown on the globe.
function RunCountry({ country, result: a, nameOf, onClose }: { country: Country; result?: Attempt; nameOf: (id: string) => string; onClose: () => void }) {
  return <div className="run-country">
    <div className="card-head"><strong className="with-flag"><Flag iso2={country.iso2} />{country.name}</strong><button className="close" aria-label="Close" onClick={onClose}>×</button></div>
    {!a ? <p className="fine">Not part of this run.</p> : <dl className="mini">
      <div><dt>{a.hint ? 'Guesses before Show me' : 'Attempts'}</dt><dd>{a.hint ? a.mistakes : a.mistakes + 1}</dd></div>
      <div><dt>Incorrect guesses</dt><dd>{a.mistakes}</dd></div>
      <div><dt>First-try correct</dt><dd>{isFirstTry(a) ? 'Yes' : 'No'}</dd></div>
      <div><dt>Points earned</dt><dd>{a.points}</dd></div>
      {a.wrongIds.length > 0 && <div className="wide"><dt>Clicked instead</dt><dd>{wrongList(a.wrongIds).map(([id, n]) => `${nameOf(id)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}</dd></div>}
    </dl>}
  </div>;
}

const Level = ({ color, label, n }: { color: string; label: string; n: number }) =>
  <li><i style={{ background: color }} /><span>{label}</span><b>{n}</b></li>;

// Why a piece of land is on the globe but not in the game. Wording follows Natural Earth's own classification.
function landNote(l: Land): { status: string; why: string } {
  const part = l.sovereign && l.sovereign !== l.name;
  if (l.id === 'ATA') return { status: 'Governed by the Antarctic Treaty', why: 'Antarctica belongs to no country.' };
  if (part) return { status: `${l.kind === 'Overseas region' ? 'Overseas region' : 'Territory'} of ${l.sovereign}`, why: `It is part of ${l.sovereign}, so it is not one of the 200 countries in ATLAS.` };
  if (l.kind === 'Disputed' || l.kind === 'Indeterminate') return { status: 'Disputed or unclaimed territory', why: 'Its status is disputed or unclaimed, so it is not one of the 200 countries in ATLAS.' };
  return { status: 'Not one of the 200 countries', why: 'ATLAS plays the 193 UN member states, the 2 UN observer states, and Kosovo, Taiwan, Western Sahara, Greenland and Puerto Rico.' };
}

// Flag artwork from the flag-icons package (MIT), copied to public/flags by `npm run data`; emoji flags do not render on Windows.
const Flag = ({ iso2, size }: { iso2?: string; size?: 'lg' }) =>
  iso2 ? <span className={size ? `flag ${size}` : 'flag'} style={{ backgroundImage: `url(${import.meta.env.BASE_URL}flags/${iso2.toLowerCase()}.svg)` }} aria-hidden="true" /> : null;

const ICONS = {
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 0c2.8 2.7 4.2 6 4.2 10S14.8 19.3 12 22m0-20C9.2 4.7 7.8 8 7.8 12s1.4 7.3 4.2 10M2.5 9h19M2.5 15h19',
  play: 'M6 9h4M8 7v4M15 10h.01M18 8h.01M7 4h10a5 5 0 0 1 5 5v4.5a3.5 3.5 0 0 1-6.3 2.1L14 14h-4l-1.7 1.6A3.5 3.5 0 0 1 2 13.5V9a5 5 0 0 1 5-5Z',
  bars: 'M5 20V11M12 20V4M19 20v-6',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.6-12.5a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4M12 17.5h.01',
  trophy: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Zm0 2H4a3 3 0 0 0 3 4m10-4h3a3 3 0 0 1-3 4',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  pause: 'M9 6v12M15 6v12',
  'play-small': 'M8 5.5v13l10-6.5-10-6.5Z',
};
const Icon = ({ name }: { name: keyof typeof ICONS }) =>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
