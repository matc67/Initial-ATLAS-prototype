// Optional arcade sounds: a few short tones made with Web Audio, so there are no files to load. Off until the player
// turns them on (the HUD's speaker button); the choice is remembered in this browser.
export type Cue = 'correct' | 'wrong' | 'milestone' | 'record';

const KEY = 'atlas-sound';
export const loadSound = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };
export const saveSound = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* lasts for this visit */ } };

// Notes as [frequency Hz, start s, length s]. Quiet (peak gain 0.06) and short, so repeats never grate.
const CUES: { [C in Cue]: { wave: OscillatorType; notes: [number, number, number][] } } = {
  correct: { wave: 'triangle', notes: [[880, 0, 0.09], [1320, 0.06, 0.12]] },
  wrong: { wave: 'sine', notes: [[220, 0, 0.12], [175, 0.08, 0.16]] },
  milestone: { wave: 'triangle', notes: [[660, 0, 0.1], [880, 0.08, 0.1], [1100, 0.16, 0.1], [1320, 0.24, 0.2]] },
  record: { wave: 'triangle', notes: [[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.14], [1047, 0.36, 0.34]] },
};

let ctx: AudioContext | null = null;
export function play(cue: Cue) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const { wave, notes } = CUES[cue], t0 = ctx.currentTime;
    for (const [freq, start, len] of notes) {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), t = t0 + start;
      osc.type = wave;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.06, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + len + 0.02);
    }
  } catch { /* no Web Audio: play on in silence */ }
}
