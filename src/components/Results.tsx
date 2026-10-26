import { useEffect, useRef, type CSSProperties } from 'react';
import type { Playable } from '../game/playable';
import { formatTime, isFirstTry, type Attempt, type NewBests, type Stats } from '../game/scoring';
import { compareWithBests, isNewRecord, type Comparison, type PersonalBests } from '../game/sprint';
import { Flag, Icon, useTween } from './ui';

// Wrong guesses grouped in first-seen order: ['BOL', 'PER', 'BOL'] → [['BOL', 2], ['PER', 1]].
const wrongList = (ids: string[]) => [...ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())];
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);

// The countries not found first try, with what was clicked instead. Shown only once a round is over.
// `heading` names what was played ("Countries", "Provinces and territories").
export function ReviewList({ answers, countries, nameOf, heading = 'Countries' }: { answers: Attempt[]; countries: Map<string, Playable>; nameOf: (id: string) => string; heading?: string }) {
  const review = answers.filter(a => !isFirstTry(a));
  if (!review.length) return null;
  return <>
    <div className="eyebrow">{heading} to review · {review.length}</div>
    <ul className="answers">{review.map(a => <li key={a.id}>
      <span className="who"><Flag iso2={countries.get(a.id)?.iso2} /><span>{countries.get(a.id)?.name}
        <small>{a.hint ? `Show me${a.mistakes ? ` after ${a.mistakes} wrong` : ''}` : `${a.mistakes} wrong: ${wrongList(a.wrongIds).map(([id, n]) => `${nameOf(id)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}`}</small></span></span>
      <span>{a.points}</span>
    </li>)}</ul>
  </>;
}

// How the total was made: base points plus streak bonuses, both from the same scoring functions as the HUD.
export function ScoreBreakdown({ stats }: { stats: Stats }) {
  return <div className="breakdown">
    <span><b>{stats.base.toLocaleString()}</b> base</span>
    <span className={stats.bonus ? 'bonus' : ''}><b>+{stats.bonus.toLocaleString()}</b> streak bonus</span>
  </div>;
}

// A short burst of gold sparks behind a new record. Decoration only; with reduced motion it is not drawn.
export const Burst = () => <span className="burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) =>
  <i key={i} style={{ '--a': `${i * (360 / 14)}deg`, '--d': `${60 + (i % 3) * 22}px` } as CSSProperties} />)}</span>;

const LABEL: { [S in Comparison['stat']]: string } = { score: 'Score', accuracy: 'First-try accuracy', time: 'Time', streak: 'Longest streak', mistakes: 'Mistakes' };
const show = (c: Comparison, v: number) => (c.stat === 'accuracy' ? pct(v) : c.stat === 'time' ? formatTime(v) : v.toLocaleString());

type Props = {
  area: string; modeLabel: string;
  stats: Stats; answers: Attempt[];
  before: PersonalBests | null;   // the records as they stood before this run; null on a first Sprint
  bests: NewBests | null;
  countries: Map<string, Playable>; nameOf: (id: string) => string;
  onPlayAgain: () => void; onChange: () => void;
  heading?: string;          // what was played, for the review list ("Countries" by default)
  changeLabel?: string;      // "Change challenge", or "Back to Canada" for a subdivision Sprint
  onProgress?: () => void;   // shows the run on the Progress globe (country Sprints)
};

// The arcade results: the score out of 1,400 (1,000 base + 400 for a perfect streak), how it compares with the player's bests, and an instant replay.
export function SprintResults({ area, modeLabel, stats, answers, before, bests, countries, nameOf, onPlayAgain, onChange, heading, changeLabel = 'Change challenge', onProgress }: Props) {
  const rows = compareWithBests({ score: stats.score, accuracy: stats.accuracy ?? 0, ms: stats.elapsedMs, streak: stats.longestStreak, mistakes: stats.totalMistakes }, before);
  const [score, ...tiles] = rows;
  const shown = useTween(stats.score, 650, 0);
  const record = isNewRecord(before, bests);
  // Play again takes focus so Enter replays, without scrolling the panel away from the score (autoFocus would).
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => again.current?.focus({ preventScroll: true }), []);
  return <div className="sprint-results">
    <div className="eyebrow"><Icon name="bolt" /> Sprint complete · {area} · {modeLabel}</div>
    {stats.perfect && <div className="perfect">Perfect sprint · {stats.score.toLocaleString()}<span>Ten for ten, the maximum score. No mistakes, no hints.</span></div>}
    {record && <div className="record"><Burst />New personal best<span>Your best {area} Sprint{bests?.run ? ' run yet' : ' score'}.</span></div>}
    {before === null && <div className="record first">First Sprint record<span>Now beat it.</span></div>}
    <div className="sprint-score">
      <strong aria-label={`${stats.score} points`}>{shown.toLocaleString()}</strong><small>/ {stats.maxScore.toLocaleString()}</small>
      <ScoreBreakdown stats={stats} />
      {score.best !== null && <span className={score.better ? 'delta up' : 'delta'}>{score.better ? `+${score.delta!.toLocaleString()} on your best` : `Best ${score.best.toLocaleString()}`}</span>}
    </div>
    <div className="sprint-stats">
      {tiles.map(c => <div key={c.stat} className={c.better ? 'better' : ''}>
        <span>{LABEL[c.stat]}</span>
        <strong>{show(c, c.value)}</strong>
        <small>{c.better ? 'New best' : c.best === null ? '—' : `Best ${show(c, c.best)}`}</small>
      </div>)}
    </div>
    <ReviewList answers={answers} countries={countries} nameOf={nameOf} heading={heading} />
    <button ref={again} className="btn primary big" onClick={onPlayAgain}>Play again <kbd>Enter</kbd></button>
    <button className="btn" onClick={onChange}>{changeLabel}</button>
    {onProgress && <button className="link center" onClick={onProgress}>See this run on the globe in Progress</button>}
    <p className="fine">Personal arcade records, kept in this browser. Each Sprint draws a new random ten, so runs differ in difficulty. Streak bonuses: +50 at 3 in a row, +100 at 5, +250 at 10.</p>
  </div>;
}
