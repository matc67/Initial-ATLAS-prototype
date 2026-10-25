// Sound effects: which cue plays when, the shape of each sound, muting, persistence, cooldowns and blocked audio.
// A fake AudioContext records what would have played.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioManager, COOLDOWN_MS, cueFor, DEFAULT_VOLUME, lengthOf, recipe, SOUND_KEY, VOLUME_KEY, type AudioLike, type Cue } from './audio.ts';
import { answerEvent } from './game/feedback.ts';
import { isNewRecord } from './game/sprint.ts';
import { guess, newRound, STREAK_MILESTONES } from './game/scoring.ts';

function fakeContext(state = 'running') {
  const started: { freq: number; at: number }[] = [];
  const param = () => {
    const p = { value: 0, setValueAtTime: (v: number, _t: number) => { p.value = v; }, linearRampToValueAtTime: (_v: number, _t: number) => {},
      exponentialRampToValueAtTime: (_v: number, _t: number) => {}, setTargetAtTime: (v: number, _t: number, _c: number) => { p.value = v; }, cancelScheduledValues: (_t: number) => {} };
    return p;
  };
  const node = () => ({ connect() {}, disconnect() {} });
  let resumed = 0;
  const ctx: AudioLike = {
    currentTime: 0, state, destination: {},
    resume: () => { resumed++; return Promise.reject(new Error('not allowed')); },
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param() }),
    createOscillator() {
      const o = { ...node(), type: 'sine' as OscillatorType, frequency: param(), onended: null as (() => void) | null, stop: (_t: number) => {}, start: (at: number) => { started.push({ freq: o.frequency.value, at }); } };
      return o;
    },
  };
  return { ctx, started, resumes: () => resumed };
}
function memory(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}
function manager(opts: { on?: boolean; state?: string; store?: ReturnType<typeof memory> } = {}) {
  const f = fakeContext(opts.state), store = opts.store ?? memory(opts.on === false ? {} : { [SOUND_KEY]: 'on' });
  let t = 0, made = 0;
  const m = new AudioManager({ create: () => { made++; return f.ctx; }, store, now: () => t });
  return { m, f, store, made: () => made, advance: (ms: number) => { t += ms; } };
}
const peak = (c: Cue) => Math.max(...recipe(c).notes.map(n => n.gain));

test('each answer gets one cue: correct, wrong, or a milestone chime instead of the correct sound', () => {
  let r = newRound(['A', 'B', 'C', 'D'], 0);
  const cues: Cue[] = [];
  for (const [id, t] of [['A', 1000], ['B', 2000], ['X', 3000], ['C', 4000]] as const) {
    const g = guess(r, id, t);
    const e = answerEvent(r, g.round, g.outcome);
    if (e) cues.push(cueFor(e));
    r = g.round;
  }
  assert.deepEqual(cues, [{ kind: 'correct', streak: 1 }, { kind: 'correct', streak: 2 }, { kind: 'wrong' }, { kind: 'correct', streak: 0 }]);
  assert.deepEqual(cueFor({ kind: 'correct', points: 100, bonus: 50, milestone: STREAK_MILESTONES[0], streak: 3 }), { kind: 'milestone', streak: 3 });
});

test('sound design: crisp correct, a quiet flat tap for wrong, short chimes, a ~1 s record flourish', () => {
  const correct = recipe({ kind: 'correct', streak: 1 }), wrong = recipe({ kind: 'wrong' });
  assert.ok(lengthOf(correct) >= 0.1 && lengthOf(correct) <= 0.2, `correct ${lengthOf(correct)}`);
  assert.ok(lengthOf(wrong) >= 0.06 && lengthOf(wrong) <= 0.12, `wrong ${lengthOf(wrong)}`);
  // The wrong tap is much quieter than the correct sound, at one pitch (no falling tone), muffled, and not bass.
  assert.ok(peak({ kind: 'wrong' }) < peak({ kind: 'correct', streak: 1 }) * 0.5);
  assert.ok(wrong.notes.every(n => n.to === undefined && n.freq >= 200 && n.freq <= 600));
  assert.ok(wrong.lowpass <= 1000);
  for (const s of STREAK_MILESTONES.map(m => m.streak)) assert.ok(lengthOf(recipe({ kind: 'milestone', streak: s })) <= 0.85, `milestone ${s}`);
  assert.ok(recipe({ kind: 'milestone', streak: 10 }).notes.length > recipe({ kind: 'milestone', streak: 3 }).notes.length);
  const record = lengthOf(recipe({ kind: 'record' }));
  assert.ok(record >= 0.5 && record <= 1.5, `record ${record}`);
});

test('the correct sound brightens with the streak without getting louder', () => {
  const pitch = (streak: number) => Math.max(...recipe({ kind: 'correct', streak }).notes.filter(n => n.to).map(n => n.freq));
  assert.ok(pitch(1) === pitch(2) && pitch(3) > pitch(2) && pitch(5) > pitch(3) && pitch(10) > pitch(5));
  const loudest = [1, 3, 5, 10, 40].map(s => peak({ kind: 'correct', streak: s }));
  assert.ok(loudest.every(g => g === loudest[0]));
});

test('sound is off by default and a muted manager plays nothing', () => {
  const { m, f, made } = manager({ on: false });
  assert.equal(m.enabled, false);
  assert.equal(m.volume, DEFAULT_VOLUME);
  assert.equal(m.play({ kind: 'correct', streak: 1 }), false);
  assert.equal(m.play({ kind: 'record' }), false);
  assert.equal(f.started.length, 0);
  assert.equal(made(), 0);   // no AudioContext is even made until sound is on
});

test('turning sound on and setting the volume persist; turning it off mutes at once', () => {
  const store = memory();
  const { m, f } = manager({ store });
  m.setEnabled(true);
  m.setVolume(0.3);
  assert.deepEqual([store.data.get(SOUND_KEY), store.data.get(VOLUME_KEY)], ['on', '0.3']);
  const again = new AudioManager({ create: () => f.ctx, store });
  assert.deepEqual([again.enabled, again.volume], [true, 0.3]);
  assert.equal(m.play({ kind: 'correct', streak: 1 }), true);
  m.setEnabled(false);
  assert.equal(store.data.get(SOUND_KEY), 'off');
  assert.equal(m.play({ kind: 'correct', streak: 2 }), false);
  // Corrupt or blocked storage falls back to the defaults.
  const bad = new AudioManager({ store: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
  assert.deepEqual([bad.enabled, bad.volume], [false, DEFAULT_VOLUME]);
  bad.setEnabled(true);   // does not throw
});

test('correct and wrong cues play; rapid wrong guesses give one tap, not a pile', () => {
  const { m, f, advance } = manager();
  assert.equal(m.play({ kind: 'correct', streak: 1 }), true);
  const afterCorrect = f.started.length;
  assert.ok(afterCorrect > 0);
  advance(100);
  assert.equal(m.play({ kind: 'wrong' }), true);
  advance(60);
  assert.equal(m.play({ kind: 'wrong' }), false);
  advance(60);
  assert.equal(m.play({ kind: 'wrong' }), false);
  advance(COOLDOWN_MS.wrong);
  assert.equal(m.play({ kind: 'wrong' }), true);
  assert.equal(f.started.length, afterCorrect + 2 * recipe({ kind: 'wrong' }).notes.length);
});

test('a new record plays one victory sound, however many stats improved', () => {
  const all = { score: true, accuracy: true, mistakes: true, time: true, streak: true, run: true };
  const before = { score: 900, accuracy: 80, fastestMs: 1, longestStreak: 1, fewestMistakes: 1, runs: 1 };
  assert.equal(isNewRecord(before, all), true);
  assert.equal(isNewRecord(null, all), false);   // a first run is a first record, not a new one
  assert.equal(isNewRecord(before, { ...all, run: false, score: false }), false);
  assert.equal(isNewRecord(before, { score: true, accuracy: false, mistakes: false, time: false, streak: false, run: false }), true);
  const { m, advance } = manager();
  assert.equal(m.play({ kind: 'record' }), true);
  advance(200);
  assert.equal(m.play({ kind: 'record' }), false);
});

test('blocked or missing audio is handled quietly', () => {
  // A context that starts suspended (autoplay rules) and refuses to resume: no throw, and resume is tried.
  const { m, f } = manager({ state: 'suspended' });
  assert.doesNotThrow(() => m.play({ kind: 'correct', streak: 1 }));
  assert.equal(f.resumes(), 1);
  // No Web Audio at all: play returns false, never throws, and is not retried on every click.
  let tries = 0;
  const none = new AudioManager({ create: () => { tries++; throw new Error('no AudioContext'); }, store: memory({ [SOUND_KEY]: 'on' }) });
  assert.equal(none.play({ kind: 'correct', streak: 1 }), false);
  assert.equal(none.play({ kind: 'ui' }), false);
  assert.equal(tries, 1);
});

test('one AudioContext is reused for every sound', () => {
  const { m, made, advance } = manager();
  for (let i = 0; i < 20; i++) { m.play({ kind: 'correct', streak: i }); advance(500); }
  assert.equal(made(), 1);
});

test('Mystery Country sounds: soft ticks for guesses, a chime when solved, all muted with sound off', () => {
  const far = recipe({ kind: 'probe', closer: false }), near = recipe({ kind: 'probe', closer: true });
  // Both ticks are short and much quieter than a correct answer; "closer" is only a little brighter.
  for (const r of [far, near]) {
    assert.ok(lengthOf(r) <= 0.12);
    assert.ok(Math.max(...r.notes.map(n => n.gain)) < peak({ kind: 'correct', streak: 1 }) * 0.5);
    assert.ok(r.notes.every(n => n.to === undefined));
  }
  assert.ok(near.notes[0].freq > far.notes[0].freq && near.notes[0].freq / far.notes[0].freq < 1.5);
  assert.ok(lengthOf(recipe({ kind: 'solved' })) <= 0.85);
  const { m, advance } = manager();
  assert.equal(m.play({ kind: 'probe', closer: true }), true);
  advance(50);
  assert.equal(m.play({ kind: 'probe', closer: false }), false);   // rapid clicks do not stack
  advance(COOLDOWN_MS.probe);
  assert.equal(m.play({ kind: 'solved' }), true);
  const off = manager({ on: false });
  assert.equal(off.m.play({ kind: 'solved' }), false);
  assert.equal(off.f.started.length, 0);
});
