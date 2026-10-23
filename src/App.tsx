import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Starfield from './components/Starfield';
import { AREA_CAMERA, AREAS, STATUS_LABEL, indexCountries, inArea, type Area, type Country } from './data/countries';
import { distanceKm, greatCircle, midpoint, type LngLat } from './game/geo';
import { nameMatches } from './game/names';
import { MASTERY_FIRST_TRIES, isMastered, loadProgress, record, saveProgress, type Progress } from './game/progress';
import { MAX_POINTS, NAME_POINTS, ROUND_LENGTH, findPoints, pickRound } from './game/round';
import { COLORS, GlobeView, type StatusMap } from './map/GlobeView';

type View = 'play' | 'explore' | 'progress';
type Mode = 'find' | 'name';
type Answer = { id: string; points: number; firstTry: boolean; clickedId?: string; km?: number };
type Game = {
  mode: Mode; area: Area; queue: string[]; index: number; score: number; streak: number; best: number;
  answers: Answer[]; phase: 'asking' | 'revealed' | 'done'; tries: number; message: string;
};

const fmtKm = (km: number) => `${Math.round(km).toLocaleString()} km`;

export default function App() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeView | null>(null);
  const [countries, setCountries] = useState<Map<string, Country>>(new Map());
  const [tiny, setTiny] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('play');
  const [area, setArea] = useState<Area>('World');
  const [mode, setMode] = useState<Mode>('find');
  const [game, setGame] = useState<Game | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  const [progress, setProgress] = useState<Progress>(loadProgress);
  useEffect(() => saveProgress(progress), [progress]);

  const areaIds = useMemo(() => [...countries.values()].filter(c => inArea(c, area)).map(c => c.id), [countries, area]);
  const masteredIn = (ids: string[]) => ids.filter(id => isMastered(progress, id)).length;
  const target = game && game.phase !== 'done' ? countries.get(game.queue[game.index]) : undefined;

  // Map events arrive outside React, so they always call the latest handlers through this ref.
  const handlers = useRef({ pick: (_id: string | null, _at: LngLat) => {}, hover: (_id: string | null) => {} });
  useEffect(() => {
    const globe = new GlobeView(mapDiv.current!, { onPick: (id, at) => handlers.current.pick(id, at), onHover: id => handlers.current.hover(id) });
    globeRef.current = globe;
    const pad = () => globe.setPadding(window.innerWidth > 760 ? { left: 110, right: 380, top: 60, bottom: 60 } : { left: 0, right: 0, top: 90, bottom: window.innerHeight * 0.45 });
    pad();
    window.addEventListener('resize', pad);
    globe.load()
      .then(({ countries, tiny }) => { setCountries(indexCountries(countries)); setTiny(tiny); })
      .catch(e => setError(e instanceof Error ? e.message : 'The map could not load.'));
    return () => { window.removeEventListener('resize', pad); globe.destroy(); globeRef.current = null; };
  }, []);

  const flyToCountry = (c: Country) => globeRef.current?.fly({ center: c.center, zoom: tiny.has(c.id) ? 5.2 : 3.6 });

  function chooseArea(a: Area) {
    setArea(a);
    setGame(null);
    globeRef.current?.fly(AREA_CAMERA[a]);
  }

  function startRound() {
    const queue = pickRound(areaIds, progress, Math.min(ROUND_LENGTH, areaIds.length));
    setGame({ mode, area, queue, index: 0, score: 0, streak: 0, best: 0, answers: [], phase: 'asking', tries: 0, message: '' });
    setGuess('');
    globeRef.current?.showGuessLine(null);
    const first = countries.get(queue[0]);
    if (mode === 'name' && first) flyToCountry(first); else globeRef.current?.fly(AREA_CAMERA[area]);
  }

  function finishQuestion(g: Game, answer: Answer, message: string): Game {
    setProgress(p => record(p, answer.id, answer.firstTry));
    const streak = answer.firstTry ? g.streak + 1 : 0;
    return { ...g, phase: 'revealed', score: g.score + answer.points, streak, best: Math.max(g.best, streak), answers: [...g.answers, answer], message };
  }

  function next() {
    if (!game || game.phase !== 'revealed') return;
    globeRef.current?.showGuessLine(null);
    if (game.index + 1 >= game.queue.length) { setGame({ ...game, phase: 'done', message: '' }); globeRef.current?.fly(AREA_CAMERA[game.area]); return; }
    setGame({ ...game, index: game.index + 1, phase: 'asking', tries: 0, message: '' });
    setGuess('');
    const c = countries.get(game.queue[game.index + 1]);
    if (game.mode === 'name' && c) flyToCountry(c);
  }

  handlers.current.hover = setHoverId;
  handlers.current.pick = (id, at) => {
    if (view === 'explore' || view === 'progress') { setSelected(id); return; }
    if (!game || game.phase !== 'asking' || game.mode !== 'find' || !target) return;
    if (!id) { setGame({ ...game, message: 'That was the ocean. Click a country.' }); return; }
    const clicked = countries.get(id)!;
    if (!inArea(clicked, game.area)) { setGame({ ...game, message: `${clicked.name} is outside ${game.area}. Try again.` }); return; }
    const correct = id === target.id;
    const km = correct ? 0 : distanceKm(clicked.center, target.center);
    const points = findPoints(correct, km);
    const message = correct ? 'Exactly right.' : `You clicked ${clicked.name}, ${fmtKm(km)} away.`;
    setGame(finishQuestion(game, { id: target.id, points, firstTry: correct, clickedId: correct ? undefined : id, km }, message));
    if (!correct) {
      globeRef.current?.showGuessLine(greatCircle(at, target.center));
      globeRef.current?.fly({ center: midpoint(at, target.center), zoom: Math.min(5, Math.max(1.5, 1.6 + Math.log2(8000 / Math.max(km, 300)) * 0.75)) });
    }
  };

  function submitName(e: FormEvent) {
    e.preventDefault();
    if (!game || game.phase !== 'asking' || !target || !guess.trim()) return;
    if (nameMatches(target, guess)) {
      setGame(finishQuestion(game, { id: target.id, points: NAME_POINTS[game.tries], firstTry: game.tries === 0 }, game.tries === 0 ? 'Right first time.' : 'Got it.'));
    } else if (game.tries + 1 >= NAME_POINTS.length) {
      setGame(finishQuestion(game, { id: target.id, points: 0, firstTry: false }, `Out of tries. You typed “${guess.trim()}”.`));
    } else {
      const left = NAME_POINTS.length - game.tries - 1;
      setGame({ ...game, tries: game.tries + 1, message: `Not “${guess.trim()}”. ${left} ${left === 1 ? 'try' : 'tries'} left.` });
    }
    setGuess('');
  }

  function reveal() {
    if (game && game.phase === 'asking' && target) setGame(finishQuestion(game, { id: target.id, points: 0, firstTry: false }, 'Answer shown. No points this time.'));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && game?.phase === 'revealed' && (e.target as HTMLElement).tagName !== 'INPUT') next(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // What each country looks like right now, derived from the view and the round.
  const statuses = useMemo<StatusMap>(() => {
    const s: StatusMap = {};
    if (view === 'progress') for (const id of countries.keys()) if (isMastered(progress, id)) s[id] = 'mastered';
    if (view === 'explore' && selected) s[selected] = 'selected';
    if (view === 'play' && game) {
      // A Name it answer on the 2nd or 3rd try still counts as found; a Find it near miss does not.
      const found = (a: Answer) => a.firstTry || (game.mode === 'name' && a.points > 0);
      for (const a of game.answers) s[a.id] = found(a) ? 'correct' : 'missed';
      const last = game.answers.at(-1);
      if (game.phase === 'revealed' && last) {
        if (!found(last)) s[last.id] = 'target';
        if (last.clickedId) s[last.clickedId] = 'wrong';
      }
      if (game.phase === 'asking' && game.mode === 'name' && target) s[target.id] = 'target';
    }
    return s;
  }, [view, selected, game, target, progress, countries]);
  useEffect(() => { if (countries.size) globeRef.current?.setStatuses(statuses); }, [statuses, countries]);
  useEffect(() => {
    if (countries.size) globeRef.current?.setDimmed(new Set([...countries.values()].filter(c => !inArea(c, area)).map(c => c.id)));
  }, [area, countries]);

  const hoverName = hoverId && (view !== 'play' || !game || game.phase !== 'asking') ? countries.get(hoverId)?.name : undefined;
  const selectedCountry = selected ? countries.get(selected) : undefined;
  const loading = !countries.size && !error;
  const last = game?.answers.at(-1);

  return <div className="app">
    <Starfield />
    <div className="map" ref={mapDiv} />

    <header className="topbar">
      <div className="brand"><Icon name="globe" /> ATLAS</div>
      <nav className="areas" aria-label="Area">
        {AREAS.map(a => <button key={a} className={a === area ? 'active' : ''} onClick={() => chooseArea(a)}>{a}</button>)}
      </nav>
    </header>

    <nav className="rail" aria-label="Sections">
      {([['play', 'Play', 'play'], ['explore', 'Explore', 'pin'], ['progress', 'Progress', 'trophy']] as const).map(([v, label, icon]) =>
        <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}><Icon name={icon} /><span>{label}</span></button>)}
    </nav>

    <aside className="panel">
      {view === 'play' && !game && <>
        <div className="eyebrow">Level 1 · The World</div>
        <h1>Find every country on Earth.</h1>
        <div className="modes">
          <button className={mode === 'find' ? 'mode active' : 'mode'} onClick={() => setMode('find')}>
            <strong>Find it</strong><span>We name a country. Click it on the globe. Closer guesses score more.</span></button>
          <button className={mode === 'name' ? 'mode active' : 'mode'} onClick={() => setMode('name')}>
            <strong>Name it</strong><span>A country lights up. Type its name. Three tries.</span></button>
          <button className="mode" disabled><strong>Complete the map <em>Next</em></strong><span>Clear every country in an area against the clock.</span></button>
        </div>
        <AreaProgress label={area} done={masteredIn(areaIds)} total={areaIds.length} />
        <button className="primary" onClick={startRound} disabled={loading || !areaIds.length}>
          {loading ? 'Loading the globe…' : `Play ${area} · ${Math.min(ROUND_LENGTH, areaIds.length)} countries`}</button>
      </>}

      {view === 'play' && game && game.phase !== 'done' && target && <>
        <div className="hud"><span>Country {game.index + 1} / {game.queue.length}</span><span className="score">{game.score.toLocaleString()} pts</span></div>
        <div className={game.streak >= 2 ? 'streak hot' : 'streak'}>Streak {game.streak}</div>
        <div className="eyebrow">{game.mode === 'find' ? 'Find' : 'Name the highlighted country'}</div>
        {game.mode === 'find' || game.phase === 'revealed' ? <h2 className="prompt">{target.name}</h2> : <h2 className="prompt muted">?</h2>}
        {game.mode === 'name' && game.phase === 'asking' && <form onSubmit={submitName} className="guess">
          <input autoFocus value={guess} onChange={e => setGuess(e.target.value)} placeholder="Type the country name" aria-label="Country name" />
          <button className="primary" type="submit">Guess</button>
        </form>}
        {game.phase === 'revealed' && last ? <div className={last.firstTry ? 'result good' : 'result'}>
          <strong>+{last.points.toLocaleString()}</strong><span>{game.message}</span>
        </div> : <p className="message">{game.message || (game.mode === 'find' ? 'Click the country on the globe.' : 'Small countries have a ring around them.')}</p>}
        {game.phase === 'revealed'
          ? <button className="primary" onClick={next}>{game.index + 1 >= game.queue.length ? 'See results' : 'Next country'} <kbd>Enter</kbd></button>
          : <button className="secondary" onClick={reveal}>Show me</button>}
        <button className="text" onClick={() => { setGame(null); globeRef.current?.showGuessLine(null); }}>End round</button>
      </>}

      {view === 'play' && game?.phase === 'done' && <>
        <div className="eyebrow">{game.area} · {game.mode === 'find' ? 'Find it' : 'Name it'}</div>
        <h1>{game.score.toLocaleString()} <small>/ {(game.queue.length * MAX_POINTS).toLocaleString()}</small></h1>
        <div className="stats">
          <div><strong>{game.answers.filter(a => a.firstTry).length} / {game.queue.length}</strong><span>first try</span></div>
          <div><strong>{game.best}</strong><span>best streak</span></div>
        </div>
        <ul className="answers">{game.answers.map(a => <li key={a.id} className={a.firstTry ? 'good' : 'bad'}>
          <span>{countries.get(a.id)?.name}</span><span>{a.points.toLocaleString()}</span></li>)}</ul>
        <button className="primary" onClick={startRound}>Play again</button>
        <button className="text" onClick={() => setGame(null)}>Change mode or area</button>
      </>}

      {view === 'explore' && <>
        <div className="eyebrow">Explore</div>
        {selectedCountry ? <>
          <h1>{selectedCountry.name}</h1>
          <dl className="facts">
            <div><dt>Continent</dt><dd>{selectedCountry.continent}</dd></div>
            <div><dt>Status</dt><dd>{STATUS_LABEL[selectedCountry.status]}</dd></div>
            <div><dt>Mastery</dt><dd>{isMastered(progress, selectedCountry.id) ? 'Mastered' : `${progress[selectedCountry.id]?.firstTry ?? 0} of ${MASTERY_FIRST_TRIES} first-try answers`}</dd></div>
          </dl>
          <p className="note">Government, economy and population figures arrive with the data lenses, each with its official source.</p>
          <button className="primary" onClick={() => { chooseArea(selectedCountry.continent); setView('play'); }}>Play {selectedCountry.continent}</button>
        </> : <p className="message">Click any country to see what it is. Small countries have a ring; island countries have a dashed outline.</p>}
      </>}

      {view === 'progress' && <>
        <div className="eyebrow">Your map</div>
        <h1>{masteredIn([...countries.keys()])} <small>/ {countries.size} mastered</small></h1>
        <p className="message">A country is mastered after {MASTERY_FIRST_TRIES} first-try answers. Mastered countries glow on the globe.</p>
        {AREAS.slice(1).map(a => { const ids = [...countries.values()].filter(c => inArea(c, a)).map(c => c.id); return <AreaProgress key={a} label={a} done={masteredIn(ids)} total={ids.length} />; })}
        <p className="note">Saved in this browser. Accounts and syncing come later.</p>
      </>}
    </aside>

    <div className="legend">
      {view === 'progress' ? <Chip color={COLORS.mastered} label="Mastered" /> : view === 'explore' ? <Chip color={COLORS.selected} label="Selected" /> : <>
        <Chip color={COLORS.correct} label="Found" /><Chip color={COLORS.missed} label="Missed" /><Chip color={COLORS.target} label="Answer" />
      </>}
      <span className="sep" /><span className="ring" /> Small country<span className="dash" /> Island country
    </div>
    {hoverName && <div className="hover-name">{hoverName}</div>}
    <div className="zoom"><button aria-label="Zoom in" onClick={() => globeRef.current?.zoomBy(1)}>+</button><button aria-label="Zoom out" onClick={() => globeRef.current?.zoomBy(-1)}>−</button></div>
    {error && <div className="error">{error}</div>}
    <footer className="credits">Borders: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> (public domain). Disputed areas follow its de facto boundaries.</footer>
  </div>;
}

function AreaProgress({ label, done, total }: { label: string; done: number; total: number }) {
  return <div className="area-progress">
    <div><span>{label}</span><span>{done} / {total}</span></div>
    <div className="track"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
  </div>;
}

const Chip = ({ color, label }: { color: string; label: string }) => <span className="chip"><i style={{ background: color }} />{label}</span>;

const ICONS = {
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 0c2.8 2.7 4.2 6 4.2 10S14.8 19.3 12 22m0-20C9.2 4.7 7.8 8 7.8 12s1.4 7.3 4.2 10M2.5 9h19M2.5 15h19',
  play: 'M6 9h4M8 7v4M15 10h.01M18 8h.01M7 4h10a5 5 0 0 1 5 5v4.5a3.5 3.5 0 0 1-6.3 2.1L14 14h-4l-1.7 1.6A3.5 3.5 0 0 1 2 13.5V9a5 5 0 0 1 5-5Z',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  trophy: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Zm0 2H4a3 3 0 0 0 3 4m10-4h3a3 3 0 0 1-3 4',
};
const Icon = ({ name }: { name: keyof typeof ICONS }) =>
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
