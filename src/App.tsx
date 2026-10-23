import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Starfield from './components/Starfield';
import { AMERICAS, AREA_CAMERA, SET_LABEL, STATUS_LABEL, TABS, inArea, inSet, indexCountries, tabOf, type Area, type Country, type CountrySet } from './data/countries';
import type { LngLat } from './game/geo';
import { nameMatches } from './game/names';
import { MASTERY_FIRST_TRIES, isMastered, levelOf, loadProgress, record, saveProgress, type Progress } from './game/progress';
import { ATTEMPT_POINTS, MAX_POINTS, QUICK_ROUND, pickRound } from './game/round';
import { COLORS, GlobeView, type Camera, type Land, type StatusMap, type Theme } from './map/GlobeView';

type View = 'explore' | 'play' | 'progress';
type Mode = 'find' | 'name';
// `tries` = wrong attempts before the answer; `found` = answered correctly within the allowed attempts.
type Answer = { id: string; points: number; tries: number; found: boolean };
type Game = {
  mode: Mode; area: Area; queue: string[]; index: number; score: number; streak: number; best: number;
  answers: Answer[]; phase: 'asking' | 'revealed' | 'done'; tries: number; message: string;
};

const FLASH_GOOD = COLORS.good, FLASH_BAD = COLORS.bad, FLASH_SELECT = '#fff6dc';
// After a correct answer the next country follows on its own, once the flash has played.
const AUTO_NEXT_MS = 1000;
const firstTry = (a: Answer) => a.found && a.tries === 0;
const isMobile = () => window.innerWidth <= 760;
// Area zoom levels are tuned for a 1440×900 window; smaller screens zoom out so the whole area still fits.
const fit = (c: Camera): Camera => ({ ...c, zoom: c.zoom + Math.max(-1.1, Math.min(0.3, Math.log2(Math.min(window.innerWidth, window.innerHeight * 1.3) / 1150))) });
const areaTitle = (a: Area) => (a === 'World' ? 'The World' : a);
const areaShort = (a: Area) => (a === 'World' ? 'World' : a);
const SET_KEY = 'atlas-country-set';
const loadSet = (): CountrySet => { try { return localStorage.getItem(SET_KEY) === '195' ? '195' : '200'; } catch { return '200'; } };

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
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLand, setSelectedLand] = useState<Land | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  const [help, setHelp] = useState(false);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  useEffect(() => saveProgress(progress), [progress]);
  const [countrySet, setCountrySet] = useState<CountrySet>(loadSet);
  useEffect(() => { try { localStorage.setItem(SET_KEY, countrySet); } catch { /* storage blocked: the choice lasts for this visit */ } }, [countrySet]);

  // Explore and Progress always cover all 200; rounds use the chosen set.
  const areaIds = useMemo(() => [...countries.values()].filter(c => inArea(c, area)).map(c => c.id), [countries, area]);
  const playIds = useMemo(() => areaIds.filter(id => inSet(countries.get(id)!, countrySet)), [areaIds, countries, countrySet]);
  const target = game && game.phase !== 'done' ? countries.get(game.queue[game.index]) : undefined;
  const inRound = view === 'play' && !!game && game.phase !== 'done';
  const last = game?.answers.at(-1);

  // Map events arrive outside React, so they always call the latest handlers through this ref.
  const handlers = useRef({ pick: (_id: string | null, _at: LngLat, _land?: Land) => {}, hover: (_id: string | null) => {} });
  useEffect(() => {
    const globe = new GlobeView(mapDiv.current!, { onPick: (id, at, land) => handlers.current.pick(id, at, land), onHover: id => handlers.current.hover(id) }, { glow: glowDiv.current!, shade: shadeDiv.current! });
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
      ? { left: 0, right: 0, top: inRound ? 200 : 110, bottom: inRound ? 130 : window.innerHeight * 0.42 }
      : inRound ? { left: 100, right: 100, top: 240, bottom: 110 } : { left: 110, right: 370, top: 90, bottom: 60 }, animate);
    pad(true);
    const onResize = () => pad(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [inRound]);

  const flyToCountry = (c: Country) => globeRef.current?.fly(fit({ center: c.center, zoom: tiny.has(c.id) ? 5.2 : 3.8 }));

  function chooseArea(a: Area) {
    setArea(a);
    setGame(null);
    globeRef.current?.fly(fit(AREA_CAMERA[a]));
  }

  // Plays every country in the area unless a shorter round is asked for.
  function startRound(size = playIds.length) {
    const queue = pickRound(playIds, progress, Math.min(size, playIds.length));
    setView('play');
    setHelp(false);
    setGame({ mode, area, queue, index: 0, score: 0, streak: 0, best: 0, answers: [], phase: 'asking', tries: 0, message: '' });
    setGuess('');
    const first = countries.get(queue[0]);
    if (mode === 'name' && first) flyToCountry(first); else globeRef.current?.fly(fit(AREA_CAMERA[area]));
  }

  function finishQuestion(g: Game, answer: Answer, message: string): Game {
    setProgress(p => record(p, answer.id, firstTry(answer)));
    if (answer.found) globeRef.current?.flash(answer.id, FLASH_GOOD);
    const streak = firstTry(answer) ? g.streak + 1 : 0;
    return { ...g, phase: 'revealed', tries: answer.tries, score: g.score + answer.points, streak, best: Math.max(g.best, streak), answers: [...g.answers, answer], message };
  }

  // A wrong attempt: try again for fewer points, or after the last attempt show the answer in gold.
  function miss(g: Game, t: Country, message: string) {
    const tries = g.tries + 1;
    if (tries >= ATTEMPT_POINTS.length) {
      setGame(finishQuestion(g, { id: t.id, points: 0, tries, found: false }, `${message} The answer is shown in gold.`));
      if (g.mode === 'find') flyToCountry(t);
    } else setGame({ ...g, tries, message: `${message} Try again.` });
  }

  function next() {
    if (!game || game.phase !== 'revealed') return;
    if (game.index + 1 >= game.queue.length) { setGame({ ...game, phase: 'done', message: '' }); globeRef.current?.fly(fit(AREA_CAMERA[game.area])); return; }
    setGame({ ...game, index: game.index + 1, phase: 'asking', tries: 0, message: '' });
    setGuess('');
    const c = countries.get(game.queue[game.index + 1]);
    if (game.mode === 'name' && c) flyToCountry(c);
  }

  useEffect(() => {
    if (game?.phase !== 'revealed' || !last?.found) return;
    const t = setTimeout(next, AUTO_NEXT_MS);
    return () => clearTimeout(t);
  });

  handlers.current.hover = setHoverId;
  handlers.current.pick = (id, _at, land) => {
    if (view !== 'play') {
      setSelected(id);
      setSelectedLand(id ? null : land ?? null);
      if (id) globeRef.current?.flash(id, FLASH_SELECT, 600);
      return;
    }
    if (!game || game.phase !== 'asking' || game.mode !== 'find' || !target) return;
    if (!id) { setGame({ ...game, message: land ? landNote(land).short : 'That was the ocean. Click a country.' }); return; }
    const clicked = countries.get(id)!;
    if (!inArea(clicked, game.area)) { setGame({ ...game, message: `${clicked.name} is outside ${areaTitle(game.area)}.` }); return; }
    if (!inSet(clicked, countrySet)) { setGame({ ...game, message: `${clicked.name} is not part of the Classic 195.` }); return; }
    if (id === target.id) setGame(finishQuestion(game, { id, points: ATTEMPT_POINTS[game.tries], tries: game.tries, found: true }, 'Correct!'));
    else { globeRef.current?.flash(id, FLASH_BAD); miss(game, target, `That's ${clicked.name}.`); }
  };

  function submitName(e: FormEvent) {
    e.preventDefault();
    if (!game || game.phase !== 'asking' || !target || !guess.trim()) return;
    if (nameMatches(target, guess)) setGame(finishQuestion(game, { id: target.id, points: ATTEMPT_POINTS[game.tries], tries: game.tries, found: true }, 'Correct!'));
    else { globeRef.current?.flash(target.id, FLASH_BAD); miss(game, target, `Not “${guess.trim()}”.`); }
    setGuess('');
  }

  function reveal() {
    if (!game || game.phase !== 'asking' || !target) return;
    setGame(finishQuestion(game, { id: target.id, points: 0, tries: game.tries, found: false }, 'The answer is shown in gold.'));
    if (game.mode === 'find') flyToCountry(target);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelp(false);
      if (e.key === 'Enter' && game?.phase === 'revealed' && (e.target as HTMLElement).tagName !== 'INPUT') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // What each country looks like right now. Round results and mastery never mix: mastery shows only in Progress.
  const statuses = useMemo<StatusMap>(() => {
    const s: StatusMap = {};
    if (view === 'progress') for (const id of countries.keys()) { const l = levelOf(progress, id); if (l) s[id] = l; }
    if (view === 'explore' && selected) s[selected] = 'selected';
    if (view === 'play' && game) {
      for (const a of game.answers) s[a.id] = !a.found ? 'missed' : a.tries === 0 ? 'found' : 'found-late';
      if (game.phase === 'revealed' && last && !last.found) s[last.id] = 'answer';
      if (game.phase === 'asking' && game.mode === 'name' && target) s[target.id] = 'target';
    }
    return s;
  }, [view, selected, game, last, target, progress, countries]);
  const theme: Theme = view === 'progress' ? 'progress' : view === 'play' && game ? 'play' : 'explore';
  useEffect(() => { if (countries.size) globeRef.current?.setStatuses(statuses); }, [statuses, countries]);
  useEffect(() => { if (countries.size) globeRef.current?.setTheme(theme); }, [theme, countries]);
  useEffect(() => {
    // In a Classic 195 round, the 5 extra ATLAS countries fade back with everything outside the area.
    const out = (c: Country) => !inArea(c, area) || (view === 'play' && !!game && !inSet(c, countrySet));
    if (countries.size) globeRef.current?.setDimmed(new Set([...countries.values()].filter(out).map(c => c.id)));
  }, [area, countries, view, game, countrySet]);

  // Names on hover only outside rounds: during play a label would give the answer away.
  const hoverCountry = hoverId && view !== 'play' ? countries.get(hoverId) : undefined;
  const selectedCountry = selected ? countries.get(selected) : undefined;
  const loading = !countries.size && !error;
  const levels = useMemo(() => {
    const ids = areaIds;
    const count = (l: string | null) => ids.filter(id => levelOf(progress, id) === l).length;
    return { mastered: count('mastered'), learned: count('learned'), practicing: count('practicing'), none: count(null), total: ids.length };
  }, [areaIds, progress]);

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
        <li><span className="k dash" />Island countries have a dashed outline around their islands.</li>
        <li><span className="k land" />Grey land is not one of the 200 countries.</li>
        <li><span className="k solid" />In a round, found countries light up in colour.</li>
        <li><span className="k late" />Striped: found on a later attempt.</li>
        <li><span className="k miss" />Dashed red: missed. Gold: the answer.</li>
      </ul>
      <p className="fine">Points: {ATTEMPT_POINTS.join(', ')} for the 1st, 2nd and 3rd attempt. A country is mastered after {MASTERY_FIRST_TRIES} first-try answers.</p>
    </aside>}

    {inRound && game && target && <section className="hud" aria-live="polite">
      <div className="hud-top">
        <span className="hud-area">{game.area}</span>
        <div className="bar"><div style={{ width: `${(game.answers.length / game.queue.length) * 100}%` }} /></div>
        <span className="hud-count">{game.index + 1} / {game.queue.length}</span>
        <button className="close" aria-label="End round" onClick={() => setGame(null)}>×</button>
      </div>
      <div className="hud-kicker">
        {game.mode === 'find' ? 'Find the country' : game.phase === 'revealed' ? 'It was' : 'Name this country'}
        {game.mode === 'name' && game.phase === 'asking' && <span className="tries" aria-label={`${ATTEMPT_POINTS.length - game.tries} attempts left`}>
          {ATTEMPT_POINTS.map((_, i) => <i key={i} className={i < ATTEMPT_POINTS.length - game.tries ? 'on' : ''} />)}</span>}
      </div>
      {/* Find it shows the flag with the name; Name it keeps both hidden until the answer is revealed. */}
      {(game.mode === 'find' || game.phase === 'revealed') && <div className="hud-name" key={target.id}><Flag iso2={target.iso2} size="lg" /><h2>{target.name}</h2></div>}
      <p className={game.phase === 'revealed' ? (last?.found ? 'hud-sub good' : 'hud-sub bad') : 'hud-sub'}>
        {game.message || (game.mode === 'find' ? 'Click it on the globe' : 'Type its name below')}
      </p>
      <div className="hud-foot">
        {game.phase === 'revealed' && last
          ? <span className={last.found ? 'pts good' : 'pts'}><Icon name="trophy" />+{last.points} points</span>
          : <span className="pts"><Icon name="trophy" />{ATTEMPT_POINTS[game.tries]} points available</span>}
        <span className="score">{game.score.toLocaleString()} pts{game.streak >= 2 && <em> · streak {game.streak}</em>}</span>
        {game.phase === 'revealed' && last && !last.found
          ? <button className="btn primary small" onClick={next}>{game.index + 1 >= game.queue.length ? 'See results' : 'Next'} <kbd>Enter</kbd></button>
          : game.phase === 'asking' ? <span className="attempt">Attempt {game.tries + 1}<button className="link" onClick={reveal}>Show me</button></span> : <span className="attempt" />}
      </div>
    </section>}

    {inRound && game?.mode === 'name' && game.phase === 'asking' && <form className="answer-bar" onSubmit={submitName}>
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
        <p className="muted">{mode === 'find' ? 'We name a country; you click it on the globe.' : 'A country lights up in gold; you type its name.'} Three attempts each, for {ATTEMPT_POINTS.join(' / ')} points.</p>
        <Meter label="Countries mastered" done={playIds.filter(id => isMastered(progress, id)).length} total={playIds.length} />
        <button className="btn primary" onClick={() => startRound()} disabled={loading || !playIds.length}>
          {loading ? 'Loading the globe…' : `Play ${areaShort(area)} · ${playIds.length} countries`}</button>
        {playIds.length > QUICK_ROUND && <button className="btn" onClick={() => startRound(QUICK_ROUND)} disabled={loading}>Quick round · {QUICK_ROUND} countries</button>}
      </>}

      {view === 'play' && game?.phase === 'done' && <>
        <div className="eyebrow">{game.queue.length === QUICK_ROUND ? `Quick round — ${QUICK_ROUND} Countries` : `${areaShort(game.area)} Challenge — ${game.queue.length} Countries`} · {game.mode === 'find' ? 'Find it' : 'Name it'}</div>
        <h1>{game.score.toLocaleString()} <small>/ {(game.queue.length * MAX_POINTS).toLocaleString()} pts</small></h1>
        <div className="stats">
          <div><strong>{game.answers.filter(firstTry).length} / {game.queue.length}</strong><span>first try</span></div>
          <div><strong>{game.best}</strong><span>best streak</span></div>
        </div>
        {/* Misses first: in a 200-country round they are what is worth reviewing. */}
        <ul className="answers">{[...game.answers].sort((a, b) => Number(a.found) - Number(b.found) || a.tries - b.tries).map(a => {
          const kind = !a.found ? 'miss' : a.tries === 0 ? 'ok' : 'late';
          return <li key={a.id} className={kind}>
            <span className="mark" aria-label={kind === 'miss' ? 'Missed' : kind === 'late' ? 'Found on a later attempt' : 'Found first try'}>{kind === 'miss' ? '✕' : '✓'}</span>
            <span className="who"><Flag iso2={countries.get(a.id)?.iso2} />{countries.get(a.id)?.name}</span><span>{a.points}</span>
          </li>;
        })}</ul>
        <button className="btn primary" onClick={() => startRound(game.queue.length)}>Play again</button>
        <button className="btn" onClick={() => setGame(null)}>Change mode or area</button>
      </>}

      {view === 'explore' && (selectedCountry ? <>
        <div className="card-head"><h1 className="with-flag"><Flag iso2={selectedCountry.iso2} size="lg" />{selectedCountry.name}</h1><button className="close" aria-label="Close" onClick={() => setSelected(null)}>×</button></div>
        <dl className="facts">
          <div><dt>Continent</dt><dd>{selectedCountry.continent}</dd></div>
          {selectedCountry.region && <div><dt>Region</dt><dd>{selectedCountry.region}</dd></div>}
          <div><dt>Status</dt><dd>{STATUS_LABEL[selectedCountry.status]}</dd></div>
          <div><dt>Classic 195</dt><dd>{inSet(selectedCountry, '195') ? 'Included' : 'Not included'}</dd></div>
          <div><dt>Your mastery</dt><dd>{isMastered(progress, selectedCountry.id) ? 'Mastered' : `${progress[selectedCountry.id]?.firstTry ?? 0} of ${MASTERY_FIRST_TRIES} first tries`}</dd></div>
        </dl>
        {selectedCountry.note && <p className="muted">{selectedCountry.note}</p>}
        <p className="fine">Capital, population and economy arrive with the data lenses, each with its official source.</p>
      </> : selectedLand ? <>
        <div className="card-head"><h1>{selectedLand.name}</h1><button className="close" aria-label="Close" onClick={() => setSelectedLand(null)}>×</button></div>
        <dl className="facts"><div><dt>Status</dt><dd>{landNote(selectedLand).status}</dd></div></dl>
        <p className="muted">{landNote(selectedLand).why}</p>
      </> : <p className="muted">Explore 200 countries. Click any country to learn about it.</p>)}

      {view === 'progress' && <>
        <div className="eyebrow">Your progress · {areaTitle(area)}</div>
        <h1>{levels.mastered} <small>/ {levels.total} countries mastered</small></h1>
        <ul className="levels">
          <Level color={COLORS.progress.mastered} label="Mastered" n={levels.mastered} />
          <Level color={COLORS.progress.learned} label="Learned" n={levels.learned} />
          <Level color={COLORS.progress.practicing} label="Practicing" n={levels.practicing} />
          <Level color={COLORS.notStarted} label="Not yet started" n={levels.none} />
        </ul>
        <Meter label="Known (learned or mastered)" done={levels.mastered + levels.learned} total={levels.total} percent />
        <p className="fine">Learned: 1 first-try answer. Mastered: {MASTERY_FIRST_TRIES}. Saved in this browser.</p>
      </>}
    </aside>}

    {hoverCountry && <div className="hover-name"><Flag iso2={hoverCountry.iso2} />{hoverCountry.name}</div>}
    <div className="zoom"><button aria-label="Zoom in" onClick={() => globeRef.current?.zoomBy(1)}>+</button><button aria-label="Zoom out" onClick={() => globeRef.current?.zoomBy(-1)}>−</button></div>
    {error && <div className="error">{error}</div>}
    <footer className="credits">Borders and relief: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · Flags: flag-icons</footer>
  </div>;
}

function Meter({ label, done, total, percent }: { label: string; done: number; total: number; percent?: boolean }) {
  const share = total ? done / total : 0;
  return <div className="meter">
    <div><span>{label}</span><span>{done} / {total}{percent && ` · ${Math.round(share * 100)}%`}</span></div>
    <div className="bar"><div style={{ width: `${share * 100}%` }} /></div>
  </div>;
}

const Level = ({ color, label, n }: { color: string; label: string; n: number }) =>
  <li><i style={{ background: color }} /><span>{label}</span><b>{n}</b></li>;

// Why a piece of land is on the globe but not in the game. Wording follows Natural Earth's own classification.
function landNote(l: Land): { status: string; why: string; short: string } {
  const part = l.sovereign && l.sovereign !== l.name;
  if (l.id === 'ATA') return { status: 'Governed by the Antarctic Treaty', why: 'Antarctica belongs to no country.', short: 'Antarctica belongs to no country.' };
  if (part) return { status: `${l.kind === 'Overseas region' ? 'Overseas region' : 'Territory'} of ${l.sovereign}`, why: `It is part of ${l.sovereign}, so it is not one of the 200 countries in ATLAS.`, short: `${l.name} is part of ${l.sovereign}, not one of the 200 countries.` };
  if (l.kind === 'Disputed' || l.kind === 'Indeterminate') return { status: 'Disputed or unclaimed territory', why: 'Its status is disputed or unclaimed, so it is not one of the 200 countries in ATLAS.', short: `${l.name} is not one of the 200 countries.` };
  return { status: 'Not one of the 200 countries', why: 'ATLAS plays the 193 UN member states, the 2 UN observer states, and Kosovo, Taiwan, Western Sahara, Greenland and Puerto Rico.', short: `${l.name} is not one of the 200 countries.` };
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
};
const Icon = ({ name }: { name: keyof typeof ICONS }) =>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
