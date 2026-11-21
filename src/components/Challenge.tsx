// Challenge a friend, both sides: the share sheet (the result card, and the ways to send it) and, for the friend who
// opens the link, the invitation and, after their run, how they did against the target.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { challengeText, outcomeOf, type Challenge } from '../game/challengeLink';
import { shareMessage, type CardContent } from '../game/shareCard';
import { Icon } from './ui';

// Dialogs go to the top of the page: inside a panel, `position: fixed` is relative to the panel (its backdrop-filter makes
// it the containing block), which would trap the sheet in it.
const top = (node: ReactNode) => createPortal(node, document.querySelector('.app') ?? document.body);

// ---- The share sheet ----------------------------------------------------------------------------------------------------------------
export type MadeCard = { blob: Blob; alt: string; content: CardContent };
type SheetProps = { make: () => Promise<MadeCard>; link: string; fileName: string; onClose: () => void };

// Phones share the image through their share sheet (with the text and link); computers save it. A link can always be
// copied. What is shared is the card and the link: the link carries the game and the score, never the answers.
export function ShareSheet({ make, link, fileName, onClose }: SheetProps) {
  const [card, setCard] = useState<{ url: string; file: File; alt: string; text: string } | 'failed' | null>(null);
  const [note, setNote] = useState('');
  const [showLink, setShowLink] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    let url = '', live = true;
    make().then(r => {
      if (!live) return;
      url = URL.createObjectURL(r.blob);
      setCard({ url, file: new File([r.blob], fileName, { type: r.blob.type }), alt: r.alt, text: shareMessage(r.content, link) });
    }, () => live && setCard('failed'));
    return () => { live = false; if (url) URL.revokeObjectURL(url); if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (card) dialog.current?.querySelector<HTMLElement>('.sheet-actions .btn')?.focus({ preventScroll: true }); }, [card]);

  const ready = card && card !== 'failed' ? card : null;
  const canShareFile = !!ready && typeof navigator.canShare === 'function' && navigator.canShare({ files: [ready.file] });
  const canShareText = typeof navigator.share === 'function';

  async function share() {
    if (!ready) return;
    try {
      if (canShareFile) await navigator.share({ files: [ready.file], text: ready.text });
      else await navigator.share({ title: 'ATLAS', text: ready.text.split('\n').slice(0, -1).join('\n'), url: link });
      setNote('');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setNote('Sharing did not work here. Save the image or copy the link instead.');
    }
  }
  function save() {
    if (!ready) return;
    const a = Object.assign(document.createElement('a'), { href: ready.url, download: fileName });
    a.click();
    setNote('Image saved.');
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setNote('Link copied. Paste it to a friend.'); }
    catch { setShowLink(true); setNote('Copy the link below.'); }
  }
  // Keeps Tab inside the dialog; Escape closes it.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...dialog.current!.querySelectorAll<HTMLElement>('button, input')].filter(el => !el.hasAttribute('disabled'));
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return top(<div className="sheet-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="card share-sheet" role="dialog" aria-modal="true" aria-labelledby="share-title" ref={dialog} onKeyDown={onKey}>
      <div className="card-head"><strong id="share-title">Challenge a friend</strong><button className="close" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="share-preview">
        {ready ? <img src={ready.url} alt={ready.alt} /> : card === 'failed'
          ? <p className="muted">The image could not be made in this browser. The link still works.</p>
          : <p className="muted" role="status">Drawing your card…</p>}
      </div>
      <div className="sheet-actions">
        {(canShareFile || canShareText) && <button className="btn primary" disabled={!ready} onClick={share}><Icon name="share" />Share</button>}
        <button className={canShareFile || canShareText ? 'btn' : 'btn primary'} disabled={!ready} onClick={save}>Save image</button>
        <button className="btn" onClick={copyLink}>Copy link</button>
      </div>
      {showLink && <input className="share-link" readOnly value={link} aria-label="Challenge link" onFocus={e => e.currentTarget.select()} autoFocus />}
      {note && <p className="fine" role="status">{note}</p>}
      <p className="fine">Your friend gets the same game with your score to beat. The link never includes your answers.</p>
    </div>
  </div>);
}

// ---- The friend's side ----------------------------------------------------------------------------------------------------------------
type InviteProps = { challenge: Challenge; place: string; note: string | null; unavailable: string | null; onAccept: () => void; onDismiss: () => void };

// Shown once when a challenge link opens ATLAS: what to beat, and one button to start the same game.
export function ChallengeInvite({ challenge, place, note, unavailable, onAccept, onDismiss }: InviteProps) {
  const { title, goal } = challengeText(challenge, place);
  return top(<div className="sheet-backdrop">
    <div className="card challenge-invite" role="dialog" aria-modal="true" aria-labelledby="invite-title" onKeyDown={e => { if (e.key === 'Escape') onDismiss(); }}>
      <div className="eyebrow">{challenge.kind === 'rush' && challenge.target === null ? 'A friend sent you a game' : 'You have been challenged'}</div>
      <h2 id="invite-title">{title}</h2>
      <p className="invite-goal">{goal}</p>
      {note && <p className="fine">{note}</p>}
      {unavailable
        ? <><p className="muted">{unavailable}</p><button className="btn primary" autoFocus onClick={onDismiss}>Play something else</button></>
        : <>
          <button className="btn primary big" autoFocus onClick={onAccept}>Accept the challenge</button>
          <button className="btn" onClick={onDismiss}>Not now</button>
        </>}
      <p className="fine">Your run counts like any other. Only the game and the score to beat came with the link.</p>
    </div>
  </div>);
}

// A broken link: said once, briefly, and the game goes on.
export function InvalidChallenge({ onDismiss }: { onDismiss: () => void }) {
  return <div className="update-note" role="alert">
    <p><strong>That challenge link does not work.</strong> It may have been cut short when it was copied. You can still play.</p>
    <div className="error-actions"><button className="btn small" autoFocus onClick={onDismiss}>OK</button></div>
  </div>;
}

// After the friend's run: against the target, in plain words. `comparable` false when the target was set on other data.
export function ChallengeOutcome({ challenge, result, comparable, format }: { challenge: Challenge; result: number; comparable: boolean; format: (n: number) => string }) {
  const o = outcomeOf(challenge, result);
  if (!o) return null;
  const target = challenge.target!;
  const fewer = challenge.kind === 'mystery';
  const line = o.verdict === 'beat' ? `Challenge beaten: ${format(result)} against ${format(target)}.`
    : o.verdict === 'tied' ? `Challenge matched: ${format(result)}, the same as your friend.`
    : fewer ? `${format(result)} against ${format(target)}: ${o.gap} guess${o.gap === 1 ? '' : 'es'} more than your friend.`
    : `${format(result)} against ${format(target)}: ${format(o.gap)} short.`;
  return <div className={`challenge-outcome ${o.verdict}`} role="status">
    <strong>{o.verdict === 'beat' ? 'You won the challenge' : o.verdict === 'tied' ? 'A tie' : 'Not this time'}</strong>
    <span>{line}</span>
    {!comparable && <small>Your friend played an earlier version of this game&rsquo;s data, so the two scores are not strictly comparable.</small>}
  </div>;
}
