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
  coverageOf, DURATIONS, DURATION_NAMES, durationLabel, rushName, type Duration, elapsedMs, exactPeople, finishRush, formatClock, formatCoverage, formatPeople, guessRush,
  isExpired, milestoneCrossed, newRush, pauseRush, remainingMs, resumeRush, type Rush, type RushMode,
} from '../game/cityRush';
import {
  addTimedRun, loadActive, loadChoice, saveChoice, type RushChoice, loadExplorer, loadTimedStore, restoreRun, saveActive, saveExplorer, saveTimedStore, timedKey, toSaved,
  withExplorerRun, withoutExplorerRun, type ExplorerStore, type TimedResult,
} from '../game/cityRushRecords';
import type { LngLat } from '../game/geo';
import { searchCountries } from '../game/mystery';
import { challengeUrl, shareText } from '../game/share';
import type { GlobeView, RushPoint } from '../map/GlobeView';
import { Burst } from './Results';
import { renderShareImage } from './shareImage';
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
  start: { country: string | null; key: number };
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
  const [shareNote, setShareNote] = useState('');
  const [shareFallback, setShareFallback] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fxKey = useRef(0);

  const phase: RushPhase = !rush ? 'setup' : rush.phase === 'playing' ? 'playing' : 'done';
  const target = country ? countries.get(country) : undefined;
  const entry = country && index ? index.countries[country] : undefined;
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
        if (isExpired(r, Date.now())) finish(r, d);
        else { commit(r); setWelcome('Welcome back. The clock kept running while you were away.'); }
      }, () => { if (live) { saveActive(null); setDataFailed(true); } });
      return () => { live = false; };
    }
    if (!p.start.country && explorerRef.current.last) setCountry(explorerRef.current.last);
  }, []);
  // A new request from the Play panel or a link while City Rush is already open: back to setup on that country.
  const firstStart = useRef(p.start.key);
  useEffect(() => {
    if (p.start.key === firstStart.current || rushRef.current?.phase === 'playing') return;
    commit(null);
    setResult(null);
    if (p.start.country) setCountry(p.start.country);
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
    commit(r);
    setResult(null);
    setLesson(null);
    setPeek(false);
    setFeedback(null);
    setParty(null);
    setWelcome('');
    setText('');
    setConfirm(null);
    setShareNote('');
    setShareFallback('');
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
    setText('');
    if (d) globe?.frame(d.file.frame.center, d.file.frame.radiusKm);
  }

  // Abandons a timed run: no record, no learning, back to the country. (City Explorer keeps its map until reset.)
  function abandon() {
    const r = rushRef.current;
    if (!r || r.phase !== 'playing') return;
    if (confirm !== 'abandon') { setConfirm('abandon'); setTimeout(() => setConfirm(c => (c === 'abandon' ? null : c)), 4000); return; }
    if (r.mode === 'timed') saveActive(null);
    else persist(r);
    exitToSetup();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = rushRef.current;
    if (!r || !data || r.phase !== 'playing') return;
    const now = Date.now(), typed = text;
    const match = matchGuess(data.book, typed);
    const cityId = match && (match.kind === 'exact' || match.kind === 'typo') ? match.id : null;
    const { rush: next, outcome } = guessRush(r, typed, cityId, now);
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
      globe?.freshen([c.id]);
      setText('');
      const gains = awards(data.book, next.found), gain = gains[gains.length - 1];
      const before = coverageOf(gains.slice(0, -1).reduce((x, y) => x + y, 0), data.book.total);
      const after = coverageOf(gains.reduce((x, y) => x + y, 0), data.book.total);
      const parent = c.partOf ? data.book.cities.get(c.partOf) : undefined;
      const label = cityLabel(data.book, c);
      // Named this time after being missed last time: the lesson stuck. Same people as always, no bonus.
      const learned = missedBefore(learningRef.current[learningKey(r.country, r.durationMs)], data.book).has(c.id) && gain > 0;
      setFeedback({
        kind: learned ? 'learned' : 'new', key, gain,
        text: learned ? `Learned! ${typo}${label} · +${exactPeople(gain)} people`
          : gain > 0 ? `${typo}${label} · +${exactPeople(gain)} people`
          : c.population <= 0 ? `${typo}${label} · no population recorded`
          : `${typo}${label} · already counted in ${parent?.name ?? 'its city'}`,
      });
      const m = milestoneCrossed(before, after);
      if (m) { setParty({ n: m, key }); audio.play({ kind: 'milestone', streak: MILESTONE_CUE[m] }); }
      else audio.play({ kind: 'correct', streak: Math.min(next.found.length, 10) });
    } else if (outcome === 'duplicate' && c && match && match.kind !== 'ambiguous' && match.kind !== 'small') {
      globe?.freshen([c.id]);
      setText('');
      // A bare name always means the largest city of that name: the others need their region.
      const others = !match.qualified && namesakes(data.book, c) > 1;
      setFeedback({ kind: 'duplicate', key, text: others ? `Already found: ${cityLabel(data.book, c)}. For another ${c.name}, add its region.` : `Already found: ${cityLabel(data.book, c)}` });
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
    setShareNote('');
    setShareFallback('');
  }
  function resetExplorer() {
    if (!country) return;
    if (confirm !== 'reset') { setConfirm('reset'); return; }
    setExplorer(withoutExplorerRun(explorerRef.current, country));
    exitToSetup();
  }
  const shareInput = () => {
    const r = rushRef.current!;
    return {
      countryName: target?.name ?? r.country, iso2: target?.iso2 ?? '', mode: r.mode, count: r.found.length,
      coverage: dataRef.current ? coverageOf(peopleOf(dataRef.current.book, r.found), dataRef.current.book.total) : 0,
      durationMs: r.durationMs, elapsedMs: elapsedMs(r, Date.now()), url: challengeUrl(location.origin, import.meta.env.BASE_URL, r.country),
    };
  };
  async function copyShare() {
    const t = shareText(shareInput());
    try { await navigator.clipboard.writeText(t); setShareNote('Copied. Paste it anywhere.'); setShareFallback(''); }
    catch { setShareFallback(t); setShareNote('Copy the text below.'); }
  }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function webShare() {
    try { await navigator.share({ title: `ATLAS · ${rushName(rushRef.current?.durationMs ?? null)}`, text: shareText(shareInput()) }); }
    catch (err) { if ((err as Error).name !== 'AbortError') copyShare(); }
  }
  async function shareImage() {
    const r = rushRef.current;
    if (!r || !data) return;
    setShareNote('Drawing your map…');
    try {
      const s = shareInput();
      const blob = await renderShareImage({
        title: rushName(r.durationMs).toUpperCase(), countryName: s.countryName,
        big: formatCoverage(s.coverage), label: 'city population coverage',
        detail: `${plural(s.count, 'city', 'cities')} · ${r.mode === 'timed' ? durationLabel(r.durationMs!) : `${formatClock(s.elapsedMs)} exploring`}`,
        site: location.host, shape: p.shapeOf(r.country), frame: data.file.frame, cities: points.filter(pt => !pt.missed).map(pt => pt.at),
      });
      const file = new File([blob], `atlas-city-rush-${r.country.toLowerCase()}.png`, { type: 'image/png' });
      // Phones save images through the share sheet (a download lands somewhere hard to find); computers download it.
      const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      if (touch && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], text: shareText(s) }); setShareNote(''); return; }
        catch (err) { if ((err as Error).name === 'AbortError') { setShareNote(''); return; } }
      }
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setShareNote('Image saved.');
    } catch { setShareNote('The image could not be made in this browser. Copy the text instead.'); }
  }

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
    {phase === 'setup' && <aside className="card panel rush-setup" aria-label="City Rush">
      <div className="card-head">
        <div className="eyebrow">City Rush</div>
        <button className="close" aria-label="Close City Rush" onClick={p.onExit}>×</button>
      </div>
      <h1 className="with-flag">{target ? <><Flag iso2={target.iso2} size="lg" />{target.name}</> : 'Choose a country'}</h1>
      <CountrySearch countries={countries} index={index} onPick={chooseCountry} />
      {indexFailed && <p className="muted">The city list could not load. <button className="link" onClick={loadIndex}>Try again</button></p>}
      {note && <p className="muted" role="status">{note}</p>}
      {!country && !note && <p className="muted">Search, click a country on the globe, or <button className="link" onClick={randomCountry} disabled={!index}>pick one at random</button>.</p>}
      {target && entry?.playable && <>
        <p className="rush-facts"><b title={`${exactPeople(entry.population)} people`}>{formatPeople(entry.population)}</b> people in <b>{entry.findable.toLocaleString()}</b> cities <span>· {sourceLine.replace(' in GeoNames', '').toLowerCase()}</span></p>
        <div className="rush-modes" role="radiogroup" aria-label="Game mode">
          {[...DURATIONS, 'explorer' as const].map(c => {
            const best = c === 'explorer' ? undefined : recordFor(c), on = choice === c;
            return <button key={c} role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => setChoice(c)}>
              <span className="label">{c === 'explorer' ? 'City Explorer' : DURATION_NAMES[c]}{c === 600 && <em>Recommended</em>}</span>
              <span className="time">{c === 'explorer' ? 'No clock' : `${c / 60} min`}</span>
              <span className="best">{c === 'explorer' ? (savedCount ? `${savedCount.toLocaleString()} found` : '') : best ? `Best ${formatCoverage(coverageOf(best.best, best.total))}` : ''}</span>
            </button>;
          })}
        </div>
        <p className="muted">{mode === 'timed'
          ? `Every city you name adds its people. How much of ${target.name}’s city population can you cover in ${durationLabel(choice as number * 1000)}? The clock never pauses.`
          : `Discover ${target.name} at your own pace. Your map is saved, so you can come back to it.`}</p>
        {dataFailed && <p className="muted">These cities could not load. Check your connection and choose the country again.</p>}
        {mode === 'explorer' && savedCount > 0
          ? <>
            <button className="btn primary" autoFocus disabled={!data || data.file.country !== country} onClick={() => begin()}>Continue · {plural(savedCount, 'city', 'cities')} found</button>
            <button className="btn" onClick={() => begin({ fresh: true })}>Start a clean map</button>
          </>
          : <button className="btn primary" autoFocus disabled={!data || data.file.country !== country} onClick={() => begin()}>{!data || data.file.country !== country ? 'Loading cities…' : `Start ${choice === 'explorer' ? 'exploring' : DURATION_NAMES[choice]}`}</button>}
        {regionToggle}
        <button className="link center" onClick={randomCountry}>Another country at random</button>
      </>}
      <p className="fine">Type a city and press Enter: it lands on the globe and adds its people. A name means the largest city of that name; for another, add its region (“Portland, Maine”). Coverage is the share of the people in these cities, not of the whole country. Data: GeoNames (CC BY 4.0).</p>
    </aside>}

    {phase === 'playing' && rush && target && <div className="rush-top">
      <section className="hud rush-hud" aria-label="City Rush">
        {feedback && <span className={`hud-flash ${party?.key === feedback.key || feedback.kind === 'learned' ? 'gold' : feedback.kind === 'new' ? 'good' : feedback.kind === 'unknown' ? 'bad' : ''}`} key={feedback.key} aria-hidden="true" />}
        <div className="hud-top">
          <span className="hud-area"><Flag iso2={target.iso2} /><span className="mode-name">{rushName(rush.durationMs)} · </span><span className="country-name">{target.name}</span></span>
          <span className="spacer" />
          <button className={listOpen ? 'icon-btn on' : 'icon-btn'} aria-label={listOpen ? 'Hide your cities' : 'Show your cities'} aria-pressed={listOpen} onClick={() => setListOpen(!listOpen)}><Icon name="list" /></button>
          {regionsOk && <button className={showRegions ? 'icon-btn on' : 'icon-btn'} aria-label={showRegions ? 'Hide regions' : 'Show regions'} aria-pressed={showRegions} title="Show regions" onClick={() => setShowRegions(!showRegions)}><Icon name="layers" /></button>}
          <button className={p.help ? 'icon-btn on' : 'icon-btn'} aria-label="How to play" aria-expanded={p.help} title="How to play" onClick={() => p.onHelp({ mode: rush.mode, durationMs: rush.mode === 'timed' ? rush.durationMs : null, country: target.name })}><Icon name="help" /></button>
          <button className="icon-btn sound" data-silent aria-label={p.sound ? 'Mute sounds' : 'Turn sounds on'} aria-pressed={p.sound} onClick={p.onSound}><Icon name={p.sound ? 'sound' : 'mute'} /></button>
          {confirm === 'abandon'
            ? <><button className="btn small danger" onClick={abandon}>Discard run</button><button className="btn small" onClick={() => setConfirm(null)}>Keep playing</button></>
            : <>
              {rush.mode === 'timed'
                ? <button className="btn small ghost" onClick={abandon} title="Discard this run: no score is saved">Abandon</button>
                : <button className="btn small ghost" onClick={() => { const r = rushRef.current; if (r) persist(pauseRush(r, Date.now())); exitToSetup(); }} title="Your map is saved: carry on later">Leave</button>}
              <button className={confirm === 'end' ? 'btn small danger' : 'btn small'} onClick={endPressed} title={rush.mode === 'timed' ? 'End now and see your results' : 'See your results'}>{rush.mode === 'timed' ? (confirm === 'end' ? 'Finish now?' : 'Finish') : 'Finish'}</button>
            </>}
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
            {rush.mode === 'timed' && bestCoverage !== null && bestCoverage > 0 && <b className="best" style={{ left: `${bestCoverage}%` }} title={`Your best: ${formatCoverage(bestCoverage)}`} />}
          </div>
          <span title={`${exactPeople(people)} of ${exactPeople(total)} people`}><b>{formatPeople(shownPeople)}</b> of {formatPeople(total)} people{rush.mode === 'timed' && bestCoverage !== null ? ` · best ${formatCoverage(bestCoverage)}` : ''}</span>
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
      <div className="eyebrow">{rush.mode === 'timed' ? `${rushName(rush.durationMs)} · ${durationLabel(rush.durationMs!)}` : 'City Explorer'}</div>
      <h1 className="with-flag"><Flag iso2={target.iso2} size="lg" />{target.name}</h1>
      {result?.newBest && <div className="record"><Burst />New personal best<span>Up from {formatCoverage(coverageOf(result.before ?? 0, total))}.</span></div>}
      <div className="sprint-score rush-score"><strong>{formatCoverage(coverage)}</strong><span>city population coverage</span></div>
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
      {rush.mode === 'timed'
        ? <button className="btn primary" autoFocus onClick={() => begin({ as: rush.durationMs! / 1000 as Duration })}>Play again · {rushName(rush.durationMs)}</button>
        : <button className="btn primary" autoFocus onClick={() => begin({ as: 'explorer' })}>Keep exploring</button>}
      <div className="rush-lengths" role="group" aria-label="Play again with another length">
        <span>Or</span>
        {DURATIONS.filter(d => d * 1000 !== rush.durationMs).map(d => <button key={d} className="chip" onClick={() => begin({ as: d })}>{d / 60} min</button>)}
        {rush.mode === 'timed' && <button className="chip" onClick={() => begin({ as: 'explorer' })}>Explorer</button>}
      </div>
      <div className="share-row">
        {canShare && <button className="btn small" onClick={webShare}><Icon name="share" />Share</button>}
        <button className="btn small" onClick={copyShare}>Copy result</button>
        <button className="btn small" onClick={shareImage}>Save image</button>
      </div>
      {shareNote && <p className="fine" role="status">{shareNote}</p>}
      {shareFallback && <textarea className="share-text" readOnly value={shareFallback} rows={8} onFocus={e => e.currentTarget.select()} />}
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
      <button className="btn" onClick={exitToSetup}>Choose another country</button>
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
