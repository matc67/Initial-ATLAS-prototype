import { useState } from 'react';
import type { Area, Country, CountrySet } from '../data/countries';
import { SPRINT_SIZE, countryChallenge, sprintChallenge, type ChallengeKind, type GameMode } from '../game/challenges';
import { perfKey, type Performance } from '../game/records';
import { formatTime, isFirstTry, maxScoreFor, type Attempt } from '../game/scoring';
import { overview, recentSprints, recordsFor } from '../game/stats';
import { COLORS } from '../map/GlobeView';
import type { PerformanceStore } from '../game/records';
import { averageGuesses, type MysteryRecord } from '../game/mysteryRecords';
import { describeCount, type SubdivisionIndex } from '../data/subdivisions';
import { hasRegions } from '../game/exploreNav';
import { completedCount, regionRecords, statusOf } from '../game/regionRecords';
import { Flag, Icon } from './ui';

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const areaName = (a: Area) => (a === 'World' ? 'World' : a);
const modeName = (m: GameMode) => (m === 'find' ? 'Find it' : 'Name it');
// Wrong guesses grouped in first-seen order: ['BOL', 'PER', 'BOL'] → [['BOL', 2], ['PER', 1]].
const wrongList = (ids: string[]) => [...ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())];

export type ProgressProps = {
  store: PerformanceStore;
  // The record being looked at: area (the top tabs), country set, mode and kind. Shown on the globe.
  area: Area; set: CountrySet; mode: GameMode; kind: ChallengeKind;
  onArea: (a: Area) => void; onSet: (s: CountrySet) => void; onMode: (m: GameMode) => void; onKind: (k: ChallengeKind) => void;
  record?: Performance;
  runView: 'latest' | 'best'; onRunView: (v: 'latest' | 'best') => void;
  legend: { first: number; retry: number; hinted: number; none: number };
  selected?: Country; result?: Attempt; resultBonus: number; onCloseCountry: () => void;
  nameOf: (id: string) => string;
  loading: boolean; poolSize: number;
  onPlay: (kind: ChallengeKind) => void;
  // Mystery Country, for the chosen country set: its own stats, never mixed with the scored modes.
  mysteryRecord?: MysteryRecord; mysterySize: number; countryOf: (id: string) => Country | undefined; onMystery: () => void;
  // Regions (first-level subdivisions): their own records store, per country, mode and challenge type.
  regions: { index: SubdivisionIndex | null; failed: boolean; store: PerformanceStore; onOpen: (countryId: string) => void };
};

// Progress: how good the player is at ATLAS and whether they are improving. All-time stats first, then records by area
// for one kind of challenge, and the latest Sprints. Everything comes from completed runs saved in this browser.
export default function ProgressPanel(p: ProgressProps) {
  const [tab, setTab] = useState<'records' | 'recent' | 'mystery' | 'regions'>('records');
  const o = overview(p.store);
  const recent = recentSprints(p.store);
  const records = recordsFor(p.store, { kind: p.kind, mode: p.mode, set: p.set });
  return <div className="progress">
    <div className="eyebrow">Your stats · all time</div>
    {o.games === 0 ? <div className="empty-hero">
      <strong>No runs yet</strong>
      <p className="muted">Finish a challenge and your scores, streaks and records start here.</p>
      <button className="btn primary" onClick={() => p.onPlay('sprint')} disabled={p.loading || p.poolSize < SPRINT_SIZE}><Icon name="bolt" /> Play a {areaName(p.area)} Sprint</button>
    </div> : <>
      <div className="stat-grid">
        <Stat label="Games" value={o.games.toLocaleString()} />
        <Stat label="Sprints" value={o.sprints.toLocaleString()} />
        <Stat label="Perfect runs" value={o.perfect.toLocaleString()} gold={o.perfect > 0} />
        <Stat label="Best Sprint" value={o.bestSprintScore === null ? '–' : o.bestSprintScore.toLocaleString()} gold={o.bestSprintScore === maxScoreFor(SPRINT_SIZE)} />
        <Stat label="Best streak" value={o.bestStreak === null ? '–' : String(o.bestStreak)} />
        <Stat label="Countries answered" value={o.countriesAnswered.toLocaleString()} />
      </div>
      <p className="accuracy-line">First-try accuracy <b>{pct(o.accuracy)}</b>
        <span>{o.accuracyRuns === o.games ? (o.games === 1 ? 'from your first run' : `across all ${o.games} runs`) : `across the ${o.accuracyRuns} of ${o.games} runs with answers on record`}</span></p>
    </>}

    <div className="segmented four tabs-inline" role="tablist" aria-label="Progress sections">
      <button role="tab" aria-selected={tab === 'records'} className={tab === 'records' ? 'on' : ''} onClick={() => setTab('records')}>Records</button>
      <button role="tab" aria-selected={tab === 'recent'} className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')}>Sprints</button>
      <button role="tab" aria-selected={tab === 'mystery'} className={tab === 'mystery' ? 'on' : ''} onClick={() => setTab('mystery')}>Mystery</button>
      <button role="tab" aria-selected={tab === 'regions'} className={tab === 'regions' ? 'on' : ''} onClick={() => setTab('regions')}>Regions</button>
    </div>

    {tab === 'regions' ? <RegionsProgress {...p} /> : tab === 'mystery' ? <MysteryProgress {...p} /> : tab === 'records' ? <>
      <div className="filters">
        <Toggle label="Challenge" value={p.kind} options={[['sprint', 'Sprint'], ['full', 'Full']]} onChange={p.onKind} />
        <Toggle label="Mode" value={p.mode} options={[['find', 'Find'], ['name', 'Name']]} onChange={p.onMode} />
        <Toggle label="Countries" value={p.set} options={[['200', '200'], ['195', '195']]} onChange={p.onSet} />
      </div>
      <ul className="record-list" aria-label="Records by area">
        {records.map(({ ref, performance: r }) => <li key={ref.key}>
          <button className={ref.area === p.area ? 'record-row on' : 'record-row'} aria-pressed={ref.area === p.area} onClick={() => p.onArea(ref.area)}>
            <span className="record-area">{areaName(ref.area)}</span>
            {r ? <>
              <span className="record-score"><b>{r.bestScore.toLocaleString()}</b>{r.perfectRuns > 0 && <i title="Perfect run">★</i>}</span>
              <span className="record-meta">{pct(r.bestAccuracy)} · {formatTime(r.fastestMs)} · 🔥{r.longestStreak} · {r.runs}×</span>
            </> : <span className="record-meta none">Not played</span>}
          </button>
        </li>)}
      </ul>
      <RecordDetail {...p} />
    </> : recent.length === 0 ? <div className="empty-hero">
      <strong>No Sprints yet</strong>
      <p className="muted">Ten countries. One clock. One score to beat.</p>
      <button className="btn primary" onClick={() => p.onPlay('sprint')} disabled={p.loading || p.poolSize < SPRINT_SIZE}><Icon name="bolt" /> Play a {areaName(p.area)} Sprint</button>
    </div> : <ul className="recent-list">
      {recent.map(({ ref, run, best, isBest, earlier }) => <li key={run.runId} className={isBest ? 'best-run' : ''}>
        <span className="recent-what"><b>{areaName(ref.area)}</b><small>{modeName(ref.mode)}{ref.set === '195' ? ' · Classic' : ''} · {day(run.at)}{earlier ? ' · before bonuses' : ''}</small></span>
        <span className="recent-score"><b>{run.score.toLocaleString()}</b>{isBest ? <em>Best</em> : <small>best {best.score.toLocaleString()}</small>}</span>
        <span className="recent-meta">{pct(run.accuracy)}<small>{formatTime(run.ms)}</small></span>
      </li>)}
    </ul>}
    {(tab === 'records' || tab === 'recent') && <p className="fine">Records compare runs of the same challenge only. Each Sprint draws a new ten, so Sprint records are personal arcade bests. Runs from before streak bonuses keep their scores but are not ranked against new ones. Saved in this browser.</p>}
  </div>;
}

// The same challenge's record from before streak bonuses (scoring version 1), if there is one: kept and shown, never ranked.
function earlierRecord(p: ProgressProps) {
  const c = p.kind === 'sprint' ? sprintChallenge(p.area, p.set, p.mode) : countryChallenge(p.area, p.set, p.mode);
  return p.store[perfKey({ id: c.id, version: c.earlierVersion })];
}
const EarlierNote = ({ r }: { r?: Performance }) => r ? <p className="fine earlier">Before streak bonuses: best {r.bestScore.toLocaleString()} / {r.best.maxScore.toLocaleString()} · {pct(r.bestAccuracy)} · {formatTime(r.fastestMs)} · {r.runs} {r.runs === 1 ? 'run' : 'runs'}. Kept for reference, not ranked against new scores.</p> : null;

// The selected record in full, and the run it paints on the globe.
function RecordDetail(p: ProgressProps) {
  const r = p.record, what = `${areaName(p.area)} ${p.kind === 'sprint' ? 'Sprint' : 'Full Challenge'}`, earlier = earlierRecord(p);
  if (!r) return <div className="record-detail empty">
    <p className="muted">No completed {what} runs in {modeName(p.mode)}{p.set === '195' ? ' (Classic 195)' : ''} yet.</p>
    <EarlierNote r={earlier} />
    <button className="btn" onClick={() => p.onPlay(p.kind)} disabled={p.loading || (p.kind === 'sprint' ? p.poolSize < SPRINT_SIZE : !p.poolSize)}>
      {p.kind === 'sprint' ? <><Icon name="bolt" /> Play a {areaName(p.area)} Sprint</> : `Play ${areaName(p.area)} · ${p.poolSize} countries`}</button>
  </div>;
  const shown = p.runView === 'best' ? r.best : r.latest ?? r.best;
  return <div className="record-detail">
    <div className="headline quad">
      <div><span>Best score</span><strong>{r.bestScore.toLocaleString()}</strong><small>/ {r.best.maxScore.toLocaleString()}</small></div>
      <div><span>Best accuracy</span><strong>{pct(r.bestAccuracy)}</strong></div>
      <div><span>Fastest</span><strong>{formatTime(r.fastestMs)}</strong></div>
      <div><span>Longest streak</span><strong>{r.longestStreak}</strong></div>
    </div>
    <p className="fine">{what} · {modeName(p.mode)} · {r.runs} {r.runs === 1 ? 'run' : 'runs'}{r.perfectRuns ? ` · ${r.perfectRuns} perfect` : ''} · fewest mistakes {r.fewestMistakes}</p>
    <EarlierNote r={earlier} />
    {r.latestRun ? <>
      <div className="segmented two" role="radiogroup" aria-label="Run shown on the globe">
        <button role="radio" aria-checked={p.runView === 'latest'} className={p.runView === 'latest' ? 'on' : ''} onClick={() => p.onRunView('latest')}>Latest run</button>
        <button role="radio" aria-checked={p.runView === 'best'} className={p.runView === 'best' ? 'on' : ''} onClick={() => p.onRunView('best')} disabled={!r.bestRun}>Best run</button>
      </div>
      <p className="globe-caption">On the globe: your {p.runView === 'best' ? 'best' : 'latest'} run, {day(shown.at)} · {shown.score.toLocaleString()} pts · {pct(shown.accuracy)}</p>
      <ul className="levels compact">
        <Level color={COLORS.progress.first} label="Correct first try" n={p.legend.first} />
        <Level color={COLORS.progress.retry} label="Needed more attempts" n={p.legend.retry} />
        <Level color={COLORS.progress.hinted} label="Used Show me" n={p.legend.hinted} />
        <Level color={COLORS.progress.none} label={p.kind === 'sprint' ? 'Not in this Sprint' : 'Not attempted'} n={p.legend.none} />
      </ul>
      {p.selected ? <RunCountry country={p.selected} result={p.result} bonus={p.resultBonus} nameOf={p.nameOf} onClose={p.onCloseCountry} />
        : <p className="fine">Click a country to see how it went in this run. One run is a snapshot, not proof you know a country for good.</p>}
    </> : <p className="fine">Country-by-country results are saved from your next run of this challenge.</p>}
  </div>;
}

// Region challenges, per country with region data: for each mode and length, the best score, best time, first-try
// accuracy and how often it was completed. Records of other scoring versions or unit lists are kept but not shown.
function RegionsProgress(p: ProgressProps) {
  const { index, failed, store, onOpen } = p.regions;
  if (!index) return <p className="fine">{failed ? 'Regions could not load. Check your connection and try again.' : 'Loading regions…'}</p>;
  const ids = Object.keys(index.countries).filter(id => hasRegions(index, id, import.meta.env.DEV));
  return <div className="regions-progress">
    {ids.map(id => {
      const meta = index.countries[id], c = p.countryOf(id), rows = regionRecords(store, id, meta);
      return <section key={id} className="region-country">
        <div className="region-country-head">
          <strong className="with-flag"><Flag iso2={c?.iso2} />{c?.name ?? id}</strong>
          <small>{describeCount(meta)} · {completedCount(rows)} of {rows.length} challenges completed</small>
        </div>
        <ul className="region-records">
          {rows.map(r => <li key={r.key} className={r.performance ? '' : 'none'}>
            <span className="what">{r.mode === 'find' ? 'Find the Region' : 'Name the Region'}<small>{r.kind === 'sprint' ? `${r.size}-question Sprint` : `All ${r.size}`}</small></span>
            {r.performance ? <span className="nums">
              <b>{r.performance.bestScore.toLocaleString()}</b><small>/ {r.maxScore.toLocaleString()}</small>
              <span>{Math.round(r.performance.bestAccuracy)}% · {formatTime(r.performance.fastestMs)}</span>
            </span> : <span className="nums" />}
            <span className="status">{statusOf(r)}</span>
          </li>)}
        </ul>
        <button className="btn small" onClick={() => onOpen(id)}>Open {c?.name ?? id} in Explore</button>
      </section>;
    })}
    <p className="fine">Region records are kept apart from country records, per country, game and length. More countries are on the way.</p>
  </div>;
}

// Mystery Country stats for one country set: puzzles solved, guesses, times and the countries discovered.
function MysteryProgress(p: ProgressProps) {
  const r = p.mysteryRecord;
  return <div className="mystery-progress">
    <div className="filters"><Toggle label="Countries" value={p.set} options={[['200', '200'], ['195', '195']]} onChange={p.onSet} /></div>
    {!r || (!r.solved && !r.abandoned) ? <div className="empty-hero">
      <strong>No mysteries yet</strong>
      <p className="muted">Find the hidden country. Every guess brings you closer.</p>
      <button className="btn primary" onClick={p.onMystery} disabled={p.loading || !p.mysterySize}><Icon name="mystery" /> Play Mystery Country</button>
    </div> : <>
      <div className="stat-grid">
        <Stat label="Solved" value={r.solved.toLocaleString()} />
        <Stat label="Average guesses" value={averageGuesses(r) === null ? '–' : averageGuesses(r)!.toFixed(1)} />
        <Stat label="Fewest guesses" value={r.fewest === null ? '–' : String(r.fewest)} gold={r.fewest === 1} />
        <Stat label="Fastest" value={r.fastestMs === null ? '–' : formatTime(r.fastestMs)} />
        <Stat label="Discovered" value={`${r.discovered.length} / ${p.mysterySize}`} />
        <Stat label="Abandoned" value={r.abandoned.toLocaleString()} />
      </div>
      <div className="eyebrow">Recent mysteries</div>
      <ul className="recent-list">
        {r.history.map(run => { const c = p.countryOf(run.answer); return <li key={run.id} className={run.id === r.best?.id ? 'best-run' : ''}>
          <span className="recent-what"><b className="with-flag">{run.solved ? <><Flag iso2={c?.iso2} />{c?.name ?? run.answer}</> : 'Unsolved'}</b><small>{day(run.at)}{run.closest ? ` · closest ${p.nameOf(run.closest.id)}` : ''}</small></span>
          <span className="recent-score"><b>{run.guesses}</b>{run.id === r.best?.id ? <em>Best</em> : <small>{run.guesses === 1 ? 'guess' : 'guesses'}</small>}</span>
          <span className="recent-meta">{formatTime(run.ms)}<small>{run.solved ? 'solved' : 'left'}</small></span>
        </li>; })}
      </ul>
    </>}
    <p className="fine">Mystery Country is ranked by fewest guesses, then time. It has no points and is kept apart from Sprint and Full Challenge records. An unsolved mystery is not named.</p>
  </div>;
}

const Stat = ({ label, value, gold }: { label: string; value: string; gold?: boolean }) =>
  <div className={gold ? 'stat gold' : 'stat'}><strong>{value}</strong><span>{label}</span></div>;

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="toggle" role="radiogroup" aria-label={label}>
    {options.map(([v, text]) => <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>)}
  </div>;
}

const Level = ({ color, label, n }: { color: string; label: string; n: number }) =>
  <li><i style={{ background: color }} /><span>{label}</span><b>{n}</b></li>;

// How one country went in the run shown on the globe.
function RunCountry({ country, result: a, bonus, nameOf, onClose }: { country: Country; result?: Attempt; bonus: number; nameOf: (id: string) => string; onClose: () => void }) {
  return <div className="run-country">
    <div className="card-head"><strong className="with-flag"><Flag iso2={country.iso2} />{country.name}</strong><button className="close" aria-label="Close" onClick={onClose}>×</button></div>
    {!a ? <p className="fine">Not part of this run.</p> : <dl className="mini">
      <div><dt>{a.hint ? 'Guesses before Show me' : 'Attempts'}</dt><dd>{a.hint ? a.mistakes : a.mistakes + 1}</dd></div>
      <div><dt>Incorrect guesses</dt><dd>{a.mistakes}</dd></div>
      <div><dt>First-try correct</dt><dd>{isFirstTry(a) ? 'Yes' : 'No'}</dd></div>
      <div><dt>Points earned</dt><dd>{a.points}{bonus > 0 && <> + {bonus} streak bonus</>}</dd></div>
      {a.wrongIds.length > 0 && <div className="wide"><dt>Clicked instead</dt><dd>{wrongList(a.wrongIds).map(([id, n]) => `${nameOf(id)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}</dd></div>}
    </dl>}
  </div>;
}
