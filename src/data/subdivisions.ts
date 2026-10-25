// First-level subdivisions (provinces, states, territories…), built by `npm run admin1` into public/data/admin1/. Loaded
// only when a subdivision view opens: the index first, then one file per country, each fetched once and cached.
// See docs/subdivisions.md. Nothing here names a country.
import { feature, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { LngLat } from '../game/geo';
import type { AdminTerms } from './entities';
import type { Playable } from '../game/playable';

export type SubdivisionMeta = {
  enabled: boolean;
  file: string;
  count: number;                              // playable units: the challenges' size
  unitsVersion: string;                       // versionOf(unit ids): challenge record keys use it (subdivisionKey)
  kinds: { [kind: string]: number };
  terms: AdminTerms;
  bounds: [number, number, number, number];   // west, south, east, north; east > 180 across 180°
  frame: { center: LngLat; radiusKm: number };
  flags: string[];
  // Units drawn and named but never asked (Washington, DC), with the reason. Missing when there are none.
  others?: { id: string; name: string; kind: string; note: string }[];
};
export type SubdivisionIndex = {
  version: string; builtAt: string;
  source: { name: string; url: string; commit: string; licence: string };
  countryData: { file: string; sha256: string };
  countries: { [countryId: string]: SubdivisionMeta };
};
export type SubdivisionProps = {
  id: string; country: string; code: string; name: string; kind: string;
  aliases: string[]; abbrev?: string; label: LngLat; km2: number; color: number;
  frame: { center: LngLat; radiusKm: number };
  src: { ne: number[]; iso?: string; wikidata?: string };
  playable?: false;    // drawn and named, never asked in a challenge; `note` says why
  note?: string;
};
export type Subdivision = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, SubdivisionProps>;
export type SubdivisionSet = {
  countryId: string;
  meta: SubdivisionMeta;
  units: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, SubdivisionProps>;
  borders: GeoJSON.FeatureCollection<GeoJSON.MultiLineString>;   // internal borders only; coasts are the country layer's
  byId: Map<string, Subdivision>;
};

type Topo = Topology<{ units: GeometryCollection<SubdivisionProps>; borders: GeometryCollection }>;

// Decodes one country's file. Pure, so the data tests read files exactly as the app does.
export function decodeSubdivisions(countryId: string, meta: SubdivisionMeta, topo: Topo): SubdivisionSet {
  const units = feature(topo, topo.objects.units) as SubdivisionSet['units'];
  const borders = feature(topo, topo.objects.borders) as SubdivisionSet['borders'];
  return { countryId, meta, units, borders, byId: new Map(units.features.map(u => [u.properties.id, u])) };
}

// Which units touch each other, by index into the file's unit list (from the arcs they share).
export const neighboursOf = (topo: Topo) => neighbors(topo.objects.units.geometries as any);

// "10 provinces and 3 territories", from the counts and the country's own terms, in the profile's order.
export function describeCount(meta: Pick<SubdivisionMeta, 'kinds' | 'terms' | 'count'>): string {
  const kinds = meta.terms.kinds ?? [{ singular: meta.terms.singular, plural: meta.terms.plural }];
  const parts = kinds.flatMap(k => {
    const n = Object.entries(meta.kinds).find(([kind]) => kind.toLowerCase() === k.singular.toLowerCase())?.[1] ?? 0;
    return n ? [`${n} ${n === 1 ? k.singular : k.plural}`] : [];
  });
  if (!parts.length) return `${meta.count} ${meta.count === 1 ? meta.terms.singular : meta.terms.plural}`;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

const base = () => import.meta.env?.BASE_URL ?? '/';
let indexPending: Promise<SubdivisionIndex> | null = null;
export function loadSubdivisionIndex(): Promise<SubdivisionIndex> {
  indexPending ??= fetch(`${base()}data/admin1/index.json`).then(res => {
    if (!res.ok) throw new Error(`Could not load the subdivision index (${res.status}).`);
    return res.json();
  });
  indexPending.catch(() => { indexPending = null; });   // a failed load can be retried
  return indexPending;
}

const sets = new Map<string, Promise<SubdivisionSet>>();
// One country's subdivisions, or a rejection when it has none. Cached: opening the country again fetches nothing.
export function loadSubdivisions(countryId: string): Promise<SubdivisionSet> {
  let p = sets.get(countryId);
  if (!p) {
    p = loadSubdivisionIndex().then(async index => {
      const meta = index.countries[countryId];
      if (!meta) throw new Error(`No subdivisions for ${countryId}.`);
      const res = await fetch(`${base()}data/${meta.file}?v=${index.version}`);
      if (!res.ok) throw new Error(`Could not load ${meta.file} (${res.status}).`);
      return decodeSubdivisions(countryId, meta, await res.json());
    });
    p.catch(() => sets.delete(countryId));
    sets.set(countryId, p);
  }
  return p;
}

export const isPlayable = (u: Subdivision) => u.properties.playable !== false;
// The ids a country's challenges ask, in file order: every unit except those drawn but not played.
export const playableIds = (set: SubdivisionSet) => set.units.features.filter(isPlayable).map(u => u.properties.id);

// A country's subdivisions as round targets, by id. Units that are not played are never targets.
export function subdivisionPlayables(set: SubdivisionSet): Map<string, Playable> {
  return new Map(set.units.features.filter(isPlayable).map(u => [u.properties.id, {
    id: u.properties.id, name: u.properties.name, aliases: u.properties.aliases, center: u.properties.label, frame: u.properties.frame,
  }]));
}
