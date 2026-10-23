import { isMastered, type Progress } from './progress';

// A quick round; a full round plays every country in the area.
export const QUICK_ROUND = 10;
// Points for a correct answer on the 1st, 2nd and 3rd attempt. After the 3rd miss the answer is shown for 0 points.
export const ATTEMPT_POINTS = [100, 60, 30];
export const MAX_POINTS = ATTEMPT_POINTS[0];

// Picks the round's questions in order, three times as likely to pick a country you have not mastered yet,
// so in a full round the countries you still need come up earlier.
export function pickRound(ids: string[], progress: Progress, n = ids.length): string[] {
  const pool = ids.map(id => ({ id, w: isMastered(progress, id) ? 1 : 3 }));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    let r = Math.random() * pool.reduce((s, p) => s + p.w, 0);
    const i = pool.findIndex(p => (r -= p.w) <= 0);
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0].id);
  }
  return out;
}
