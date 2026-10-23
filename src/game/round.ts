import { isMastered, type Progress } from './progress';

export const ROUND_LENGTH = 10;
export const MAX_POINTS = 1000;
// Name it: points for the 1st, 2nd and 3rd typed guess; after that the answer is shown.
export const NAME_POINTS = [1000, 500, 250];

// Find it: one click. Exact = 1000; a miss scores by distance from the clicked country to the answer.
export const findPoints = (correct: boolean, km: number) => (correct ? MAX_POINTS : Math.round(800 * Math.exp(-km / 1000)));

// Picks the round's questions, three times as likely to pick a country you have not mastered yet.
export function pickRound(ids: string[], progress: Progress, n = ROUND_LENGTH): string[] {
  const pool = ids.map(id => ({ id, w: isMastered(progress, id) ? 1 : 3 }));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    let r = Math.random() * pool.reduce((s, p) => s + p.w, 0);
    const i = pool.findIndex(p => (r -= p.w) <= 0);
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].id);
  }
  return out;
}
