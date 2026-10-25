import { SPRINT_SIZE } from '../game/challenges';
import type { Performance } from '../game/records';
import { averageGuesses, type MysteryRecord } from '../game/mysteryRecords';
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
  mysteryBest?: MysteryRecord;  // Mystery Country plays the whole world in the chosen set, whatever the area
  mysterySize: number;
  onMystery: () => void;
};

const best = (p?: Performance) => p && `Best ${p.bestScore.toLocaleString()} · ${Math.round(p.bestAccuracy)}% · ${formatTime(p.fastestMs)}`;

const mysteryLine = (r?: MysteryRecord) => r && r.solved > 0 && `Best ${r.fewest} ${r.fewest === 1 ? 'guess' : 'guesses'} · average ${averageGuesses(r)!.toFixed(1)} · ${r.solved} solved`;

// The ways to play: a 10-country Sprint (the arcade mode, shown first), the area's Full Challenge, and Mystery Country.
// Each card starts its run straight away.
export default function ChallengePicker({ area, loading, poolSize, sprintBest, fullBest, onSprint, onFull, mysteryBest, mysterySize, onMystery }: Props) {
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
    <button className="challenge mystery" onClick={onMystery} disabled={loading || !mysterySize}>
      <span className="challenge-icon"><Icon name="mystery" /></span>
      <span className="challenge-body">
        <strong>Mystery Country</strong>
        <span>Find the hidden country. Every guess brings you closer.</span>
        <em>{loading ? 'Loading the globe…' : mysteryLine(mysteryBest) || `Anywhere in the world · ${mysterySize} countries`}</em>
      </span>
    </button>
  </div>;
}
