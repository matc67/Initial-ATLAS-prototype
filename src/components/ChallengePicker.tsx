import { SPRINT_SIZE } from '../game/challenges';
import type { Performance } from '../game/records';
import { formatTime } from '../game/scoring';
import { Icon } from './ui';

type Props = {
  area: string;                // "Africa", "World"
  loading: boolean;
  poolSize: number;            // eligible countries in the area and set
  sprintBest?: Performance;
  fullBest?: Performance;
  onSprint: () => void;
  onFull: () => void;
};

const best = (p?: Performance) => p && `Best ${p.bestScore.toLocaleString()} · ${Math.round(p.bestAccuracy)}% · ${formatTime(p.fastestMs)}`;

// The two ways to play an area: a 10-country Sprint (the arcade mode, shown first) or the Full Challenge.
// Each card starts its run straight away.
export default function ChallengePicker({ area, loading, poolSize, sprintBest, fullBest, onSprint, onFull }: Props) {
  const sprintOk = poolSize >= SPRINT_SIZE;
  return <div className="challenges">
    <button className="challenge sprint" onClick={onSprint} disabled={loading || !sprintOk}>
      <span className="challenge-icon"><Icon name="bolt" /></span>
      <span className="challenge-body">
        <strong>{SPRINT_SIZE}-Country Sprint</strong>
        <span>{sprintOk ? `${SPRINT_SIZE} random countries. One clock. One score to beat.` : `Needs ${SPRINT_SIZE} countries; ${area} has ${poolSize}.`}</span>
        <em>{loading ? 'Loading the globe…' : best(sprintBest) ?? 'Set your first score'}</em>
      </span>
    </button>
    <button className="challenge" onClick={onFull} disabled={loading || !poolSize}>
      <span className="challenge-icon"><Icon name="globe" /></span>
      <span className="challenge-body">
        <strong>Full Challenge</strong>
        <span>All {poolSize} countries of {area}.</span>
        <em>{loading ? 'Loading the globe…' : best(fullBest) ?? 'No completed runs yet'}</em>
      </span>
    </button>
  </div>;
}
