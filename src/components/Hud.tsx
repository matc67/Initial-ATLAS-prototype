// The gameplay HUD: the country to find, then time, score, streak and mistakes in large readouts, and the answer
// feedback. Every effect here is decoration over a round that has already moved on: nothing blocks a click or waits.
import type { CSSProperties } from 'react';
import type { Playable } from '../game/playable';
import { celebration, FEEDBACK, flameTier, nextAttempt, STREAK_LOST_FROM, type AnswerEvent } from '../game/feedback';
import { formatTime, pointsFor, type Round, type Stats } from '../game/scoring';
import { Flag, Icon, useTween } from './ui';

// The latest answer's feedback. `key` restarts the animations for each new answer; `at` (performance.now()) lets them
// unmount once played, so a pause or re-render never replays an old one.
export type HudFx = { key: number; at: number; event: AnswerEvent | null; lost: number };
export const FX_MS = 2400;

type Props = {
  kindLabel: string | null;   // "Sprint", or null for a Full Challenge
  area: string; mode: 'find' | 'name'; held: boolean;
  round: Round; stats: Stats; target: Playable;
  unit: string;               // what is asked for, singular: "country", "province or territory"
  message: string;            // a neutral note (the ocean, outside the area…): never a mistake
  miss: string | null;        // set after a wrong answer: '' in Find it, `Not “…”` in Name it
  fx: HudFx | null; now: number;
  sound: boolean; onSound: () => void;
  onHold: (held: boolean) => void; onEnd: () => void; onReveal: () => void; onNext: () => void;
};

export default function Hud(p: Props) {
  const { round, stats } = p;
  const score = useTween(stats.score, 450);
  const fx = p.fx && p.now - p.fx.at < FX_MS ? p.fx : null;
  const ev = fx?.event ?? null;
  const good = ev?.kind === 'correct' ? ev : null;
  const party = good?.milestone ? celebration(good.milestone) : null;
  const tier = flameTier(round.streak);
  const flash = party ? 'gold' : ev?.kind === 'wrong' ? 'bad' : good ? 'good' : null;
  return <section className="hud">
    {flash && <span className={`hud-flash ${flash}`} key={fx!.key} aria-hidden="true" />}
    <div className="hud-top">
      <span className="hud-area">{p.kindLabel && <><Icon name="bolt" />{p.kindLabel} · </>}{p.area}</span>
      <div className="bar"><div style={{ width: `${(stats.completed / stats.total) * 100}%` }} /></div>
      <span className="hud-count"><b>{stats.completed}</b> / {stats.total}</span>
      <button className="icon-btn" data-silent aria-label={p.sound ? 'Mute sounds' : 'Turn sounds on'} aria-pressed={p.sound} title={p.sound ? 'Sound on' : 'Sound off'} onClick={p.onSound}><Icon name={p.sound ? 'sound' : 'mute'} /></button>
      <button className="icon-btn" aria-label={p.held ? 'Resume' : 'Pause'} onClick={() => p.onHold(!p.held)}><Icon name={p.held ? 'play-small' : 'pause'} /></button>
      <button className="close" aria-label="End round" onClick={p.onEnd}>×</button>
    </div>

    {p.held ? <div className="hud-main paused">
      <div className="hud-name"><div><span className="verb">Paused</span><h2>Take your time</h2></div></div>
      <button className="btn primary small" onClick={() => p.onHold(false)}>Resume</button>
    </div> : <div className="hud-main">
      {/* Find it shows the flag with the name; Name it keeps both hidden until the answer is revealed. */}
      {p.mode === 'find' || round.phase === 'revealed'
        ? <div className="hud-name"><Flag iso2={p.target.iso2} size="lg" /><div><span className="verb">{p.mode === 'find' ? 'Find' : 'It was'}</span><h2>{p.target.name}</h2></div></div>
        : <div className="hud-name"><div><span className="verb">Name this {p.unit}</span><h2 className="muted-name">?</h2></div></div>}
    </div>}

    <div className={p.held ? 'hud-readouts held' : 'hud-readouts'}>
      <div className="readout time" role="timer" aria-label={`Time ${formatTime(stats.elapsedMs)}`}>
        <span>Time</span><strong>{formatTime(stats.elapsedMs)}</strong>
      </div>
      <div className="readout score" aria-label={`Score ${stats.score}`}>
        <span>Score</span><strong className={good ? 'up' : ''} key={good ? fx!.key : 'score'}>{score.toLocaleString()}</strong>
        {good && good.points > 0 && <em className="gain" key={`g${fx!.key}`}>✓ +{good.points}</em>}
        {good && good.bonus > 0 && <em className="gain bonus" key={`b${fx!.key}`}>+{good.bonus} bonus</em>}
      </div>
      <div className={`readout streak f${tier}`} title="Streak: first-try answers in a row">
        <span>Streak</span><strong><i aria-hidden="true">🔥</i>{round.streak}</strong>
        {fx && fx.lost >= STREAK_LOST_FROM && <em className="streak-lost" key={`l${fx.key}`}>Streak lost</em>}
      </div>
      <div className={stats.totalMistakes ? 'readout misses bad' : 'readout misses'} title="Incorrect guesses">
        <span>Mistakes</span><strong key={ev?.kind === 'wrong' ? fx!.key : 'm'} className={ev?.kind === 'wrong' ? 'bump' : ''}>✕ {stats.totalMistakes}</strong>
      </div>
    </div>

    {!p.held && <div className="hud-line">
      <div className="hud-msg-area" aria-live="polite">
        {p.miss !== null && round.phase === 'asking'
          ? <div className={ev?.kind === 'wrong' ? 'hud-wrong flash' : 'hud-wrong'} key={fx?.key}><strong>{FEEDBACK.wrong.replace(/\.$/, '')}</strong>
            <small>{p.miss && <>{p.miss} · </>}{nextAttempt(pointsFor(round.wrong.length, false))}</small></div>
          : <span className="hud-msg">{p.message || (round.phase === 'revealed' ? 'The answer is shown in gold.' : p.mode === 'find' ? 'Click it on the globe' : 'Type its name below')}</span>}
      </div>
      <span className="hud-meta">
        {round.phase === 'revealed'
          ? <button className="btn primary small" onClick={p.onNext}>{round.index + 1 >= round.queue.length ? 'See results' : 'Next'} <kbd>Enter</kbd></button>
          : <>{p.miss === null && <>Attempt {round.wrong.length + 1} · {pointsFor(round.wrong.length, false)} pts</>}<button className="link" onClick={p.onReveal}>Show me</button></>}
      </span>
    </div>}

    {party && <div className={`celebrate t${party.tier}`} key={`c${fx!.key}`} role="status">
      {party.tier > 1 && <span className="sparks" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--a': `${i * 36}deg` } as CSSProperties} />)}</span>}
      <strong><span aria-hidden="true">{party.icon}</span> {party.title}</strong><small>{party.detail}</small>
    </div>}
  </section>;
}
