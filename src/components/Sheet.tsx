// Phones: a game panel as a bottom sheet, so the globe stays the centre of the screen. Collapsed, it is one bar (what is
// chosen, a handle, sometimes a Start); expanded, the whole panel, scrolling inside a height that leaves the globe and
// the navigation visible, with its main button in a footer that never covers the options. Tap or swipe the bar to
// expand or collapse; a tap on the globe collapses it.
//
// On larger screens the sheet is not there at all: its wrappers are `display: contents` (style.css), so the panel lays
// out exactly as it always has, and the bar is hidden.
import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { Icon } from './ui';

// Sent by the globe (App) for a tap, not a drag: an expanded sheet steps aside.
export const MAP_TAP = 'atlas:map-tap';
export const PHONE = '(max-width: 760px)';

const matches = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
export function useMedia(q: string) {
  const [on, setOn] = useState(() => matches(q));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q), change = () => setOn(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, [q]);
  return on;
}

// The open state of one sheet; a tap on the globe closes it.
export function useSheet(initial: boolean) {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(MAP_TAP, close);
    return () => window.removeEventListener(MAP_TAP, close);
  }, []);
  return [open, setOpen] as const;
}

type Props = {
  open: boolean; onOpen: (open: boolean) => void;
  className: string; label: string;
  summary: ReactNode;        // the collapsed bar: what is chosen
  action?: ReactNode;        // a button on the collapsed bar (City Rush's Start)
  footer?: ReactNode;        // the main button, kept below the scrolling content
  children: ReactNode;
};

export function Sheet({ open, onOpen, className, label, summary, action, footer, children }: Props) {
  const phone = useMedia(PHONE);
  const drag = useRef<{ y: number; held: boolean } | null>(null);
  const swallow = useRef(false);
  // A swipe up opens, a swipe down closes; a tap (the click) toggles.
  const down = (e: PointerEvent) => { drag.current = { y: e.clientY, held: false }; };
  // Once it is clearly a drag, the bar keeps the pointer (touch does this by itself; a mouse does not), so the release
  // is seen wherever it happens. Not before: a tap must still click the toggle.
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (d && !d.held && Math.abs(e.clientY - d.y) > 10) { d.held = true; e.currentTarget.setPointerCapture?.(e.pointerId); }
  };
  const up = (e: PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 24) { swallow.current = true; onOpen(dy < 0); }
  };
  const click = () => { if (swallow.current) { swallow.current = false; return; } onOpen(!open); };
  const closed = phone && !open;
  return <aside className={`card panel sheet ${className}${open ? ' open' : ''}`} aria-label={label}>
    <div className="sheet-bar" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
      <button className="sheet-toggle" aria-expanded={open} aria-label={`${label}: ${open ? 'collapse' : 'expand'}`} onClick={click}>
        <span className="sheet-handle" aria-hidden="true" />
        <span className="sheet-summary">{summary}</span>
        <span className="sheet-chevron" aria-hidden="true"><Icon name="back" /></span>
      </button>
      {!open && action}
    </div>
    <div className="sheet-content" inert={closed || undefined} aria-hidden={closed || undefined}>
      <div className="sheet-scroll">
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  </aside>;
}
