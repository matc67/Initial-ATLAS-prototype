// Per-country learning record, kept in this browser until accounts arrive.
export type Record = { attempts: number; firstTry: number; lastSeen: string };
export type Progress = { [id: string]: Record };

const KEY = 'atlas-progress-v2';
export const MASTERY_FIRST_TRIES = 2;

export function loadProgress(): Progress {
  try {
    const v2 = localStorage.getItem(KEY);
    if (v2) return JSON.parse(v2);
    // The v0.1 prototype stored { firstTries, attempts, lastCorrect } under ISO alpha-3 ids, which match the roster ids.
    const v1 = JSON.parse(localStorage.getItem('atlas-progress-v1') || '{}') as { [id: string]: { firstTries: number; attempts: number; lastCorrect: string } };
    return Object.fromEntries(Object.entries(v1).map(([id, r]) => [id, { attempts: r.attempts, firstTry: r.firstTries, lastSeen: r.lastCorrect }]));
  } catch { return {}; }
}

export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked: progress lasts for this visit only */ }
}

export const isMastered = (p: Progress, id: string) => (p[id]?.firstTry ?? 0) >= MASTERY_FIRST_TRIES;

export function record(p: Progress, id: string, firstTry: boolean): Progress {
  const r = p[id] ?? { attempts: 0, firstTry: 0, lastSeen: '' };
  return { ...p, [id]: { attempts: r.attempts + 1, firstTry: r.firstTry + (firstTry ? 1 : 0), lastSeen: new Date().toISOString() } };
}
