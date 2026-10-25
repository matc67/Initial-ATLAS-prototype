// Development only (Phase 2): inspect one country's subdivisions on the globe: hover and click units, check names, codes
// and kinds. Shown only in development builds; the real Explore integration replaces it (docs/subdivisions.md, Phase 4).
import type { Country } from '../data/countries';
import { describeCount, type SubdivisionSet } from '../data/subdivisions';
import { Flag } from './ui';

type Props = { country: Country; set: SubdivisionSet; selected: string | null; onSelect: (id: string | null) => void; onExit: () => void };

export default function SubdivisionInspector({ country, set, selected, onSelect, onExit }: Props) {
  const unit = selected ? set.byId.get(selected) : undefined;
  const units = [...set.units.features].sort((a, b) => a.properties.kind.localeCompare(b.properties.kind) || a.properties.name.localeCompare(b.properties.name));
  return <div className="sub-inspector">
    <div className="eyebrow">Development preview · subdivisions</div>
    <div className="card-head"><h1 className="with-flag"><Flag iso2={country.iso2} size="lg" />{country.name}</h1><button className="close" aria-label="Back to the country" onClick={onExit}>×</button></div>
    <p className="muted">{describeCount(set.meta)}. Hover or click a {set.meta.terms.singular} on the globe.</p>
    {unit ? <dl className="facts">
      <div><dt>Name</dt><dd>{unit.properties.name}</dd></div>
      <div><dt>Kind</dt><dd>{unit.properties.kind}</dd></div>
      <div><dt>Id</dt><dd><code>{unit.properties.id}</code></dd></div>
      {unit.properties.src.iso && <div><dt>ISO 3166-2</dt><dd>{unit.properties.src.iso}</dd></div>}
      <div><dt>Area</dt><dd>{unit.properties.km2.toLocaleString()} km²</dd></div>
      {unit.properties.aliases.length > 0 && <div><dt>Also accepted</dt><dd>{unit.properties.aliases.join(', ')}</dd></div>}
    </dl> : <p className="fine">Nothing selected.</p>}
    <ul className="sub-list">{units.map(u => <li key={u.properties.id}>
      <button className={u.properties.id === selected ? 'on' : ''} onClick={() => onSelect(u.properties.id === selected ? null : u.properties.id)}>
        <span>{u.properties.name}</span><small>{u.properties.kind} · {u.properties.code}</small>
      </button>
    </li>)}</ul>
    {set.meta.flags.length > 0 && <div className="fine">Build flags: {set.meta.flags.join(' · ')}</div>}
    <button className="btn" onClick={onExit}>Back to {country.name}</button>
  </div>;
}
