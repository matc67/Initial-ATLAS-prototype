// The rules of the game on screen, for the Help panel during play: what to do, how it scores, and what Help itself does to
// the clock. Opening Help never changes a score or a run; only the round and mystery clocks pause while it is open.
import { ATTEMPT_POINTS, LATE_POINTS } from './scoring.ts';
import { SPRINT_SIZE, type GameMode } from './challenges.ts';
import { rushName, type RushMode } from './cityRush.ts';

export type HelpContext =
  | { kind: 'round'; mode: GameMode; sprint: boolean; unit: string; units: string; scope: string; regions: boolean }
  | { kind: 'mystery' }
  | { kind: 'rush'; mode: RushMode; durationMs: number | null; country: string };
export type HelpTopic = { title: string; rules: string[] };

const a = (unit: string) => (/^[aeiou]/i.test(unit) ? `an ${unit}` : `a ${unit}`);

export function helpTopic(c: HelpContext): HelpTopic {
  if (c.kind === 'round') {
    const what = c.mode === 'find' ? `Find it: we name ${a(c.unit)}; click it on the globe.`
      : c.mode === 'name' ? `Name it: ${a(c.unit)} lights up in gold; type its name below and press Enter.`
      : `Flags: we show a flag; click its ${c.unit} on the globe.`;
    const length = c.sprint ? `Sprint: ${SPRINT_SIZE} ${c.units} from ${c.scope}.` : `Full challenge: every ${c.unit} in ${c.scope}, once each.`;
    return {
      title: c.regions ? `Regions: ${c.units}` : c.sprint ? 'Sprint' : 'Full challenge',
      rules: [
        what, length,
        `Points: ${ATTEMPT_POINTS.join(', ')} for the 1st, 2nd and 3rd attempt, then ${LATE_POINTS}. A wrong answer never shows the right one.`,
        'First-try answers in a row earn a streak bonus.',
        'Stuck? Show me reveals the answer for 0 points.',
        'The clock is paused while Help is open. Time never changes points.',
      ],
    };
  }
  if (c.kind === 'mystery') return {
    title: 'Mystery Country',
    rules: [
      'A country is hidden. Type any country to guess it.',
      'Each wrong guess is coloured by how far it is from the answer: the redder, the closer. Your closest guess so far is shown at the top.',
      'Solve it in as few guesses as you can. Guesses lists every one so far.',
      'The clock is paused while Help is open.',
    ],
  };
  const name = rushName(c.durationMs);
  return {
    title: `${name} · ${c.country}`,
    rules: [
      'Type a city and press Enter: it lands on the globe and adds its people to your coverage.',
      'A name means the largest city of that name. For another, add its region: “Portland, Maine”.',
      'Coverage is the share of the people in the listed cities, not of the whole country.',
      c.mode === 'timed'
        ? 'The clock keeps running while Help is open. Finish shows your results now; Abandon discards the run.'
        : 'No clock: your map is saved as you go. Leave keeps it for later; Finish shows your results.',
    ],
  };
}
