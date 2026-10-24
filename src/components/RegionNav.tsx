import type { RegionView } from '../map/regions';

// A compact strip of camera shortcuts (the Pacific in an Oceania round). Each moves the globe to a broad region holding
// several countries; it never points at the answer. Plain buttons, so mouse, touch and keyboard (Tab, Enter) all work.
export default function RegionNav({ label, views, active, onPick }: { label: string; views: RegionView[]; active: string | null; onPick: (v: RegionView) => void }) {
  return <nav className="region-nav" aria-label={label}>
    <span className="region-nav-label" aria-hidden="true">{label}</span>
    {views.map(v => <button key={v.id} className={v.id === active ? 'on' : ''} aria-pressed={v.id === active} title={v.title} aria-label={v.title} onClick={() => onPick(v)}>{v.label}</button>)}
  </nav>;
}
