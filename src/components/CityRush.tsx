// City Rush and City Explorer: the screens around the rules in game/cityRush.ts. This component owns the run (setup,
// playing, results), its saved data and its feedback; the globe only draws what it is given (GlobeView.setRushCities),
// and App only highlights the chosen country and forwards globe clicks here.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MutableRefObject } from 'react';
import type { AudioManager } from '../audio';
import type { Country } from '../data/countries';
import { bookOf, loadCityFile, loadCityIndex, type CityFile, type CityIndex } from '../data/cities';
import { ROSTER } from '../data/roster';
import { awards, matchGuess, namesakes, type CityBook, type RushCity } from '../game/cityMatch';
import {
  formatDelta, improvementOf, lastRunOf, learningKey, loadLearning, missedBefore, saveLearning, withLastRun, type Improvement, type LearningStore,
} from '../game/cityLearning';
import { loadShowRegions, regionsAvailable, regionsShown, rushRegionsOf, saveShowRegions } from '../game/rushRegions';
import { loadSubdivisionIndex, loadSubdivisions, type SubdivisionIndex } from '../data/subdivisions';
import {
  coverageOf, DEFAULT_DURATION, DURATIONS, DURATION_NAMES, MENU_DURATIONS, inMenu, durationLabel, rushName, type Duration, elapsedMs, exactPeople, finishRush, formatClock, formatCoverage, formatPeople, guessRush,
  isExpired, milestoneCrossed, newRush, pauseRush, remainingMs, resumeRush, type Rush, type RushMode,
} from '../game/cityRush';
import {
  addTimedRun, loadActive, loadChoice, loadLastCountry, saveLastCountry, saveChoice, type RushChoice, loadExplorer, loadTimedStore, restoreRun, saveActive, saveExplorer, saveTimedStore, timedKey, toSaved,
  withExplorerRun, withoutExplorerRun, type ExplorerStore, type TimedResult,
} from '../game/cityRushRecords';
import type { LngLat } from '../game/geo';
import { searchCountries } from '../game/mystery';
import { challengeLink, comparable as isComparable, type Challenge } from '../game/challengeLink';
import type { GlobeView, RushPoint } from '../map/GlobeView';
import { Burst } from './Results';
import { ChallengeOutcome, ShareSheet } from './Challenge';
import { ExitConfirm } from './ExitConfirm';
import { Sheet, useSheet } from './Sheet';
import { renderShareCard } from './shareCard';
import { Flag, Icon, reducedMotion, useTween } from './ui';

export type RushPhase = 'setup' | 'playing' | 'done';
// Globe events App forwards while City Rush is open. Assigned on every render, so they always see the latest state.
export type RushHandlers = { pick: (countryId: string | null) => void; cityHover: (id: string | null) => void; cityPick: (id: string, at: LngLat) => void };
export const noRushHandlers = (): RushHandlers => ({ pick: () => {}, cityHover: () => {}, cityPick: () => {} });

type Loaded = { file: CityFile; book: CityBook; rank: Map<string, number> };
type Feedback = { kind: 'new' | 'learned' | 'duplicate' | 'unknown'; text: string; key: number; gain?: number };
// What the results screen teaches: this run against the last completed one, and the largest cities missed.
type Lesson = { improvement: Improvement | null; missed: string[] };
type Props = {
  globe: GlobeView | null;
  countries: Map<string, Country>;
  shapeOf: (id: string) => GeoJSON.Geometry | null;
  start: { country: string | null; key: number; vs?: Challenge | null };
  landShapes: () => GeoJSON.Geometry[];   // every country, for the share card's globe
  audio: AudioManager; sound: boolean; onSound: () => void;
  help: boolean; onHelp: (c: { mode: RushMode; durationMs: number | null; country: string }) => void;
  handlers: MutableRefObject<RushHandlers>;
  onHighlight: (h: { selected: string | null; playable: Set<string> | null }) => void;
  onPhase: (p: RushPhase) => void;
  onListOpen: (open: boolean) => void;
  onExit: () => void;
};

// Coverage milestones → the chime of a streak of that size (audio.ts).
const MILESTONE_CUE: { [pct: number]: number } = { 10: 5, 25: 10, 50: 20, 75: 50, 90: 100 };
const isSmall = () => window.innerWidth <= 760;
// The found-cities list starts open only where it fits beside the play panel without covering the map.
const roomForList = () => window.innerWidth >= 1180 && window.innerHeight >= 600;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function prepare(file: CityFile): Loaded {
  const book = bookOf(file);
  return { file, book, rank: new Map(file.cities.map((r, i) => [`gn:${r[0]}`, i])) };
}
const peopleOf = (book: CityBook, found: string[]) => awards(book, found).reduce((a, b) => a + b, 0);
// A city's name, with its region when other cities share the name ("Portland, Maine").
const cityLabel = (book: CityBook, c: RushCity) => (namesakes(book, c) > 1 && c.admin1 ? `${c.name}, ${c.admin1}` : c.name);

export default function CityRush(p: Props) {
  const { globe, countries, audio } = p;
  const [index, setIndex] = useState<CityIndex | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);
  const [country, setCountry] = useState<string | null>(p.start.country);
  const [note, setNote] = useState('');              // a neutral line on the setup screen (an unplayable country…)
  // The mode on the setup screen: a duration (seconds) or City Explorer. Remembered between visits.
  const [choice, setChoiceState] = useState<RushChoice>(loadChoice);
  const setChoice = (c: RushChoice) => { setChoiceState(c); saveChoice(c); };
  const mode: RushMode = choice === 'explorer' ? 'explorer' : 'timed';
  // The menu: Quick, Classic and City Explorer, plus an older length (5 or 20 minutes) only when a challenge asks for it.
  const modeChoices: RushChoice[] = [...MENU_DURATIONS, ...(choice !== 'explorer' && !inMenu(choice) ? [choice] : []), 'explorer'];
  const [data, setDataState] = useState<Loaded | null>(null);
  const dataRef = useRef<Loaded | null>(null);
  const setData = (d: Loaded | null) => { dataRef.current = d; setDataState(d); };
  const [dataFailed, setDataFailed] = useState(false);
  const [rush, setRushState] = useState<Rush | null>(null);
  const rushRef = useRef<Rush | null>(null);
  const commit = (r: Rush | null) => { rushRef.current = r; setRushState(r); };
  const [result, setResult] = useState<TimedResult | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [party, setParty] = useState<{ n: number; key: number } | null>(null);
  const [welcome, setWelcome] = useState('');
  const [text, setText] = useState('');
  const [listOpen, setListOpenState] = useState(roomForList);
  const setListOpen = (o: boolean) => { setListOpenState(o); p.onListOpen(o); };
  const [timed, setTimed] = useState(loadTimedStore);
  const explorerRef = useRef<ExplorerStore>(loadExplorer());
  const [explorer, setExplorerState] = useState(explorerRef.current);
  const setExplorer = (s: ExplorerStore) => { explorerRef.current = s; setExplorerState(s); saveExplorer(s); };
  const [hover, setHover] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'end' | 'abandon' | 'reset' | null>(null);
  const learningRef = useRef<LearningStore>(loadLearning());
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [peek, setPeek] = useState(false);   // phones: results folded down to one line to see the map
  const [subIndex, setSubIndex] = useState<SubdivisionIndex | null>(null);
  const [showRegions, setShowRegionsState] = useState(loadShowRegions);
  const setShowRegions = (on: boolean) => { setShowRegionsState(on); saveShowRegions(on); };
  // A friend's challenge (a link): its country and length are preselected and its target shown, until another country
  // is chosen. Never written anywhere.
  const rushVs = (c: Challenge | null | undefined) => (c?.kind === 'rush' && c.target !== null ? c : null);
  const [vs, setVs] = useState(() => rushVs(p.start.vs));
  const [sharing, setSharing] = useState(false);
  // Phones: the setup is a bottom sheet, open when City Rush opens; a tap on the globe (choosing a country) folds it.
  const [setupOpen, setSetupOpen] = useSheet(true);
  // Set when a timed run ran out while the page was closed: its results say so.
  const [endedAway, setEndedAway] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fxKey = useRef(0);

  const phase: RushPhase = !rush ? 'setup' : rush.phase === 'playing' ? 'playing' : 'done';
  const target = country ? countries.get(country) : undefined;
  const entry = country && index ? index.countries[country] : undefined;
  const ready = !!data && data.file.country === country && !!entry?.playable;
  const playableSet = useMemo(() => (index ? new Set(Object.entries(index.countries).filter(([, e]) => e.playable).map(([id]) => id)) : null), [index]);

  useEffect(() => { p.onPhase(phase); }, [phase]);
  useEffect(() => { p.onHighlight({ selected: country, playable: playableSet }); }, [country, playableSet]);
  useEffect(() => { p.onListOpen(listOpen); }, []);

  // The index is small; it says which countries can be played and how many names each has.
  const loadIndex = () => { setIndexFailed(false); loadCityIndex().then(setIndex, () => setIndexFailed(true)); };
  useEffect(loadIndex, []);

  // A timed run in progress comes back with its own deadline (it never pauses); one that ran out meanwhile is recorded
  // and its results shown. Otherwise a shared link's country, or the last explored one, is preselected.
  useEffect(() => {
    const a = loadActive();
    let live = true;
    if (a) {
      setCountry(a.country);
      if (a.durationMs !== null && (DURATIONS as readonly number[]).includes(a.durationMs / 1000)) setChoiceState((a.durationMs / 1000) as Duration);
      loadCityFile(a.country).then(f => {
        if (!live) return;
        const d = prepare(f);
        setData(d);
        const r = restoreRun(a, d.book.reachable, f.version, Date.now());
        if (isExpired(r, Date.now())) { setEndedAway(true); finish(r, d); }
        else { commit(r); setWelcome('Welcome back. The clock kept running while you were away.'); }
      }, () => { if (live) { saveActive(null); setDataFailed(true); } });
      return () => { live = false; };
    }
    if (vs) setChoiceState(vs.durationS === null ? 'explorer' : (vs.durationS as Duration));
    if (!p.start.country) { const last = loadLastCountry() ?? explorerRef.current.last; if (last) setCountry(last); }
  }, []);
  // A new request from the Play panel or a link while City Rush is already open: back to setup on that country.
  const firstStart = useRef(p.start.key);
  useEffect(() => {
    if (p.start.key === firstStart.current || rushRef.current?.phase === 'playing') return;
    commit(null);
    setResult(null);
    if (p.start.country) setCountry(p.start.country);
    const c = rushVs(p.start.vs);
    setVs(c);
    if (c) setChoiceState(c.durationS === null ? 'explorer' : (c.durationS as Duration));
  }, [p.start.key]);

  // The chosen country's cities: fetched once (cached), then the globe frames it.
  useEffect(() => {
    if (!country || (index && !index.countries[country]?.playable)) { if (!rushRef.current) setData(null); return; }
    if (data?.file.country === country) { globe?.frame(data.file.frame.center, data.file.frame.radiusKm); return; }
    let live = true;
    setDataFailed(false);
    loadCityFile(country).then(f => {
      if (!live) return;
      const d = prepare(f);
      setData(d);
      globe?.frame(f.frame.center, f.frame.radiusKm);
    }, () => live && setDataFailed(true));
    return () => { live = false; };
  }, [country, index, globe]);

  // ---- Regions -----------------------------------------------------------------------------------------------------------
  // The small subdivision index loads when City Rush opens; a country's borders only when it is chosen and has them.
  useEffect(() => { loadSubdivisionIndex().then(setSubIndex, () => setSubIndex(null)); }, []);
  const regionsOk = regionsAvailable(subIndex, country);
  const drawRegions = regionsShown(showRegions, regionsOk);
  useEffect(() => {
    if (!drawRegions || !country) { globe?.setRushRegions(null); return; }
    let live = true;
    loadSubdivisions(country).then(set => { if (live) globe?.setRushRegions(rushRegionsOf(set)); }, () => { if (live) globe?.setRushRegions(null); });
    return () => { live = false; };
  }, [drawRegions, country, globe]);
  useEffect(() => () => globe?.setRushRegions(null), [globe]);
  const regionToggle = regionsOk && <label className="rush-toggle"><input type="checkbox" checked={showRegions} onChange={e => setShowRegions(e.target.checked)} /> Show regions</label>;

  // ---- The clock -------------------------------------------------------------------------------------------------------
  // Watches the deadline a few times a second. It renders nothing: the time on screen is RushClock's, which redraws only
  // itself, so a long City Explorer list is never rebuilt by the clock. Time always comes from Date.now(), never ticks.
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => {
      const r = rushRef.current;
      if (r && r.phase === 'playing' && isExpired(r, Date.now())) finish(r);
    }, 250);
    return () => clearInterval(id);
  }, [phase, data]);
  // Explorer time counts only while the page is visible; a timed run checks its deadline as soon as the page is back.
  useEffect(() => {
    const onVisibility = () => {
      const r = rushRef.current;
      if (!r || r.phase !== 'playing') return;
      const now = Date.now();
      if (document.visibilityState === 'hidden') { const next = pauseRush(r, now); commit(next); persist(next); }
      else if (isExpired(r, now)) finish(r);
      else commit(resumeRush(r, now));
    };
    const onHide = () => { const r = rushRef.current; if (r?.phase === 'playing') persist(r); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onHide); onHide(); };
  }, []);

  // ---- Globe -------------------------------------------------------------------------------------------------------------
  // The cities found, in order, with the people each added.
  const found = useMemo(() => {
    if (!rush || !data) return [];
    const gains = awards(data.book, rush.found);
    return rush.found.map((id, i) => ({ c: data.book.cities.get(id), gain: gains[i] })).filter((f): f is { c: RushCity; gain: number } => !!f.c);
  }, [rush?.found, data]);
  // On the results screen, the missed cities join the map as hollow rings, labelled first. Never during play.
  const missedShown = phase === 'done' && lesson ? lesson.missed : [];
  const points = useMemo<RushPoint[]>(() => {
    if (!data) return [];
    const pt = (c: RushCity, missed?: boolean): RushPoint => ({ id: c.id, name: c.name, at: [c.lng, c.lat], rank: data.rank.get(c.id) ?? 1e9, missed });
    return [...found.map(f => pt(f.c)), ...missedShown.flatMap(id => { const c = data.book.cities.get(id); return c ? [pt(c, true)] : []; })];
  }, [found, data, missedShown]);
  const pinned = useMemo(() => (phase === 'playing' ? (found.length ? [found[found.length - 1].c.id] : []) : missedShown), [found, phase, missedShown]);
  useEffect(() => { globe?.setRushCities(points, pinned); }, [globe, points, pinned]);
  useEffect(() => () => globe?.setRushCities([]), [globe]);

  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  p.handlers.current = {
    pick: id => {
      if (phase !== 'setup' || !id) return;
      chooseCountry(id);
    },
    cityHover: id => { clearTimeout(hoverTimer.current); setHover(id); },
    // A tap on a phone: show the name for a moment.
    cityPick: id => { setHover(id); clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(null), 2500); },
  };

  // ---- Setup ---------------------------------------------------------------------------------------------------------------
  function chooseCountry(id: string) {
    const c = countries.get(id), e = index?.countries[id];
    setCountry(id);
    saveLastCountry(id);
    setResult(null);
    setNote(!index || e?.playable ? '' : `${c?.name ?? id} has ${e ? plural(e.findable, 'city', 'cities') : 'no cities'} in our data, too few to play yet.`);
  }
  function randomCountry() {
    const ids = [...(playableSet ?? [])].filter(id => id !== country && countries.has(id));
    if (ids.length) chooseCountry(ids[Math.floor(Math.random() * ids.length)]);
  }
  const saved = country ? explorer.countries[country] : undefined;
  const savedCount = saved && data?.file.country === country ? saved.found.filter(id => data.book.reachable.has(id)).length : saved?.found.length ?? 0;

  function begin({ fresh = false, as = choice }: { fresh?: boolean; as?: RushChoice } = {}) {
    if (!data || !country || data.file.country !== country) return;
    const now = Date.now(), saved = explorerRef.current.countries[country];
    setChoice(as);
    let r: Rush;
    if (as === 'explorer' && saved && !fresh) r = restoreRun(saved, data.book.reachable, data.file.version, now);
    else {
      r = as === 'explorer' ? newRush(country, data.file.version, 'explorer', now) : newRush(country, data.file.version, 'timed', now, as);
      if (as === 'explorer' && fresh) setExplorer(withoutExplorerRun(explorerRef.current, country));
    }
    saveLastCountry(country);
    commit(r);
    setResult(null);
    setLesson(null);
    setPeek(false);
    setFeedback(null);
    setParty(null);
    setWelcome('');
    setText('');
    setConfirm(null);
    setSharing(false);
    setEndedAway(false);
    persist(r);
    globe?.frame(data.file.frame.center, data.file.frame.radiusKm);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // ---- Playing -------------------------------------------------------------------------------------------------------------
  function persist(r: Rush) {
    const now = Date.now();
    if (r.mode === 'timed') saveActive(r.phase === 'playing' ? toSaved(r, now) : null);
    else setExplorer(withExplorerRun(explorerRef.current, toSaved(r, now)));
  }

  // Ends a run as completed: the deadline passed, or the player finished. Records the personal best (timed) and what the
  // run teaches the next one (Cities You Missed), once per run however many paths notice its end, even across a refresh
  // (the learning record keeps the run's start time). An abandoned run never comes here.
  const recorded = useRef(new Set<string>());
  function finish(r: Rush, d: Loaded | null = dataRef.current) {
    const id = `${r.country}@${r.startedAt}`;
    if (r.phase !== 'playing' || recorded.current.has(id)) return;
    recorded.current.add(id);
    const done = finishRush(r, Date.now());
    const lkey = learningKey(done.country, done.durationMs), prev = learningRef.current[lkey];
    const already = done.mode === 'timed' && prev?.runId === String(done.startedAt);
    if (done.mode === 'timed') {
      if (!already) {
        const store = loadTimedStore(), key = timedKey(done.country, done.durationMs!, done.version);
        const res = addTimedRun(store[key], done, d ? peopleOf(d.book, done.found) : 0, d?.book.total ?? 0);
        const all = { ...store, [key]: res.record };
        saveTimedStore(all);
        setTimed(all);
        setResult(res);
        if (res.newBest) setTimeout(() => audio.play({ kind: 'record' }), 300);
      }
      saveActive(null);
    } else {
      setExplorer(withExplorerRun(explorerRef.current, toSaved(done, Date.now())));
    }
    if (d) {
      const last = lastRunOf(done, d.book);
      setLesson({ improvement: already ? null : improvementOf(prev, d.book, d.file.version, done.found), missed: last.missed });
      if (!already) { learningRef.current = withLastRun(learningRef.current, last); saveLearning(learningRef.current); }
    }
    commit(done);
    setConfirm(null);
    setAsking(false);
    setText('');
    if (d) globe?.frame(d.file.frame.center, d.file.frame.radiusKm);
  }

  // Abandons a timed run: no record, no learning, back to the country. (City Explorer keeps its map until reset.)
  // Exit: back to the game menu, never to results. City Explorer keeps its map. A timed run with cities named asks first,
  // then is abandoned: no score saved, no Cities You Missed, nothing recorded. With none named there is nothing to lose.
  const [asking, setAsking] = useState(false);
  function exitPressed() {
    const r = rushRef.current;
    if (!r || r.phase !== 'playing') return;
    if (r.mode === 'explorer') { persist(pauseRush(r, Date.now())); leaveToMenu(); return; }
    if (!r.found.length) { leaveToMenu(); return; }
    setAsking(true);
  }
  function leaveToMenu() {
    const r = rushRef.current;
    if (r?.mode === 'timed' && r.phase === 'playing') saveActive(null);
    setAsking(false);
    commit(null);
    setResult(null);
    setLesson(null);
    setConfirm(null);
    p.onExit();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = rushRef.current;
    if (!r || !data || r.phase !== 'playing') return;
    const now = Date.now(), typed = text;
    const match = matchGuess(data.book, typed);
    const cityId = match && (match.kind === 'exact' || match.kind === 'typo') ? match.id : null;
    const named = match && (match.kind === 'exact' || match.kind === 'typo') ? match.ids : null;
    const { rush: next, outcome } = guessRush(r, typed, named, now);
    const key = ++fxKey.current;
    if (outcome === 'over') { finish(r); return; }
    if (outcome === 'empty') return;
    setWelcome('');
    const c = cityId ? data.book.cities.get(cityId) : undefined;
    // A corrected typo names the city it was read as, in place of the plain name.
    const typo = match?.kind === 'typo' ? 'Accepted as ' : '';
    if (outcome === 'new' && c) {
      commit(next);
      persist(next);
      // Every city the name found and that is new: one, or all the Springfields at once.
      const added = next.found.slice(r.found.length), first = data.book.cities.get(added[0]) ?? c;
      globe?.freshen(added);
      setText('');
      const gains = awards(data.book, next.found), mine = gains.slice(gains.length - added.length), gain = mine.reduce((x, y) => x + y, 0);
      const before = coverageOf(gains.slice(0, -added.length).reduce((x, y) => x + y, 0), data.book.total);
      const after = coverageOf(gains.reduce((x, y) => x + y, 0), data.book.total);
      const parent = first.partOf ? data.book.cities.get(first.partOf) : undefined;
      const where = added.map(id => data.book.cities.get(id)?.admin1).filter(Boolean) as string[];
      const label = added.length > 1
        ? `${first.name} · ${added.length} cities (${where.slice(0, 3).join(', ')}${where.length > 3 ? ` + ${where.length - 3} more` : ''})`
        : cityLabel(data.book, first);
      // Named this time after being missed last time: the lesson stuck. Same people as always, no bonus.
      const missed = missedBefore(learningRef.current[learningKey(r.country, r.durationMs)], data.book);
      const learned = added.some((id, i) => missed.has(id) && mine[i] > 0);
      setFeedback({
        kind: learned ? 'learned' : 'new', key, gain,
        text: learned ? `Learned! ${typo}${label} · +${exactPeople(gain)} people`
          : gain > 0 ? `${typo}${label} · +${exactPeople(gain)} people`
          : first.population <= 0 ? `${typo}${label} · no population recorded`
          : `${typo}${label} · already counted in ${parent?.name ?? 'its city'}`,
      });
      const m = milestoneCrossed(before, after);
      if (m) { setParty({ n: m, key }); audio.play({ kind: 'milestone', streak: MILESTONE_CUE[m] }); }
      else audio.play({ kind: 'correct', streak: Math.min(next.found.length, 10) });
    } else if (outcome === 'duplicate' && c && match && match.kind !== 'ambiguous' && match.kind !== 'small') {
      globe?.freshen([c.id]);
      setText('');
      // A bare name finds every city of the name at once, so a repeat means all of them are found already.
      const all = !match.qualified && match.ids.length > 1;
      setFeedback({ kind: 'duplicate', key, text: all ? `Already found: every ${c.name} (${match.ids.length})` : `Already found: ${cityLabel(data.book, c)}` });
    } else {
      // Kept and selected, so a typo is one keystroke from fixed and a new name simply types over it.
      const shown = typed.trim();
      setFeedback({
        kind: 'unknown', key,
        text: match?.kind === 'ambiguous' ? `“${shown}” is close to more than one city. Check the spelling.`
          : match?.kind === 'small' ? `${match.name} is a smaller place, not on the list`
          : `“${shown}” is not on the list`,
      });
      if (match?.kind !== 'small') audio.play({ kind: 'wrong' });
      requestAnimationFrame(() => inputRef.current?.select());
    }
    inputRef.current?.focus();
  }

  function endPressed() {
    const r = rushRef.current;
    if (!r) return;
    // A timed run ends on a second press, so a stray click never throws one away. Explorer progress is never lost.
    if (r.mode === 'timed' && confirm !== 'end') { setConfirm('end'); setTimeout(() => setConfirm(c => (c === 'end' ? null : c)), 3000); return; }
    finish(r);
  }

  function lookAt(c: RushCity, fly: boolean) {
    globe?.freshen([c.id]);
    if (rushRef.current?.phase === 'done' && isSmall()) setPeek(true);
    if (fly && globe) globe.fly({ center: [c.lng, c.lat], zoom: Math.max(globe.map.getZoom(), 5) }, 800);
  }

  // ---- Results -------------------------------------------------------------------------------------------------------------
  function exitToSetup() {
    commit(null);
    setResult(null);
    setLesson(null);
    setFeedback(null);
    setConfirm(null);
    setSharing(false);
  }
  function resetExplorer() {
    if (!country) return;
    if (confirm !== 'reset') { setConfirm('reset'); return; }
    setExplorer(withoutExplorerRun(explorerRef.current, country));
    exitToSetup();
  }
  // The result card: the country on the globe with every city found, and the numbers of this run.
  async function makeCard() {
    const r = rushRef.current!, d = dataRef.current!, t = countries.get(r.country)!;
    const shape = p.shapeOf(r.country), found = r.found.flatMap(id => { const c = d.book.cities.get(id); return c ? [[c.lng, c.lat] as LngLat] : []; });
    const dot = found.length > 800 ? 1.4 : found.length > 200 ? 1.9 : 2.6;
    return renderShareCard(
      { kind: 'rush', durationMs: r.durationMs, place: t.name, iso2: t.iso2, coverage: coverageOf(peopleOf(d.book, r.found), d.book.total), people: peopleOf(d.book, r.found), cities: r.found.length, elapsedMs: elapsedMs(r, Date.now()) },
      { center: d.file.frame.center, radiusKm: d.file.frame.radiusKm, land: p.landShapes(), shapes: shape ? [{ geometry: shape, fill: '#1f8f86' }] : [], points: found.map(at => ({ at, color: '#ffcf5c', r: dot })) },
      location.host);
  }
  const shareLink = () => {
    const r = rushRef.current!, d = dataRef.current!;
    return challengeLink(location.origin, import.meta.env.BASE_URL, { kind: 'rush', country: r.country, durationS: r.durationMs === null ? null : r.durationMs / 1000, target: Math.round(coverageOf(peopleOf(d.book, r.found), d.book.total) * 10) / 10, version: d.file.version });
  };
  // The challenge applies to this run when it is the same country and length.
  const vsHere = vs && rush && vs.country === rush.country && vs.durationS === (rush.durationMs === null ? null : rush.durationMs / 1000) ? vs : null;

  // ---- Render ----------------------------------------------------------------------------------------------------------------
  const now = Date.now();
  const count = found.length;
  const people = found.reduce((x, f) => x + f.gain, 0);
  const total = data?.book.total ?? entry?.population ?? 0;
  const findable = data?.book.reachable.size ?? entry?.findable ?? 0;
  const coverage = coverageOf(people, total);
  const shownPeople = useTween(people, 600);
  const shownCoverage = coverageOf(shownPeople, total);
  // The personal best that matters: the run's own duration once one is on, else the duration chosen on setup.
  const recordFor = (sec: number) => (country && data && data.file.country === country ? timed[timedKey(country, sec * 1000, data.file.version)] : undefined);
  const record = rush?.durationMs ? recordFor(rush.durationMs / 1000) : choice === 'explorer' ? undefined : recordFor(choice);
  const bestCoverage = record ? coverageOf(record.best, record.total) : null;
  const hoverCity = hover ? data?.book.cities.get(hover) : undefined;
  const sourceLine = index ? `Places of ${index.minPopulation.toLocaleString()}+ people in GeoNames` : 'Places from GeoNames';
  const gained = (feedback?.kind === 'new' || feedback?.kind === 'learned') && !!feedback.gain;
  const gainNote = (f: { c: RushCity; gain: number }) => f.gain > 0 ? `+${formatPeople(f.gain)}`
    : f.c.population <= 0 ? 'no figure' : `in ${data?.book.cities.get(f.c.partOf ?? '')?.name ?? 'its city'}`;

  // Rows are memoised and the click goes through a ref, so adding a city renders one new row, not the whole list again.
  const lookRef = useRef(lookAt);
  lookRef.current = lookAt;
  const onLook = useMemo(() => (c: RushCity, fly: boolean) => lookRef.current(c, fly), []);
  const list = (fly: boolean) => <ol className="rush-found">
    {[...found].reverse().map(f => <FoundRow key={f.c.id} c={f.c} gain={f.gain} note={gainNote(f)} fly={fly} onLook={onLook} />)}
  </ol>;

  // The list as it stands, rebuilt only when a city is found: typing and the clock never touch it, which keeps a long
  // City Explorer session (thousands of cities) responsive.
  const playingList = useMemo(() => (data && count ? list(rush?.mode === 'explorer') : null), [found, data, rush?.mode]);

  return <>
    {phase === 'setup' && <Sheet open={setupOpen} onOpen={setSetupOpen} className="rush-setup" label="City Rush"
      summary={<><strong>{target ? <><Flag iso2={target.iso2} />{target.name}</> : 'City Rush'}</strong><small>{target && entry?.playable ? (choice === 'explorer' ? 'City Explorer' : DURATION_NAMES[choice]) : 'Choose a country'}</small></>}
      action={ready && <button className="btn primary small sheet-go" onClick={() => begin()}>Start</button>}
      footer={target && entry?.playable && <>
        <button className="btn primary" autoFocus disabled={!ready} onClick={() => begin()}>{!ready ? 'Loading cities…'
          : mode === 'explorer' ? (savedCount > 0 ? `Continue exploring · ${plural(savedCount, 'city', 'cities')}` : 'Start exploring') : `Start ${DURATION_NAMES[choice as Duration]}`}</button>
        {mode === 'explorer' && savedCount > 0 && <button className="link center" onClick={() => begin({ fresh: true })}>Start a clean map instead</button>}
      </>}>
      <nav className="crumbs" aria-label="Where you are"><button className="link" onClick={p.onExit}>Games</button><span aria-hidden="true">›</span><span className="eyebrow">City Rush</span></nav>
      <h1 className="with-flag">{target ? <><Flag iso2={target.iso2} size="lg" />{target.name}</> : 'Choose a country'}</h1>
      <CountrySearch countries={countries} index={index} onPick={chooseCountry} />
      {indexFailed && <p className="muted">The city list could not load. <button className="link" onClick={loadIndex}>Try again</button></p>}
      {note && <p className="muted" role="status">{note}</p>}
      {!country && !note && <p className="muted">Search, click a country on the globe, or <button className="link" onClick={randomCountry} disabled={!index}>pick one at random</button>.</p>}
      {target && entry?.playable && <>
        <p className="rush-goal">Name as many cities in {target.name} as you can. Each one adds its people to your coverage.</p>
        <div className="rush-modes" role="radiogroup" aria-label="Game mode">
          {modeChoices.map(c => {
            const best = c === 'explorer' ? undefined : recordFor(c), on = choice === c;
            return <button key={c} role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => setChoice(c)}>
              <span className="label">{c === 'explorer' ? 'City Explorer' : DURATION_NAMES[c]}{c === DEFAULT_DURATION && <em>Recommended</em>}</span>
              <span className="time">{c === 'explorer' ? 'Unlimited' : `${c / 60} min`}</span>
              <span className="mode-best">{c === 'explorer' ? (savedCount ? `${savedCount.toLocaleString()} found, saved` : 'Saves as you go') : best ? `Best ${formatCoverage(coverageOf(best.best, best.total))}` : ''}</span>
            </button>;
          })}
        </div>
        {vs && vs.country === country && <p className="challenge-target" role="status"><Icon name="bolt" />Your friend&rsquo;s score: <b>{vs.target!.toFixed(1)}%</b> in {vs.durationS === null ? 'City Explorer' : DURATION_NAMES[vs.durationS as Duration]}. Beat it.</p>}
        {dataFailed && <p className="muted">These cities could not load. Check your connection and choose the country again.</p>}
        {regionToggle}
      </>}
      <details className="how-scoring">
        <summary>How scoring works</summary>
        <ul>
          <li>Every city you name adds its people to your score, so big cities count most: one capital can be worth hundreds of villages.</li>
          <li>Coverage is the share of the people living in our list of {target ? `${target.name}’s` : 'the country’s'} cities (places of 1,000 or more), not of the whole national population, which also counts people outside them.</li>
          <li>A name counts every city of that name at once, one per state or region: “Springfield” finds them all. Add a region for just one (“Springfield, Illinois”). Districts inside a city count toward that city.</li>
          <li>Quick and Classic rushes run on a clock that never pauses and keep your best score. City Explorer has no clock: your map is saved and you can keep adding to it.</li>
        </ul>
        <p className="fine">City data: GeoNames (CC BY 4.0).</p>
      </details>
    </Sheet>}

    {phase === 'playing' && rush && target && <div className="rush-top">
      <section className="hud rush-hud" aria-label="City Rush">
        {feedback && <span className={`hud-flash ${party?.key === feedback.key || feedback.kind === 'learned' ? 'gold' : feedback.kind === 'new' ? 'good' : feedback.kind === 'unknown' ? 'bad' : ''}`} key={feedback.key} aria-hidden="true" />}
        <div className="hud-top">
          <span className="hud-area"><Flag iso2={target.iso2} /><span className="mode-name">{rushName(rush.durationMs)} · </span><span className="country-name">{target.name}</span></span>
          <span className="spacer" />
          <span className="hud-tools">
          <button className={listOpen ? 'icon-btn on' : 'icon-btn'} aria-label={listOpen ? 'Hide your cities' : 'Show your cities'} aria-pressed={listOpen} onClick={() => setListOpen(!listOpen)}><Icon name="list" /></button>
          {regionsOk && <button className={showRegions ? 'icon-btn on' : 'icon-btn'} aria-label={showRegions ? 'Hide regions' : 'Show regions'} aria-pressed={showRegions} title="Show regions" onClick={() => setShowRegions(!showRegions)}><Icon name="layers" /></button>}
          <button className={p.help ? 'icon-btn on' : 'icon-btn'} aria-label="How to play" aria-expanded={p.help} title="How to play" onClick={() => p.onHelp({ mode: rush.mode, durationMs: rush.mode === 'timed' ? rush.durationMs : null, country: target.name })}><Icon name="help" /></button>
          <button className="icon-btn sound" data-silent aria-label={p.sound ? 'Mute sounds' : 'Turn sounds on'} aria-pressed={p.sound} onClick={p.onSound}><Icon name={p.sound ? 'sound' : 'mute'} /></button>
          </span>
          <button className="btn small ghost exit" onClick={exitPressed} title={rush.mode === 'timed' ? 'Leave this run (no score is saved)' : 'Back to the menu (your map is saved)'}><Icon name="exit" />Exit</button>
        </div>
        <div className="hud-readouts rush-readouts">
          <RushClock rush={rush} />
          <div className="readout score" aria-label={`City population coverage ${formatCoverage(coverage)}`}><span>Coverage</span>
            <strong className={gained ? 'up' : ''} key={gained ? feedback!.key : 'n'}>{formatCoverage(shownCoverage)}</strong>
            {gained && <em className="gain" key={`g${feedback!.key}`} aria-hidden="true">+{formatPeople(feedback!.gain!)}</em>}
          </div>
          <div className="readout"><span>Cities</span><strong>{count.toLocaleString()}</strong></div>
        </div>
        <div className="rush-progress">
          <div className="bar" role="progressbar" aria-label="City population coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(coverage * 10) / 10} aria-valuetext={`${exactPeople(people)} of ${exactPeople(total)} people`}>
            <i style={{ width: `${shownCoverage}%` }} />
            {rush.mode === 'timed' && bestCoverage !== null && bestCoverage > 0 && <b className="bar-mark" style={{ left: `${bestCoverage}%` }} title={`Your best: ${formatCoverage(bestCoverage)}`} />}
            {vsHere && <b className="bar-mark vs" style={{ left: `${Math.min(100, vsHere.target!)}%` }} title={`Your friend: ${formatCoverage(vsHere.target!)}`} />}
          </div>
          <div className="progress-line">
            <span title={`${exactPeople(people)} of ${exactPeople(total)} people`}><b>{formatPeople(shownPeople)}</b> of {formatPeople(total)} people{rush.mode === 'timed' && bestCoverage !== null ? ` · best ${formatCoverage(bestCoverage)}` : ''}</span>
            <button className={confirm === 'end' ? 'btn small danger finish' : 'btn small finish'} onClick={endPressed} title={rush.mode === 'timed' ? 'End now and see your results' : 'See your results'}>{confirm === 'end' ? 'Finish now?' : 'Finish'}</button>
          </div>
        </div>
        <div className={`rush-msg ${feedback?.kind ?? ''}`} aria-live="polite" key={`m${feedback?.key ?? 0}`}>
          {feedback ? <><b aria-hidden="true">{feedback.kind === 'new' ? '✓' : feedback.kind === 'learned' ? '★' : feedback.kind === 'duplicate' ? '↺' : '✕'}</b>{feedback.text}</>
            : welcome || `Type any city in ${target.name}, then press Enter.`}
        </div>
      </section>
      <form className="answer-bar rush-bar" onSubmit={submit}>
        <input ref={inputRef} autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setText(''); }}
          placeholder={`A city in ${target.name}…`} aria-label={`Name a city in ${target.name}`}
          autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false} enterKeyHint="send" />
        <button type="submit" aria-label="Submit city" data-silent><Icon name="arrow" /></button>
      </form>
      {party && <div className={`celebrate t${party.n >= 75 ? 4 : party.n >= 50 ? 3 : 2}`} key={`c${party.key}`} role="status">
          {!reducedMotion() && <span className="sparks" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--a': `${i * 36}deg` } as CSSProperties} />)}</span>}
          <strong><span aria-hidden="true">🏙️</span> {party.n}% covered!</strong><small>{party.n >= 90 ? 'Legendary' : 'Keep going'}</small>
        </div>}
    </div>}

    {asking && rush && <ExitConfirm title={`Exit this ${rushName(rush.durationMs)}?`}
      detail={`The run will be abandoned: no score is saved, and the cities you missed stay hidden. The clock keeps running while you decide.`}
      onStay={() => { setAsking(false); requestAnimationFrame(() => inputRef.current?.focus()); }} onExit={leaveToMenu} />}
    {phase === 'playing' && listOpen && data && <aside className="card panel rush-list" aria-label="Your cities">
      <div className="card-head"><div className="eyebrow">Your cities · {count.toLocaleString()}</div><button className="close" aria-label="Hide your cities" onClick={() => setListOpen(false)}>×</button></div>
      {count ? playingList : <p className="muted">Every city you name lands here and on the globe, with the people it adds.</p>}
    </aside>}

    {phase === 'done' && rush && target && data && <aside className={peek ? 'card panel rush-results peek' : 'card panel rush-results'} aria-label="Results">
      {/* Phones: the results can step down to one line, so the map (and the missed cities on it) can be seen whole. */}
      <div className="results-peek">
        <span><b>{formatCoverage(coverage)}</b> · {target.name}</span>
        <button className="btn small" aria-expanded={!peek} onClick={() => setPeek(!peek)}>{peek ? 'Show results' : 'Show map'}</button>
      </div>
      <div className="card-head">
        <div className="eyebrow">{rush.mode === 'timed' ? `${rushName(rush.durationMs)} · ${durationLabel(rush.durationMs!)}` : 'City Explorer'}</div>
        <button className="btn small ghost back-menu" onClick={p.onExit}><Icon name="back" />Back to menu</button>
      </div>
      <h1 className="with-flag"><Flag iso2={target.iso2} size="lg" />{target.name}</h1>
      {result?.newBest && <div className="record"><Burst />New personal best<span>Up from {formatCoverage(coverageOf(result.before ?? 0, total))}.</span></div>}
      {endedAway && <p className="away-note" role="status">Time ran out while you were away. Your run was saved as it stood, with every city you named.</p>}
      <div className="sprint-score rush-score"><strong>{formatCoverage(coverage)}</strong><span>city population coverage</span></div>
      {vsHere && <ChallengeOutcome challenge={vsHere} result={Math.round(coverage * 10) / 10} comparable={isComparable(vsHere, data.file.version)} format={n => `${n.toFixed(1)}%`} />}
      {rush.mode === 'timed'
        ? <button className="btn primary" autoFocus onClick={() => begin({ as: rush.durationMs! / 1000 as Duration })}>Play again · {rushName(rush.durationMs)}</button>
        : <button className="btn primary" autoFocus onClick={() => begin({ as: 'explorer' })}>Keep exploring</button>}
      <div className="result-actions">
        <button className="btn challenge-btn" onClick={() => setSharing(true)}><Icon name="share" />Share result</button>
        <button className="btn" onClick={exitToSetup}>Change country or mode</button>
      </div>
      {sharing && <ShareSheet make={makeCard} link={shareLink()} fileName={`atlas-${rush.mode === 'timed' ? 'city-rush' : 'city-explorer'}-${rush.country.toLowerCase()}.jpg`} onClose={() => setSharing(false)} />}
      {lesson?.improvement && <Progress i={lesson.improvement} />}
      <section className="rush-missed" aria-label="Cities you missed">
        <div className="eyebrow">Cities you missed</div>
        {lesson && lesson.missed.length > 0
          ? <>
            <ol>{lesson.missed.map(id => {
              const c = data.book.cities.get(id);
              return c && <li key={id}><button onClick={() => lookAt(c, true)}>
                <span className="name">{c.name}</span>
                <span className="meta">{c.admin1}</span>
                <b title={`${exactPeople(c.population)} people`}>{formatPeople(c.population)}</b>
              </button></li>;
            })}</ol>
            <p className="fine">The largest cities you did not name. Remember them next time: once you do, the next ones appear.</p>
          </>
          : <p className="muted">You named every city on our list for {target.name}. Nothing left to learn here.</p>}
      </section>
      <dl className="facts">
        <div><dt>Population discovered</dt><dd title={`${exactPeople(people)} of ${exactPeople(total)} people`}>{formatPeople(people)} <span className="muted">of {formatPeople(total)}</span></dd></div>
        <div><dt>Cities discovered</dt><dd>{count.toLocaleString()} <span className="muted">of {findable.toLocaleString()}</span></dd></div>
        {rush.mode === 'timed'
          ? <>
            <div><dt>Time</dt><dd>{elapsedMs(rush, now) < rush.durationMs! - 500 ? `Finished at ${formatClock(elapsedMs(rush, now))} of ${formatClock(rush.durationMs!)}` : formatClock(rush.durationMs!)}</dd></div>
            <div><dt>Personal best</dt><dd>{result?.first ? 'First run: the score to beat' : result
              ? `${formatCoverage(coverageOf(result.record.best, total))}${result.newBest ? ' · new' : result.before !== null && people < result.before ? '' : ' · matched'}`
              : record ? formatCoverage(coverageOf(record.best, record.total)) : '–'}</dd></div>
          </>
          : <div><dt>Time exploring</dt><dd>{formatClock(elapsedMs(rush, now))}</dd></div>}
      </dl>
      {count > 0 && <details className="rush-details">
        <summary>Your cities · {count.toLocaleString()}</summary>
        {list(true)}
      </details>}
      {regionToggle}
      <button className="link center" onClick={p.onExit}>Back to menu</button>
      {rush.mode === 'explorer' && <button className={confirm === 'reset' ? 'btn danger' : 'btn'} onClick={resetExplorer}>{confirm === 'reset' ? 'Reset: clear this map for good?' : 'Reset progress'}</button>}
      <p className="fine">Coverage is the share of the people in {target.name}’s cities in our list ({sourceLine}, CC BY 4.0), not of its national population. Districts listed inside a city count toward that city.</p>
    </aside>}

    {hoverCity && <div className="hover-name city"><Icon name="city" />{hoverCity.name}<small>{[hoverCity.admin1, hoverCity.population > 0 ? `${formatPeople(hoverCity.population)} people` : ''].filter(Boolean).join(' · ')}</small></div>}
  </>;
}

// One found city in the list: its name, region and the people it added. Clicking it shows it on the globe.
const FoundRow = memo(function FoundRow({ c, gain, note, fly, onLook }: { c: RushCity; gain: number; note: string; fly: boolean; onLook: (c: RushCity, fly: boolean) => void }) {
  return <li><button onClick={() => onLook(c, fly)}>
    <span className="name">{c.name}</span>
    <span className="meta">{c.admin1 && <>{c.admin1} · </>}<b title={gain > 0 ? `${exactPeople(gain)} people` : undefined}>{note}</b></span>
  </button></li>;
});

// The time on screen: a countdown for a timed run (red in the last 30 seconds), time played for City Explorer. It redraws
// itself a few times a second; nothing else on the screen re-renders with it.
function RushClock({ rush }: { rush: Rush }) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), rush.mode === 'timed' ? 250 : 1000); return () => clearInterval(id); }, [rush.mode]);
  const now = Date.now();
  if (rush.mode !== 'timed') return <div className="readout time"><span>Time</span><strong>{formatClock(elapsedMs(rush, now))}</strong></div>;
  const left = remainingMs(rush, now);
  return <div className={left <= 30_000 ? 'readout time low' : 'readout time'} role="timer" aria-label={`${formatClock(left, true)} left`}><span>Time left</span><strong>{formatClock(left, true)}</strong></div>;
}

// This run against the previous completed one (same country and mode). Neutral when it went down.
function Progress({ i }: { i: Improvement }) {
  return <dl className="facts rush-progress-summary">
    {i.previous !== null && i.delta !== null
      ? <>
        <div><dt>Previous run</dt><dd>{formatCoverage(i.previous)}</dd></div>
        <div><dt>{i.delta > 0.05 ? 'Improvement' : 'Change'}</dt><dd className={i.delta > 0.05 ? 'up' : ''}>{formatDelta(i.delta)}</dd></div>
      </>
      : <div><dt>Previous run</dt><dd className="muted">not comparable: the city list has changed since</dd></div>}
    {i.of > 0 && <div><dt>Previously missed, remembered</dt><dd>{i.remembered}/{i.of}</dd></div>}
    {i.recovered > 0 && <div><dt>Population recovered</dt><dd title={`${exactPeople(i.recovered)} people`}>{exactPeople(i.recovered)}</dd></div>}
  </dl>;
}

// Choosing a country by typing. Suggestions are fine here: no game is running yet. Only countries with enough cities
// are offered; the rest are named with their count, so a missing country is explained, never hidden.
function CountrySearch({ countries, index, onPick }: { countries: Map<string, Country>; index: CityIndex | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const entries = useMemo(() => ROSTER.filter(r => countries.has(r.id)), [countries]);
  const list = useMemo(() => searchCountries(q, entries, 6), [q, entries]);
  useEffect(() => setActive(0), [q]);
  const pick = (i = active) => { const s = list[i]; if (!s) return; onPick(s.entry.id); setQ(''); };
  return <div className="rush-search">
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search for a country" aria-label="Search for a country"
      autoComplete="off" spellCheck={false}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); setActive(a => (a + 1) % list.length); }
        else if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); setActive(a => (a - 1 + list.length) % list.length); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(); }
        else if (e.key === 'Escape') setQ('');
      }} />
    {q && list.length > 0 && <ul className="suggestions" role="listbox">
      {list.map((s, i) => {
        const e = index?.countries[s.entry.id];
        return <li key={s.entry.id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
          onMouseDown={ev => { ev.preventDefault(); pick(i); }} onMouseEnter={() => setActive(i)}>
          <Flag iso2={s.entry.iso2} /><span className="name">{s.entry.name}</span>
          <span className="meta">{!index ? '' : e?.playable ? `${formatPeople(e.population)} people` : 'too few cities'}</span>
        </li>;
      })}
    </ul>}
  </div>;
}
