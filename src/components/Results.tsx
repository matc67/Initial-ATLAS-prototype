import { useEffect, useRef, useState } from 'react';
import type { Country } from '../data/countries';
import { formatTime, isFirstTry, type Attempt, type NewBests, type Stats } from '../game/scoring';
import { compareWithBests, type Comparison, type PersonalBests } from '../game/sprint';
import { Flag, Icon } from './ui';

// Wrong guesses grouped in first-seen order: ['BOL', 'PER', 'BOL'] → [['BOL', 2], ['PER', 1]].
const wrongList = (ids: string[]) => [...ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())];
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);

// The countries not found first try, with what was clicked instead. Shown only once a round is over.
export function ReviewList({ answers, countries, nameOf }: { answers: Attempt[]; countries: Map<string, Country>; nameOf: (id: string) => string }) {
  const review = answers.filter(a => !isFirstTry(a));
  if (!review.length) return null;
  return <>
    <div className="eyebrow">Countries to review · {review.length}</div>
    <ul className="answers">{review.map(a => <li key={a.id}>
      <span className="who"><Flag iso2={countries.get(a.id)?.iso2} /><span>{countries.get(a.id)?.name}
        <small>{a.hint ? `Show me${a.mistakes ? ` after ${a.mistakes} wrong` : ''}` : `${a.mistakes} wrong: ${wrongList(a.wrongIds).map(([id, n]) => `${nameOf(id)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}`}</small></span></span>
      <span>{a.points}</span>
    </li>)}</ul>
  </>;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Counts a number up from 0 over about 0.6 s (or shows it at once with reduced motion).
function useCountUp(target: number, ms = 650) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) { setValue(target); return; }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

const LABEL: { [S in Comparison['stat']]: string } = { score: 'Score', accuracy: 'First-try accuracy', time: 'Time', streak: 'Longest streak', mistakes: 'Mistakes' };
const show = (c: Comparison, v: number) => (c.stat === 'accuracy' ? pct(v) : c.stat === 'time' ? formatTime(v) : v.toLocaleString());

type Props = {
  area: string; modeLabel: string;
  stats: Stats; answers: Attempt[];
  before: PersonalBests | null;   // the records as they stood before this run; null on a first Sprint
  bests: NewBests | null;
  countries: Map<string, Country>; nameOf: (id: string) => string;
  onPlayAgain: () => void; onChange: () => void;
};

// The arcade results: the score out of 1,000, how it compares with the player's bests, and an instant replay.
export function SprintResults({ area, modeLabel, stats, answers, before, bests, countries, nameOf, onPlayAgain, onChange }: Props) {
  const rows = compareWithBests({ score: stats.score, accuracy: stats.accuracy ?? 0, ms: stats.elapsedMs, streak: stats.longestStreak, mistakes: stats.totalMistakes }, before);
  const [score, ...tiles] = rows;
  const shown = useCountUp(stats.score);
  const record = before !== null && (bests?.run || score.better);
  // Play again takes focus so Enter replays, without scrolling the panel away from the score (autoFocus would).
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => again.current?.focus({ preventScroll: true }), []);
  return <div className="sprint-results">
    <div className="eyebrow"><Icon name="bolt" /> Sprint complete · {area} · {modeLabel}</div>
    {stats.perfect && <div className="perfect">Perfect sprint<span>Ten for ten. No mistakes, no hints.</span></div>}
    {record && <div className="record">New personal best<span>Your best {area} Sprint{bests?.run ? ' run yet' : ' score'}.</span></div>}
    {before === null && <div className="record first">First Sprint record<span>Now beat it.</span></div>}
    <div className="sprint-score">
      <strong aria-label={`${stats.score} points`}>{shown.toLocaleString()}</strong><small>/ {stats.maxScore.toLocaleString()}</small>
      {score.best !== null && <span className={score.better ? 'delta up' : 'delta'}>{score.better ? `+${score.delta!.toLocaleString()} on your best` : `Best ${score.best.toLocaleString()}`}</span>}
    </div>
    <div className="sprint-stats">
      {tiles.map(c => <div key={c.stat} className={c.better ? 'better' : ''}>
        <span>{LABEL[c.stat]}</span>
        <strong>{show(c, c.value)}</strong>
        <small>{c.better ? 'New best' : c.best === null ? '—' : `Best ${show(c, c.best)}`}</small>
      </div>)}
    </div>
    <ReviewList answers={answers} countries={countries} nameOf={nameOf} />
    <button ref={again} className="btn primary big" onClick={onPlayAgain}>Play again <kbd>Enter</kbd></button>
    <button className="btn" onClick={onChange}>Change challenge</button>
    <p className="fine">Personal arcade records, kept in this browser. Each Sprint draws a new random ten, so runs differ in difficulty.</p>
  </div>;
}
