// Arcade sound effects, made with Web Audio: no files, no music, nothing continuous. Off until the player turns them on;
// the choice and the volume are remembered in this browser. Each sound is a short recipe of notes (pure data, tested);
// the manager plays them through one reused AudioContext and one master gain, so muting is immediate.
import type { AnswerEvent } from './game/feedback.ts';
import { flameTier } from './game/feedback.ts';

export type Cue =
  | { kind: 'correct'; streak: number }    // brighter as the streak grows; never louder
  | { kind: 'milestone'; streak: number }  // replaces the correct sound at 3, 5, 10, 20, 50, 100
  | { kind: 'wrong' }                      // a soft tap: "not quite", never a buzzer
  | { kind: 'record' }                     // a short victory flourish, once per finished run
  | { kind: 'ui' };                        // a very quiet click for menus and buttons

// The sound for an answer: a milestone's chime takes the place of the ordinary correct sound, never both.
export const cueFor = (e: AnswerEvent): Cue =>
  e.kind === 'wrong' ? { kind: 'wrong' } : e.milestone ? { kind: 'milestone', streak: e.milestone.streak } : { kind: 'correct', streak: e.streak };

// ---- Recipes ----------------------------------------------------------------------------------------------------------
// A note: `freq` Hz (gliding to `to` if given), starting `at` s after the cue, lasting `len` s, at relative `gain` (0–1).
// Every recipe passes through a low-pass filter at `lowpass` Hz, which keeps highs soft.
export type Note = { freq: number; to?: number; at: number; len: number; gain: number; wave: OscillatorType };
export type Recipe = { notes: Note[]; lowpass: number };

const tone = (freq: number, at: number, len: number, gain: number, wave: OscillatorType = 'sine', to?: number): Note => ({ freq, to, at, len, gain, wave });
// A chime: a sine with a quiet octave above it for shimmer.
const chime = (freq: number, at: number, len: number, gain: number): Note[] => [tone(freq, at, len, gain), tone(freq * 2, at, len * 0.6, gain * 0.18)];

export function recipe(cue: Cue): Recipe {
  switch (cue.kind) {
    case 'correct': {
      // A crisp click and a short rising tone, ~150 ms. Higher streaks lift the pitch a little and add a soft fifth.
      const tier = flameTier(cue.streak), lift = [1, 1, 1.06, 1.12, 1.19][tier];
      const notes = [tone(1250, 0, 0.018, 0.35, 'triangle'), tone(620 * lift, 0.008, 0.15, 0.8, 'sine', 830 * lift)];
      if (tier >= 4) notes.push(tone(1245 * lift, 0.03, 0.12, 0.14));
      return { notes, lowpass: 3800 };
    }
    case 'wrong':
      // A soft, muted tap at one pitch, ~80 ms, well under the correct sound. No buzz, no falling tone, no deep bass.
      return { notes: [tone(360, 0, 0.08, 0.32, 'triangle')], lowpass: 900 };
    case 'milestone': {
      const s = cue.streak;
      if (s < 5) return { notes: [tone(1250, 0, 0.018, 0.3, 'triangle'), ...chime(880, 0.01, 0.22, 0.75), ...chime(1175, 0.09, 0.22, 0.5)], lowpass: 4200 };
      if (s < 10) return { notes: [...chime(880, 0, 0.3, 0.8), ...chime(1319, 0.12, 0.38, 0.7)], lowpass: 4500 };
      if (s < 20) return { notes: [784, 988, 1175, 1568].flatMap((f, i) => chime(f, i * 0.08, i === 3 ? 0.45 : 0.22, 0.7)), lowpass: 4800 };
      // 20, 50, 100: the same arpeggio with a warm chord under the last note; a little fuller each time, never longer than 0.8 s.
      const extra = s >= 100 ? 0.3 : s >= 50 ? 0.22 : 0.15;
      return {
        notes: [...[784, 988, 1175, 1568].flatMap((f, i) => chime(f, i * 0.07, i === 3 ? 0.6 : 0.2, 0.7)),
          tone(392, 0.21, 0.55, extra), tone(587, 0.21, 0.55, extra * 0.8), tone(784, 0.21, 0.55, extra * 0.6)],
        lowpass: 5000,
      };
    }
    case 'record':
      // A short fanfare, ~1.1 s: up a major arpeggio, then a held chord.
      return {
        notes: [...[523, 659, 784].flatMap((f, i) => chime(f, i * 0.11, 0.2, 0.7)),
          ...chime(1047, 0.33, 0.75, 0.75), tone(523, 0.33, 0.75, 0.25), tone(659, 0.33, 0.75, 0.2), tone(784, 0.33, 0.75, 0.18)],
        lowpass: 4500,
      };
    case 'ui':
      return { notes: [tone(900, 0, 0.025, 0.22, 'triangle')], lowpass: 2500 };
  }
}
export const lengthOf = (r: Recipe) => Math.max(...r.notes.map(n => n.at + n.len));

// ---- Manager ------------------------------------------------------------------------------------------------------------
// The parts of Web Audio used here, so tests can pass a fake context.
type Param = { value: number; setValueAtTime(v: number, t: number): unknown; linearRampToValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown; setTargetAtTime(v: number, t: number, c: number): unknown; cancelScheduledValues(t: number): unknown };
type Node = { connect(n: unknown): unknown; disconnect(): void };
export type AudioLike = {
  currentTime: number; state: string; destination: unknown; resume(): Promise<void>;
  createGain(): Node & { gain: Param };
  createOscillator(): Node & { type: OscillatorType; frequency: Param; start(t: number): void; stop(t: number): void; onended: (() => void) | null };
  createBiquadFilter(): Node & { type: BiquadFilterType; frequency: Param };
};
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export const SOUND_KEY = 'atlas-sound', VOLUME_KEY = 'atlas-volume';
export const DEFAULT_VOLUME = 0.6;
// The loudest the master gain goes, at volume 1. Recipes are relative to this.
const HEADROOM = 0.22;
// Minimum gaps between repeats of a cue, in ms: rapid wrong guesses give one tap, not a pile of them.
export const COOLDOWN_MS: { [K in Cue['kind']]: number } = { correct: 40, milestone: 40, wrong: 220, record: 3000, ui: 50 };

export class AudioManager {
  enabled: boolean;
  volume: number;
  private ctx: AudioLike | null = null;
  private master: (Node & { gain: Param }) | null = null;
  private unavailable = false;
  private last = new Map<Cue['kind'], number>();
  // Voices of the sound playing now. A new answer sound fades these out, so sounds never compete.
  private voices: { osc: ReturnType<AudioLike['createOscillator']>; env: Node & { gain: Param } }[] = [];

  private opts: { create?: () => AudioLike; store?: Store | null; now?: () => number };

  constructor(opts: { create?: () => AudioLike; store?: Store | null; now?: () => number } = {}) {
    this.opts = opts;
    const s = this.store();
    this.enabled = read(s, SOUND_KEY) === 'on';
    const v = Number(read(s, VOLUME_KEY));
    this.volume = read(s, VOLUME_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
  }

  private store(): Store | null {
    if (this.opts.store !== undefined) return this.opts.store;
    try { return globalThis.localStorage ?? null; } catch { return null; }
  }
  private now() { return this.opts.now?.() ?? performance.now(); }

  setEnabled(on: boolean) {
    this.enabled = on;
    write(this.store(), SOUND_KEY, on ? 'on' : 'off');
    if (!on) this.silence();
    this.applyVolume();
  }
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    write(this.store(), VOLUME_KEY, String(this.volume));
    this.applyVolume();
  }

  // Plays a cue if sound is on. Returns whether it played (false when muted, cooling down, or audio is unavailable).
  play(cue: Cue): boolean {
    if (!this.enabled || this.volume === 0) return false;
    const t = this.now(), prev = this.last.get(cue.kind);
    if (prev !== undefined && t - prev < COOLDOWN_MS[cue.kind]) return false;
    const ctx = this.context();
    if (!ctx || !this.master) return false;
    this.last.set(cue.kind, t);
    // Autoplay rules: a context made before any click starts suspended. resume() is tried on every play, which happens
    // in response to a click, and a refusal is ignored (the game plays on in silence).
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (cue.kind !== 'ui') this.fadeVoices(ctx.currentTime);
    const r = recipe(cue), t0 = ctx.currentTime + 0.005;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = r.lowpass;
    filter.connect(this.master);
    for (const n of r.notes) {
      const osc = ctx.createOscillator(), env = ctx.createGain(), start = t0 + n.at, end = start + n.len;
      osc.type = n.wave;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(n.gain, start + Math.min(0.008, n.len / 4));
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env);
      env.connect(filter);
      const voice = { osc, env };
      osc.onended = () => { this.voices = this.voices.filter(v => v !== voice); env.disconnect(); };
      this.voices.push(voice);
      osc.start(start);
      osc.stop(end + 0.02);
    }
    return true;
  }

  // The one AudioContext, made on first use. If the browser has no Web Audio, or refuses, sound stays off quietly.
  private context(): AudioLike | null {
    if (this.ctx || this.unavailable) return this.ctx;
    try {
      const make = this.opts.create ?? (() => new AudioContext() as unknown as AudioLike);
      this.ctx = make();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
    } catch { this.unavailable = true; this.ctx = null; this.master = null; }
    return this.ctx;
  }
  private applyVolume() {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume * HEADROOM : 0, this.ctx.currentTime, 0.01);
  }
  private fadeVoices(at: number) {
    for (const { osc, env } of this.voices) {
      env.gain.cancelScheduledValues(at);
      env.gain.setTargetAtTime(0, at, 0.012);
      try { osc.stop(at + 0.06); } catch { /* already stopped */ }
    }
    this.voices = [];
  }
  private silence() { if (this.ctx) this.fadeVoices(this.ctx.currentTime); }
}

function read(s: Store | null, k: string) { try { return s?.getItem(k) ?? null; } catch { return null; } }
function write(s: Store | null, k: string, v: string) { try { s?.setItem(k, v); } catch { /* storage blocked: lasts for this visit */ } }
