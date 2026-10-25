// Small pieces shared by the app's panels.
import { useEffect, useRef, useState } from 'react';
import { flagUrl } from '../data/flags';

// A country's flag. Until the image has loaded, and for good if it fails, the box shows the country's code instead of an
// empty rectangle. Decorative: the country's name always sits beside it. `quiz` (Flags mode, where the flag is the
// question) never shows the code, which would give the answer away: the box stays blank until the image arrives.
export function Flag({ iso2, size, quiz }: { iso2?: string; size?: 'lg' | 'xl'; quiz?: boolean }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  useEffect(() => setState('loading'), [iso2]);
  if (!iso2) return null;
  return <span className={`flag${size ? ` ${size}` : ''}${state === 'ok' ? '' : ' fallback'}`} aria-hidden="true">
    {!quiz && <b>{iso2.toUpperCase()}</b>}
    {state !== 'failed' && <img src={flagUrl(iso2)} alt="" draggable={false} onLoad={() => setState('ok')} onError={() => setState('failed')} />}
  </span>;
}

const ICONS = {
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 0c2.8 2.7 4.2 6 4.2 10S14.8 19.3 12 22m0-20C9.2 4.7 7.8 8 7.8 12s1.4 7.3 4.2 10M2.5 9h19M2.5 15h19',
  play: 'M6 9h4M8 7v4M15 10h.01M18 8h.01M7 4h10a5 5 0 0 1 5 5v4.5a3.5 3.5 0 0 1-6.3 2.1L14 14h-4l-1.7 1.6A3.5 3.5 0 0 1 2 13.5V9a5 5 0 0 1 5-5Z',
  bars: 'M5 20V11M12 20V4M19 20v-6',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.6-12.5a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4M12 17.5h.01',
  trophy: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Zm0 2H4a3 3 0 0 0 3 4m10-4h3a3 3 0 0 1-3 4',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  pause: 'M9 6v12M15 6v12',
  'play-small': 'M8 5.5v13l10-6.5-10-6.5Z',
  bolt: 'M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z',
  mystery: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.4-11.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7M12 16.9h.01',
  sound: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM16.5 9.5l5 5M21.5 9.5l-5 5',
};
export const Icon = ({ name }: { name: keyof typeof ICONS }) =>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// A number that eases to each new value over `ms` (ease-out), starting from `from`; with reduced motion it jumps at once.
export function useTween(target: number, ms = 500, from = target) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : from));
  const shown = useRef(value);
  useEffect(() => {
    const set = (v: number) => { shown.current = v; setValue(v); };
    if (reducedMotion() || shown.current === target) { set(target); return; }
    const start = performance.now(), a = shown.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      set(Math.round(a + (target - a) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}
