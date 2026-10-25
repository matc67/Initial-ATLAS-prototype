// Regions (first-level subdivisions) in Explore: the block in a country's panel, the regions view of that country, and
// the play actions they share. Every label comes from the country's own terms ("provinces and territories").
import { useState } from 'react';
import type { Country } from '../data/countries';
import { describeCount, type SubdivisionMeta, type SubdivisionSet } from '../data/subdivisions';
import { SPRINT_SIZE, subdivisionKinds, type ChallengeKind, type GameMode } from '../game/challenges';
import type { PerformanceStore } from '../game/records';
import { regionRecords, type RegionRecord } from '../game/regionRecords';
import { formatTime } from '../game/scoring';
import { Flag, Icon } from './ui';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const bestLine = (r?: RegionRecord) => {
  const p = r?.performance;
  return p ? `Best ${p.bestScore.toLocaleString()} / ${r!.maxScore.toLocaleString()} · ${Math.round(p.bestAccuracy)}% · ${formatTime(p.fastestMs)}` : 'Not played yet';
};

type PlayProps = { countryId: string; meta: SubdivisionMeta; records: PerformanceStore; onPlay: (mode: GameMode, kind: ChallengeKind) => void };

// Find the Region and Name the Region, as a 10-question Sprint or with every region. A country with fewer than
// SPRINT_SIZE regions has only "All", so no choice is shown.
export function RegionPlay({ countryId, meta, records, onPlay }: PlayProps) {
  const kinds = subdivisionKinds(meta.count);
  const [kind, setKind] = useState<ChallengeKind>(kinds[0]);
  const rows = regionRecords(records, countryId, meta);
  const row = (mode: GameMode) => rows.find(r => r.mode === mode && r.kind === kind);
  return <div className="region-play">
    {kinds.length > 1 && <div className="toggle" role="radiogroup" aria-label="Length">
      {kinds.map(k => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
        {k === 'sprint' ? <><Icon name="bolt" />{SPRINT_SIZE}-question Sprint</> : `All ${meta.count}`}
      </button>)}
    </div>}
    {(['find', 'name'] as const).map(mode => <button key={mode} className="region-mode" onClick={() => onPlay(mode, kind)}>
      <span className="region-mode-icon"><Icon name={mode === 'find' ? 'globe' : 'play'} /></span>
      <span className="region-mode-body">
        <strong>{mode === 'find' ? 'Find the Region' : 'Name the Region'}</strong>
        <span>{mode === 'find' ? `We name a ${meta.terms.singular}; you click it.` : `A ${meta.terms.singular} lights up; you type its name.`}</span>
        <em>{bestLine(row(mode))}</em>
      </span>
    </button>)}
  </div>;
}

type BlockProps = { country: Country; meta: SubdivisionMeta | null; state: 'loading' | 'unavailable' | 'ready'; records: PerformanceStore; onShow: () => void; onPlay: PlayProps['onPlay'] };

// The regions block in a country's Explore panel: what it has, a way to see them, and the two games. A country without
// region data gets one quiet line instead of a broken or empty game.
export function CountryRegions({ country, meta, state, records, onShow, onPlay }: BlockProps) {
  if (state === 'loading') return null;
  if (state === 'unavailable' || !meta) return <p className="fine regions-unavailable">Regions of {country.name} are not available yet.</p>;
  return <div className="country-regions">
    <div className="regions-head">
      <span className="eyebrow">{cap(meta.terms.plural)}</span>
      <button className="link" onClick={onShow}>Show on the globe</button>
    </div>
    <p className="muted">{describeCount(meta)}</p>
    <RegionPlay countryId={country.id} meta={meta} records={records} onPlay={onPlay} />
  </div>;
}

// A one-line shortcut under a country's name, so its regions are one tap away even when the panel is a short sheet on a
// phone. Opens the regions view, where the games are at the top.
export function RegionsShortcut({ meta, onShow }: { meta: SubdivisionMeta; onShow: () => void }) {
  return <button className="regions-chip" onClick={onShow}>
    <Icon name="globe" /><span>{describeCount(meta)}</span><b>Explore and play<Icon name="arrow" /></b>
  </button>;
}

type PanelProps = {
  country: Country; set: SubdivisionSet; selected: string | null;
  onSelect: (id: string | null, toggle?: boolean) => void; onBack: () => void; onWorld: () => void;
  records: PerformanceStore; onPlay: PlayProps['onPlay'];
};

// A country's regions view: the regions on the globe, names on hover or click, a list, and the games.
export function RegionsPanel({ country, set, selected, onSelect, onBack, onWorld, records, onPlay }: PanelProps) {
  const unit = selected ? set.byId.get(selected) : undefined;
  const units = [...set.units.features].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  return <div className="regions-panel">
    <div className="regions-nav">
      <button className="link back" onClick={onBack}><Icon name="arrow" />{country.name}</button>
      <button className="link" onClick={onWorld}>World view</button>
    </div>
    <h1 className="with-flag"><Flag iso2={country.iso2} size="lg" />{cap(set.meta.terms.plural)}</h1>
    <p className="muted">{describeCount(set.meta)} in {country.name}. Hover or tap one to see its name.</p>
    {unit ? <div className="region-selected" aria-live="polite">
      <strong>{unit.properties.name}</strong><span>{unit.properties.kind}{unit.properties.aliases.length > 0 && ` · also ${unit.properties.aliases.join(', ')}`}</span>
      {import.meta.env.DEV && <small><code>{unit.properties.id}</code>{unit.properties.src.iso && ` · ${unit.properties.src.iso}`} · {unit.properties.km2.toLocaleString()} km²</small>}
    </div> : null}
    <RegionPlay countryId={set.countryId} meta={set.meta} records={records} onPlay={onPlay} />
    <span className="eyebrow">All {set.meta.terms.plural}</span>
    <ul className="sub-list" aria-label={cap(set.meta.terms.plural)}>{units.map(u => <li key={u.properties.id}>
      <button className={u.properties.id === selected ? 'on' : ''} aria-pressed={u.properties.id === selected} onClick={() => onSelect(u.properties.id, true)}>
        <span>{u.properties.name}</span><small>{u.properties.kind}</small>
      </button>
    </li>)}</ul>
    {import.meta.env.DEV && set.meta.flags.length > 0 && <div className="fine">Build flags: {set.meta.flags.join(' · ')}</div>}
  </div>;
}
