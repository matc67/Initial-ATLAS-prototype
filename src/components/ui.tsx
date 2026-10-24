// Small pieces shared by the app's panels.
import { useEffect, useState } from 'react';
import { flagUrl } from '../data/flags';

// A country's flag. Until the image has loaded, and for good if it fails, the box shows the country's code instead of an
// empty rectangle. Decorative: the country's name always sits beside it.
export function Flag({ iso2, size }: { iso2?: string; size?: 'lg' }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  useEffect(() => setState('loading'), [iso2]);
  if (!iso2) return null;
  return <span className={`flag${size ? ` ${size}` : ''}${state === 'ok' ? '' : ' fallback'}`} aria-hidden="true">
    <b>{iso2.toUpperCase()}</b>
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
};
export const Icon = ({ name }: { name: keyof typeof ICONS }) =>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
