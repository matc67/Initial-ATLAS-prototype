// Leaving a game that has progress to lose: one question, the same in every mode. Continue playing is the default (it
// has focus, and Escape picks it); Exit to menu ends the game with no result, no record and no answers shown.
import { useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

type Props = { title: string; detail: string; onStay: () => void; onExit: () => void };

export function ExitConfirm({ title, detail, onStay, onExit }: Props) {
  const box = useRef<HTMLDivElement>(null);
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onStay(); return; }
    if (e.key !== 'Tab') return;
    const items = [...box.current!.querySelectorAll<HTMLElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
  }
  return createPortal(<div className="sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onStay(); }}>
    <div className="card exit-confirm" role="alertdialog" aria-modal="true" aria-labelledby="exit-title" aria-describedby="exit-detail" ref={box} onKeyDown={onKey}>
      <h2 id="exit-title">{title}</h2>
      <p id="exit-detail">{detail}</p>
      <div className="exit-actions">
        <button className="btn primary" autoFocus onClick={onStay}>Continue playing</button>
        <button className="btn danger" onClick={onExit}>Exit to menu</button>
      </div>
    </div>
  </div>, document.querySelector('.app') ?? document.body);
}
