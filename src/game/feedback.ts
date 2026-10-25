import { bonusAt, isFirstTry, milestoneAt, pointsFor, type Milestone, type Outcome, type Round } from './scoring.ts';

// Messages shown during an active challenge. Play tests geography, so none of them may identify what was clicked: no name,
// flag, capital or region of a wrong country, and no name for land outside the game. They take no country argument at
// all, so they cannot. Explore is where countries are named.
export const FEEDBACK = {
  wrong: 'Incorrect — try again.',
  ocean: 'That was the ocean. Click a country.',
  notInGame: 'That land is not one of the countries in this game.',
  outsideArea: (areaTitle: string) => `That country is outside ${areaTitle}.`,
  notInSet: 'That country is not part of the Classic 195.',
  // Several tiny countries sit under the pointer: the map zooms in so the player can choose. Never a mistake.
  tooClose: 'Too close to call. Zoomed in so you can choose.',
} as const;

// What a player sees the moment an answer lands, worked out from the round before and after it. Pure, so the HUD never
// works out points itself and an ignored click (a repeat, a pause, a completed country) can never show as a mistake.
export type AnswerEvent =
  | { kind: 'correct'; points: number; bonus: number; milestone?: Milestone; streak: number }
  | { kind: 'wrong'; nextPoints: number; lostStreak: number };
export function answerEvent(before: Round, after: Round, outcome: Outcome): AnswerEvent | null {
  if (outcome === 'ignored') return null;
  if (outcome === 'wrong') return { kind: 'wrong', nextPoints: pointsFor(after.wrong.length, false), lostStreak: before.streak };
  const a = after.answers.at(-1)!, streak = isFirstTry(a) ? before.streak + 1 : 0;
  return { kind: 'correct', points: a.points, bonus: bonusAt(streak), milestone: milestoneAt(streak), streak };
}

export const nextAttempt = (points: number) => `Next attempt · ${points} pts`;
// "Streak lost" shows whenever a streak of at least this length breaks (never for a streak of 0).
export const STREAK_LOST_FROM = 1;

// The celebration for each streak milestone, growing with the streak. No country is named.
export function celebration(m: Milestone): { icon: string; title: string; detail: string; tier: 1 | 2 | 3 | 4 } {
  const detail = `+${m.bonus.toLocaleString('en-US')} bonus`;
  if (m.streak >= 100) return { icon: '👑', title: 'World class!', detail, tier: 4 };
  if (m.streak >= 50) return { icon: '💎', title: 'Legendary!', detail, tier: 4 };
  if (m.streak >= 20) return { icon: '🏆', title: 'Incredible streak!', detail, tier: 4 };
  if (m.streak >= 10) return { icon: '⚡', title: 'Unstoppable!', detail, tier: 3 };
  if (m.streak >= 5) return { icon: '🔥', title: 'On fire!', detail, tier: 2 };
  return { icon: '🔥', title: `${m.streak} in a row!`, detail, tier: 1 };
}

// The live streak flame: 0 neutral, 1–2 subtle, 3–4 bright, 5–9 gold, 10+ blazing.
export const flameTier = (streak: number): 0 | 1 | 2 | 3 | 4 => (streak >= 10 ? 4 : streak >= 5 ? 3 : streak >= 3 ? 2 : streak >= 1 ? 1 : 0);
