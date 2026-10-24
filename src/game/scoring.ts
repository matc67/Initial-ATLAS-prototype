// The rules of a round, as pure functions with no browser or React dependencies, so they can be tested with `npm test`.
// Accuracy comes first, then consistency (streaks), then speed. Time never changes points.

// One finished question. `wrongIds` are the countries (or, in Name it, the typed answers) guessed wrongly before it ended.
export type Attempt = { id: string; points: number; mistakes: number; wrongIds: string[]; hint: boolean };
// Active play time: `accumulated` ms from earlier running spells, plus the current spell since `since` (null when paused).
export type Clock = { accumulated: number; since: number | null };
export type Round = {
  queue: string[];        // the countries to find, in order
  index: number;          // the current question
  answers: Attempt[];     // finished questions, in order: the single record of what is completed
  wrong: string[];        // wrong guesses on the current question
  hint: boolean;          // whether Show me was used on the current question
  streak: number;         // consecutive first-try correct answers
  best: number;           // longest streak this round
  phase: 'asking' | 'revealed' | 'done';
  clock: Clock;
  last: { id: string; at: number } | null; // the last accepted guess, to drop a repeat of the same click
};
export type Outcome = 'correct' | 'wrong' | 'ignored';

// Correct on the 1st, 2nd and 3rd attempt; 4th or later earns LATE_POINTS. Show me earns 0.
export const ATTEMPT_POINTS = [100, 50, 25];
export const LATE_POINTS = 10;
export const MAX_POINTS = ATTEMPT_POINTS[0];
// A second click on the same country this soon after the first is the same physical interaction (bounce, double-click).
export const REPEAT_MS = 300;
export const STREAK_MILESTONES = [5, 10, 20, 50, 100];

export const pointsFor = (mistakes: number, hint: boolean) => (hint ? 0 : ATTEMPT_POINTS[mistakes] ?? LATE_POINTS);
export const isFirstTry = (a: Attempt) => !a.hint && a.mistakes === 0;

// ---- Clock -------------------------------------------------------------------------------------------------------------
export const elapsed = (c: Clock, now: number) => c.accumulated + (c.since === null ? 0 : now - c.since);
export const pauseClock = (c: Clock, now: number): Clock => (c.since === null ? c : { accumulated: elapsed(c, now), since: null });
export const resumeClock = (c: Clock, now: number): Clock => (c.since === null ? { ...c, since: now } : c);
export const isPaused = (r: Round) => r.clock.since === null;

// ---- Round transitions --------------------------------------------------------------------------------------------------
export const newRound = (queue: string[], now: number): Round => ({
  queue, index: 0, answers: [], wrong: [], hint: false, streak: 0, best: 0, phase: 'asking', clock: { accumulated: 0, since: now }, last: null,
});

export const targetOf = (r: Round) => (r.phase === 'done' ? undefined : r.queue[r.index]);
export const isCompleted = (r: Round, id: string) => r.answers.some(a => a.id === id);

// Ends the current question and moves on: to the next question, or to `done` with the clock stopped.
function finish(r: Round, now: number): Round {
  const attempt: Attempt = { id: r.queue[r.index], points: pointsFor(r.wrong.length, r.hint), mistakes: r.wrong.length, wrongIds: r.wrong, hint: r.hint };
  const first = isFirstTry(attempt);
  const streak = first ? r.streak + 1 : 0;
  const answered: Round = { ...r, answers: [...r.answers, attempt], wrong: [], hint: false, streak, best: Math.max(r.best, streak) };
  return advance(answered, now);
}

function advance(r: Round, now: number): Round {
  if (r.index + 1 >= r.queue.length) return { ...r, phase: 'done', clock: pauseClock(r.clock, now) };
  return { ...r, index: r.index + 1, phase: 'asking' };
}

// A click on country `id` (already checked by the caller to be inside the round's area and country set).
// Ignored: not asking, paused, a completed country, or a repeat of the same click within REPEAT_MS.
export function guess(r: Round, id: string, now: number): { round: Round; outcome: Outcome } {
  if (r.phase !== 'asking' || isPaused(r) || isCompleted(r, id)) return { round: r, outcome: 'ignored' };
  if (r.last && r.last.id === id && now - r.last.at < REPEAT_MS) return { round: r, outcome: 'ignored' };
  const last = { id, at: now };
  if (id === r.queue[r.index]) return { round: finish({ ...r, last }, now), outcome: 'correct' };
  // A wrong guess is recorded at once and breaks the streak immediately.
  return { round: { ...r, wrong: [...r.wrong, id], streak: 0, last }, outcome: 'wrong' };
}

// Name it: a typed answer. `correct` is decided by the caller's name matching; a wrong one is recorded by its text.
export function typedGuess(r: Round, text: string, correct: boolean, now: number): { round: Round; outcome: Outcome } {
  if (r.phase !== 'asking' || isPaused(r)) return { round: r, outcome: 'ignored' };
  return guess(r, correct ? r.queue[r.index] : `typed:${text.trim().toLowerCase()}`, now);
}

// Show me: the answer is shown for 0 points and the streak resets. The question ends, and the player moves on with next().
export function reveal(r: Round, now: number): Round {
  if (r.phase !== 'asking' || isPaused(r)) return r;
  const attempt: Attempt = { id: r.queue[r.index], points: 0, mistakes: r.wrong.length, wrongIds: r.wrong, hint: true };
  return { ...r, answers: [...r.answers, attempt], wrong: [], hint: false, streak: 0, phase: 'revealed', last: null };
}

// After a revealed answer: on to the next question, or to `done`.
export function next(r: Round, now: number): Round {
  return r.phase === 'revealed' ? advance(r, now) : r;
}

export const pause = (r: Round, now: number): Round => ({ ...r, clock: pauseClock(r.clock, now) });
export const resume = (r: Round, now: number): Round => (r.phase === 'done' ? r : { ...r, clock: resumeClock(r.clock, now) });

// ---- Statistics (derived, never stored separately) ---------------------------------------------------------------------
export type Stats = {
  score: number; maxScore: number; completed: number; total: number;
  firstTryCorrect: number; countriesMissed: number; totalMistakes: number; hintsUsed: number;
  accuracy: number | null; // first-try accuracy in %, or null before any country is completed
  longestStreak: number; elapsedMs: number; perfect: boolean;
};

export function statsOf(r: Round, now: number): Stats {
  const completed = r.answers.length;
  const firstTryCorrect = r.answers.filter(isFirstTry).length;
  const totalMistakes = r.answers.reduce((n, a) => n + a.mistakes, 0) + r.wrong.length;
  const hintsUsed = r.answers.filter(a => a.hint).length;
  return {
    score: r.answers.reduce((n, a) => n + a.points, 0),
    maxScore: r.queue.length * MAX_POINTS,
    completed, total: r.queue.length,
    firstTryCorrect, countriesMissed: completed - firstTryCorrect, totalMistakes, hintsUsed,
    accuracy: completed ? (firstTryCorrect / completed) * 100 : null,
    longestStreak: r.best,
    elapsedMs: elapsed(r.clock, now),
    perfect: r.phase === 'done' && firstTryCorrect === r.queue.length && totalMistakes === 0 && hintsUsed === 0,
  };
}

// Countries not found on the first try, for the results screen and a future Practice Mistakes mode.
export const reviewOf = (r: Round) => r.answers.filter(a => !isFirstTry(a));

// ---- Ranking -------------------------------------------------------------------------------------------------------------
// A run's numbers for ranking. Records, history and storage are in records.ts.
export type RunRecord = { score: number; maxScore: number; accuracy: number; mistakes: number; ms: number; streak: number; perfect: boolean };
export type NewBests = { score: boolean; accuracy: boolean; mistakes: boolean; time: boolean; streak: boolean; run: boolean };

// Positive when `a` ranks above `b`, compared in order and moving on only on a tie: higher first-try accuracy, higher score,
// fewer mistakes, then faster active time. So time can only separate runs that are equally accurate.
export function compareRuns(a: RunRecord, b: RunRecord): number {
  return a.accuracy - b.accuracy || a.score - b.score || b.mistakes - a.mistakes || b.ms - a.ms;
}

// 42 s → "0:42", 272 s → "4:32", 4 h 5 m 9 s → "4:05:09".
export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
