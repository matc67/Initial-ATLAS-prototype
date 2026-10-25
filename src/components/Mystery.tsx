// Mystery Country screens: the HUD, the country search, the guess history and the results. None of them is given the
// answer while the puzzle is open, so none can show it.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Country } from '../data/countries';
import type { RosterEntry } from '../data/roster';
import { formatKm, heatColor, heatOf, historyOf, searchCountries, trendsOf, type MysteryGuess, type MysteryStats } from '../game/mystery';
import { formatTime } from '../game/scoring';
import { Flag, Icon } from './ui';

const heatSwatch = (km: number | null) => ({ background: heatColor(heatOf(km)) });

type HudProps = {
  setLabel: string; held: boolean; stats: MysteryStats; closestName: string | null;
  message: string; latest: { name: string; km: number | null; trend: string } | null;
  historyOpen: boolean; onToggleHistory: () => void;
  sound: boolean; onSound: () => void; onHold: (held: boolean) => void; onEnd: () => void;
};

// The top HUD: guesses, time and closest guess, and what the last guess told you.
export function MysteryHud(p: HudProps) {
  const { stats } = p;
  return <section className="hud mystery-hud">
    <div className="hud-top">
      <span className="hud-area"><Icon name="mystery" />Mystery Country · {p.setLabel}</span>
      <span className="hud-spacer" />
      <button className="icon-btn" data-silent aria-label={p.sound ? 'Mute sounds' : 'Turn sounds on'} aria-pressed={p.sound} onClick={p.onSound}><Icon name={p.sound ? 'sound' : 'mute'} /></button>
      <button className="icon-btn" aria-label={p.held ? 'Resume' : 'Pause'} onClick={() => p.onHold(!p.held)}><Icon name={p.held ? 'play-small' : 'pause'} /></button>
      <button className="close" aria-label="Leave this mystery" onClick={p.onEnd}>×</button>
    </div>
    <div className={p.held ? 'hud-readouts three held' : 'hud-readouts three'}>
      <button className="readout guesses" onClick={p.onToggleHistory} aria-expanded={p.historyOpen} aria-label={`Guesses ${stats.guesses}. Show history`}>
        <span>Guesses</span><strong>{stats.guesses}</strong>
      </button>
      <div className="readout time" role="timer" aria-label={`Time ${formatTime(stats.elapsedMs)}`}><span>Time</span><strong>{formatTime(stats.elapsedMs)}</strong></div>
      <div className="readout closest">
        <span>Closest guess</span>
        {stats.closest ? <strong><i className="swatch" style={heatSwatch(stats.closest.km)} />{formatKm(stats.closest.km)}</strong> : <strong className="none">—</strong>}
        {stats.closest && <small>{p.closestName}</small>}
      </div>
    </div>
    <div className="hud-line" aria-live="polite">
      {p.held ? <span className="hud-msg">Paused. <button className="link" onClick={() => p.onHold(false)}>Resume</button></span>
        : p.message ? <span className="hud-msg">{p.message}</span>
        : p.latest ? <span className="hud-msg latest"><i className="swatch" style={heatSwatch(p.latest.km)} /><b>{p.latest.name}</b> · {formatKm(p.latest.km)}{p.latest.trend && <em>{p.latest.trend}</em>}</span>
        : <span className="hud-msg">Click any country on the globe, or type one below.</span>}
    </div>
  </section>;
}

type SearchProps = { entries: RosterEntry[]; guessed: Map<string, number | null>; disabled: boolean; onGuess: (id: string) => void; onNoMatch: (text: string) => void };

// Type a country: suggestions as you type (names and aliases), arrow keys to choose, Enter to guess.
export function MysterySearch({ entries, guessed, disabled, onGuess, onNoMatch }: SearchProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const list = useMemo(() => searchCountries(text, entries, 6), [text, entries]);
  const id = useId();
  useEffect(() => setActive(0), [text]);
  const submit = (i = active) => {
    const s = list[i];
    if (!text.trim()) return;
    if (!s) { onNoMatch(text.trim()); return; }
    onGuess(s.entry.id);
    setText('');
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); setOpen(true); setActive(a => (a + 1) % list.length); }
    else if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); setActive(a => (a - 1 + list.length) % list.length); }
    else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { setText(''); setOpen(false); }
  };
  const show = open && list.length > 0 && !disabled;
  return <form className="answer-bar mystery-search" onSubmit={e => { e.preventDefault(); submit(); }}>
    {show && <ul className="suggestions" id={`${id}-list`} role="listbox">
      {list.map((s, i) => {
        const km = guessed.get(s.entry.id);
        return <li key={s.entry.id} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
          onMouseDown={e => { e.preventDefault(); submit(i); }} onMouseEnter={() => setActive(i)}>
          <Flag iso2={s.entry.iso2} />
          <span className="name">{s.entry.name}{s.alias && <small> ({s.alias})</small>}</span>
          <span className="meta">{guessed.has(s.entry.id) ? <>guessed · {formatKm(km ?? null)}</> : s.entry.continent}</span>
        </li>;
      })}
    </ul>}
    <input value={text} disabled={disabled} placeholder="Type a country…" aria-label="Guess a country by name" autoComplete="off" spellCheck={false}
      role="combobox" aria-expanded={show} aria-controls={`${id}-list`} aria-activedescendant={show ? `${id}-${active}` : undefined}
      onChange={e => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} />
    <button type="submit" aria-label="Guess" data-silent disabled={disabled}><Icon name="arrow" /></button>
  </form>;
}

type HistoryProps = {
  guesses: MysteryGuess[]; answer: string | null;   // the answer only once solved
  countries: Map<string, Country>; order: 'latest' | 'closest'; onOrder: (o: 'latest' | 'closest') => void;
  onFocus: (id: string) => void;
};

// Every guess with its distance and heat colour. Clicking one moves the globe to it; it never guesses again.
export function MysteryHistory({ guesses, answer, countries, order, onOrder, onFocus }: HistoryProps) {
  const trends = trendsOf({ guesses, answer: answer ?? '' });
  const rows = historyOf(guesses, order);
  const latest = guesses.length;
  return <div className="mystery-history">
    <div className="history-head">
      <span className="eyebrow">Guesses · {guesses.length}</span>
      {guesses.length > 1 && <div className="toggle" role="radiogroup" aria-label="Order">
        {(['latest', 'closest'] as const).map(o => <button key={o} role="radio" aria-checked={order === o} className={order === o ? 'on' : ''} onClick={() => onOrder(o)}>{o === 'latest' ? 'Latest' : 'Closest'}</button>)}
      </div>}
    </div>
    {guesses.length === 0 ? <p className="fine">Your guesses appear here, coloured like the globe: the redder, the closer.</p> : <ol className="guess-list">
      {rows.map(g => {
        const c = countries.get(g.id), solved = g.id === answer, t = trends[g.n - 1];
        return <li key={g.id} className={`${g.n === latest ? 'latest' : ''}${solved ? ' solved' : ''}`}>
          <button onClick={() => onFocus(g.id)} title={`Show ${c?.name ?? g.id} on the globe`}>
            <span className="n">{g.n}</span>
            <i className="swatch" style={solved ? undefined : heatSwatch(g.km)} />
            <span className="who"><Flag iso2={c?.iso2} />{c?.name ?? g.id}</span>
            <span className="km">{solved ? 'Found' : formatKm(g.km)}</span>
            {t === 'closest' && g.n > 1 && !solved && <em className="tag">closest yet</em>}
          </button>
        </li>;
      })}
    </ol>}
  </div>;
}

type ResultsProps = {
  answer: Country; stats: MysteryStats; closestName: string | null;
  first: boolean; record: boolean; best: { guesses: number; ms: number } | null;
  history: HistoryProps;
  onNext: () => void; onBack: () => void;
};

// Mystery solved: the country, the numbers, the guesses, and straight on to the next one.
export function MysteryResults(p: ResultsProps) {
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus({ preventScroll: true }), []);
  const { stats } = p;
  return <div className="mystery-results">
    <div className="eyebrow"><Icon name="mystery" /> Mystery solved!</div>
    <div className="solved-country"><Flag iso2={p.answer.iso2} size="lg" /><div><span>The country was</span><h1>{p.answer.name}</h1></div></div>
    {p.record && <div className="record">New personal best<span>Your fewest guesses yet{p.best ? `, beating ${p.best.guesses}` : ''}.</span></div>}
    {p.first && <div className="record first">First mystery solved<span>Now try it in fewer guesses.</span></div>}
    {stats.guesses === 1 && <div className="perfect">First guess!<span>Found it without a single clue.</span></div>}
    <div className="sprint-stats">
      <div><span>Guesses</span><strong>{stats.guesses}</strong><small>{p.best ? `Best ${p.best.guesses}` : '—'}</small></div>
      <div><span>Time</span><strong>{formatTime(stats.elapsedMs)}</strong><small>{p.best ? `Best run ${formatTime(p.best.ms)}` : '—'}</small></div>
      <div className="wide"><span>Closest wrong guess</span><strong>{stats.closest ? formatKm(stats.closest.km) : '—'}</strong><small>{p.closestName ?? 'None: solved first try'}</small></div>
    </div>
    <button ref={next} className="btn primary big" onClick={p.onNext}>Next mystery <kbd>Enter</kbd></button>
    <button className="btn" onClick={p.onBack}>Back to modes</button>
    <MysteryHistory {...p.history} />
  </div>;
}
