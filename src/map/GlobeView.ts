import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { distanceKm, type LngLat } from '../game/geo';
import { HEAT_STOPS } from '../game/mystery';
import { isletsOf, outlinesOf } from './outlines';
import { markerActive, reachFor, resolvePick, resolveSubPick, ringRadiusAt } from './pick';

// Round states: `found` = completed this round, `answer` = shown after the last miss, `target` = the country to name.
// Progress states, from one recorded run: `first` = correct first try, `retry` = needed more attempts, `hinted` = Show me.
// Mystery Country: `heat` = a wrong guess, coloured by its `heat` feature-state (see setHeat); `solved` = the answer, once found.
export type Status = 'target' | 'answer' | 'found' | 'missed' | 'selected' | 'first' | 'retry' | 'hinted' | 'heat' | 'solved';
export type StatusMap = { [id: string]: Status };
export type Camera = { center: LngLat; zoom: number };
export type Padding = { left: number; right: number; top: number; bottom: number };
// `explore`: every country in full colour. `play`: muted until found. `progress`: dark neutral unless the run attempted it.
// `mystery`: one neutral blue-grey (two close tones, so neighbours stay readable) until guessed. No country colour can
// be mistaken for heat, and the answer looks exactly like every other unguessed country.
export type Theme = 'explore' | 'play' | 'progress' | 'mystery';

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

// Design tokens shared with style.css (see :root there).
export const COLORS = {
  ocean: '#050f24',
  inactive: '#17263d',     // land outside the chosen region, and land that is not one of the 200 countries
  inactiveAlt: '#1f3048',  // its slight variation, so neighbouring inactive countries stay readable
  inactiveBorder: 'rgba(125, 154, 191, 0.22)',
  // Every country found in a round turns this one colour, whatever its own colour was. Change it here only
  // (style.css --completed matches it for the Help key). Bright enough to read on dark relief and small islands.
  completed: '#638db8',
  completedLine: 'rgba(226, 238, 255, 0.75)',  // its border, a little brighter than other borders
  completedRing: '#dbe9f9',                    // ring and halo outline of a completed tiny country
  gold: '#ffcf5c',
  missed: '#5a2333',
  missedLine: '#ff7d7d',
  good: '#4ade80',
  bad: '#ff6b6b',
  // Progress view, colouring one recorded run. `none`: not attempted in that run.
  progress: { first: '#438ff0', retry: '#e5a34c', hinted: '#a969d8', none: '#34415a' },
  // One colour per Natural Earth MAPCOLOR7 class (1-7). MAPCOLOR7 never gives two bordering countries the same class,
  // so neighbours always differ, and a country keeps the same colour in every region.
  country: ['#3982f6', '#ef5350', '#25b96a', '#f2b544', '#9a5ce0', '#21a99f', '#f97316'],
};
const NAVY = '#0b1a33';
// Shared by country, halo and ring layers; falls back to the inactive colour for land without a class.
const palette = (colors: string[]): ExpressionSpecification =>
  ['match', ['get', 'color'], ...colors.flatMap((c, i) => [i + 1, c]), COLORS.inactive] as unknown as ExpressionSpecification;
// Full colour (active region), muted (in a round, not yet found) and lifted (muted country under the cursor).
const vivid = palette(COLORS.country), muted = palette(COLORS.country.map(c => mix(c, NAVY, 0.38))), lifted = palette(COLORS.country.map(c => mix(c, NAVY, 0.18)));
const inactive = ['match', ['%', ['get', 'color'], 2], 0, COLORS.inactiveAlt, COLORS.inactive] as unknown as ExpressionSpecification;

const DATA = `${import.meta.env.BASE_URL}data`;
const status = ['coalesce', ['feature-state', 'status'], ''] as ExpressionSpecification;
const hovered = ['boolean', ['feature-state', 'hover'], false] as ExpressionSpecification;
const dimmed = ['boolean', ['feature-state', 'dim'], false] as ExpressionSpecification;
const focused = ['boolean', ['feature-state', 'focus'], false] as ExpressionSpecification;
// Mystery Country heat, 0 (far) to 1 (touching), interpolated continuously through the same stops as heatColor().
const heat = ['interpolate', ['linear'], ['coalesce', ['feature-state', 'heat'], 0], ...HEAT_STOPS.flat()] as unknown as ExpressionSpecification;
const MYSTERY_LAND = ['#3a4a63', '#34435b'];

// Colour of an active country (or its halo / ring) from its status, the theme and hover.
function activeColor(theme: Theme): ExpressionSpecification {
  const mysteryLand = ['match', ['%', ['get', 'color'], 2], 0, MYSTERY_LAND[0], MYSTERY_LAND[1]];
  const resting = theme === 'explore' ? vivid : theme === 'play' ? ['case', hovered, lifted, muted]
    : theme === 'mystery' ? ['case', hovered, mix(MYSTERY_LAND[0], '#ffffff', 0.14), mysteryLand]
    : ['case', hovered, mix(COLORS.progress.none, '#ffffff', 0.12), COLORS.progress.none];
  const lift = (c: string) => ['case', hovered, mix(c, '#ffffff', 0.15), c];
  return ['match', status,
    'found', COLORS.completed,
    'selected', vivid,
    ['answer', 'target'], COLORS.gold,
    'missed', COLORS.missed,
    'first', lift(COLORS.progress.first),
    'retry', lift(COLORS.progress.retry),
    'hinted', lift(COLORS.progress.hinted),
    'heat', heat,
    'solved', COLORS.good,
    resting,
  ] as unknown as ExpressionSpecification;
}
// Inactive land: neutral blue-gray. A country selected in Explore outside the region still shows its own colour.
const baseColor = ['match', status, 'selected', vivid, ['case', hovered, '#2a3d58', inactive]] as unknown as ExpressionSpecification;
// A subdivision's fill: the same rules as an active country (found, missed, answer, target, muted in a round), plus the
// selected and hovered lift that Explore uses for inspecting units.
const subFill = (theme: Theme): ExpressionSpecification => {
  const brighter = (t: number) => palette(COLORS.country.map(c => mix(c, '#ffffff', t)));
  return ['case', selectedSub, brighter(0.3), ['all', ['==', status, ''], hovered, theme === 'explore'], brighter(0.14), activeColor(theme)] as unknown as ExpressionSpecification;
};
// Ring markers read like their country: active colour inside the region, neutral outside.
const ringColor = (theme: Theme): ExpressionSpecification => ['case', dimmed, inactive, activeColor(theme)] as unknown as ExpressionSpecification;
// `focus` outlines the country opened in Progress without changing its run colour.
const strongLine = ['case', focused, '#fff6dc', ['match', status,
  ['selected', 'target', 'answer'], '#fff6dc',
  'rgba(0, 0, 0, 0)']] as unknown as ExpressionSpecification;
// Ring markers show at world zoom and fade out once the real shape is big enough to click (see markerActive in pick.ts).
const markerFade = (max: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 4.2, max, 6.5, 0];

const OCEANS: [string, LngLat][] = [['Pacific Ocean', [-150, 8]], ['Pacific Ocean', [165, 22]], ['Atlantic Ocean', [-38, 22]], ['Atlantic Ocean', [-20, -25]], ['Indian Ocean', [78, -22]], ['Southern Ocean', [40, -62]], ['Arctic Ocean', [-10, 84]]];
const SOURCES = ['countries', 'outlines', 'islets', 'halos', 'markers'] as const;
// Halos are invisible click areas; rings are found by screen distance (see pick.ts), so only these layers are queried.
const PICK_LAYERS = ['halo-hit', 'country-base', 'land-edge-base'];
const isLandLayer = (id: string) => id === 'country-base' || id === 'land-edge-base';
const FLASH_LAYERS = ['flash-line', 'flash-ring', 'sub-flash'];
// Borders: a muted blue-grey that reads against the ocean without outshining the land.
const BORDER = 'rgba(172, 196, 228, 0.5)';
// Coastline width for the land-edge layers: the land's own colour, drawn along its outline (see load()).
// Islands below this area get the land-edge trace: about 3 × 3 pixels at the zoom of a World round.
const ISLET_KM2 = 3000;
// Subdivision layers, all empty until a subdivision view opens (see showSubdivisions).
const SUB_SOURCES = ['sub-units', 'sub-islets'] as const;
const SUB_PICK = ['sub-fill', 'sub-edge'];
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const selectedSub = ['boolean', ['feature-state', 'selected'], false] as ExpressionSpecification;
// [west, south, east, north] of a geometry's points (a subdivision's extent; units across 180° are not expected).
function boxOf(g: GeoJSON.Geometry): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') { const [x, y] = c as number[]; w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } else if (Array.isArray(c)) c.forEach(walk); };
  if ('coordinates' in g) walk(g.coordinates);
  return [w, s, e, n];
}
const LAND_EDGE = ['interpolate', ['linear'], ['zoom'], 1, 1.1, 4, 0.9, 7, 0.6] as ExpressionSpecification;
// Region fades: each country carries an `act` feature-state from 0 (neutral land) to 1 (full colour) that is animated per
// country. Layers and their filters never change, so a region switch never makes MapLibre rebuild its tiles.
const FADE_MS = 450;
// How long an answer pulse stays on the map; its animation (style.css .answer-pulse) ends a little before.
const PULSE_MS = 800;
const act = ['coalesce', ['feature-state', 'act'], 0] as ExpressionSpecification;
const RELIEF_BOUNDS: [[number, number], [number, number], [number, number], [number, number]] = [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]];

// Land that is not one of the 195 playable countries (Greenland, Puerto Rico, Western Sahara, Antarctica…).
export type Land = { id: string; name: string; sovereign: string; kind: string };

export type GlobeEvents = {
  // `id` is the playable country clicked; `land` is set instead when the click hit non-playable land. `ambiguous` lists
  // the countries when the click sat between rings too close to tell apart (then `id` is null).
  onPick: (id: string | null, at: LngLat, land?: Land, ambiguous?: string[]) => void;
  onHover: (id: string | null) => void;
  // Subdivisions (see showSubdivisions): a click or hover on a unit of the country on view. Clicks elsewhere still go to
  // onPick, so the rest of the globe works as usual.
  // `ambiguous` lists the units in reach when a click on water was near more than one (then `id` is null).
  onSubPick?: (id: string | null, at: LngLat, ambiguous?: string[]) => void;
  onSubHover?: (id: string | null) => void;
};
// What showSubdivisions draws: one country's units (polygons with `id` and `color` properties) and its internal borders.
// Coasts and international borders stay the country layer's, so they never change.
export type SubdivisionLayerData = { units: GeoJSON.FeatureCollection; borders: GeoJSON.FeatureCollection };

export class GlobeView {
  readonly map: MapLibreMap;
  private statuses: StatusMap = {};
  private dimmed = new Set<string>();
  private hoverId: string | null = null;
  private theme: Theme = 'explore';
  private ready: Promise<void>;
  private flashFrame = 0;
  private fadeFrame = 0;
  private act = new Map<string, number>();
  private playable: string[] = [];
  private loaded = false;
  private pendingDim: Set<string> | null = null;
  private padding: Padding = { left: 0, right: 0, top: 0, bottom: 0 };
  private flightTarget: Camera | null = null;
  private focusId: string | null = null;
  private cities: { el: HTMLElement; at: LngLat; marker: maplibregl.Marker }[] = [];
  private pulses = new Set<{ marker: maplibregl.Marker; timer: ReturnType<typeof setTimeout> }>();
  private rings: { id: string; at: LngLat }[] = [];
  private small = new Set<string>();
  // How far from a ring a click still counts for it: wider for touch (see pick.ts).
  private reach = reachFor(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

  constructor(container: HTMLElement, private events: GlobeEvents, private fx: { glow: HTMLElement; shade: HTMLElement }) {
    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        projection: { type: 'globe' },
        sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
        // Light from the viewer's side, so the atmosphere glows evenly around the rim instead of on one edge.
        light: { anchor: 'viewport', position: [1.5, 0, 0] },
        sources: {},
        layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': COLORS.ocean } }],
      },
      center: [-20, 22],
      zoom: 1.9,
      minZoom: 1,
      maxZoom: 8,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.ready = new Promise(resolve => this.map.once('load', () => resolve()));
    const labels = OCEANS.map(([name, at]) => {
      const el = document.createElement('div');
      el.className = 'ocean-label';
      el.textContent = name;
      new maplibregl.Marker({ element: el }).setLngLat(at).addTo(this.map);
      return { el, at };
    });
    // HTML markers are not hidden behind the globe, so hide labels more than 70° from the view centre.
    const onMove = () => {
      const c = this.map.getCenter();
      for (const { el, at } of [...labels, ...this.cities]) el.style.visibility = distanceKm([c.lng, c.lat], at) > 7800 ? 'hidden' : 'visible';
      this.placeFx();
    };
    this.map.on('move', onMove);
    this.map.on('resize', onMove);
    onMove();
  }

  // Positions the CSS atmosphere glow and sphere shading over the globe's outline on screen.
  // The sphere's radius is worldSize / 2π / cos(centre latitude) pixels (getGlobeRadiusPixels in maplibre-gl), seen by a
  // perspective camera `dc` pixels above the centre point, so its outline is dc·tan(asin(R / (R + dc))) pixels wide.
  private placeFx() {
    const c = this.map.getCenter(), p = this.map.project(c);
    const R = (512 * 2 ** this.map.getZoom()) / (2 * Math.PI) / Math.cos((c.lat * Math.PI) / 180);
    const dc = this.map.transform.cameraToCenterDistance;
    const r = (dc * R) / Math.sqrt((R + dc) ** 2 - R ** 2);
    const show = r < 2600;
    for (const [el, scale] of [[this.fx.glow, 1.3], [this.fx.shade, 1]] as const) {
      el.style.display = show ? 'block' : 'none';
      if (!show) continue;
      const d = 2 * r * scale;
      el.style.width = el.style.height = `${d}px`;
      el.style.transform = `translate(${p.x - d / 2}px, ${p.y - d / 2}px)`;
    }
    this.fx.shade.style.setProperty('--rim', `${Math.max(8, r * 0.07)}px`);
  }

  // Resolves with the country shapes and the ids of countries small enough to carry a ring marker.
  async load(): Promise<{ countries: GeoJSON.FeatureCollection; tiny: Set<string> }> {
    await this.ready;
    const get = async <T,>(file: string): Promise<T> => {
      const res = await fetch(`${DATA}/${file}`);
      if (!res.ok) throw new Error(`Could not load ${file} (${res.status}).`);
      return res.json();
    };
    const [topo, halos, markers] = await Promise.all([
      get<Topology<{ countries: GeometryCollection }>>('countries.topo.json'),
      get<GeoJSON.FeatureCollection>('halos.geojson'),
      get<GeoJSON.FeatureCollection>('markers.geojson'),
    ]);
    // Borders are shipped as TopoJSON (each shared border stored once) and expanded to GeoJSON here.
    const countries = feature(topo, topo.objects.countries) as GeoJSON.FeatureCollection;
    const map = this.map;
    map.addSource('countries', { type: 'geojson', data: countries, promoteId: 'id' });
    // Borders come from their own source: the shapes' outlines without the 180° and pole cuts (see outlines.ts).
    map.addSource('outlines', { type: 'geojson', data: outlinesOf(countries), promoteId: 'id' });
    map.addSource('islets', { type: 'geojson', data: isletsOf(countries, ISLET_KM2), promoteId: 'id' });
    map.addSource('halos', { type: 'geojson', data: halos, promoteId: 'id' });
    map.addSource('markers', { type: 'geojson', data: markers, promoteId: 'id' });
    const none = ['==', ['get', 'id'], ''] as ExpressionSpecification;
    const lineWidth = (a: number, b: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 1, a, 5, b];

    // Neutral land everywhere, with the active region's colours faded in above it per country (see fadeTo).
    map.addLayer({ id: 'country-base', type: 'fill', source: 'countries', paint: { 'fill-color': baseColor, 'fill-opacity': 0.97 } });
    map.addLayer({ id: 'country-active', type: 'fill', source: 'countries', paint: { 'fill-color': activeColor(this.theme), 'fill-opacity': ['*', 0.97, act] } });
    // Small islands traced along their coastline in their own colour. A WebGL fill only covers pixels whose centre lies
    // inside the shape, so an island smaller than a pixel (most of Tuvalu, Kiribati or the Maldives at globe zoom) draws
    // nothing at all; a line is always at least LAND_EDGE wide, so every island in the data shows as land, in the right
    // colour, and takes clicks. It follows the real outline, and only islands under ISLET_KM2 get it.
    map.addLayer({ id: 'land-edge-base', type: 'line', source: 'islets', layout: { 'line-join': 'round' }, paint: { 'line-color': baseColor, 'line-width': LAND_EDGE, 'line-opacity': 0.97 } });
    map.addLayer({ id: 'land-edge-active', type: 'line', source: 'islets', layout: { 'line-join': 'round' }, paint: { 'line-color': activeColor(this.theme), 'line-width': LAND_EDGE, 'line-opacity': ['*', 0.97, act] } });
    // Shaded relief from Natural Earth, pre-converted to a transparent light/shadow overlay (scripts/build-relief.ts).
    // It fades out before the 2048-pixel texture turns blurry when zoomed in.
    map.addSource('relief', { type: 'image', url: `${DATA}/relief.webp`, coordinates: RELIEF_BOUNDS });
    map.addLayer({ id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 3.5, 0.55, 5, 0], 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
    map.addLayer({ id: 'country-line', type: 'line', source: 'outlines', paint: {
      // Heat colours are pale to deep red, so their borders are dark to stay visible on them.
      'line-color': ['case', ['==', ['get', 'playable'], 0], COLORS.inactiveBorder, dimmed, COLORS.inactiveBorder, ['==', status, 'found'], COLORS.completedLine, ['==', status, 'heat'], 'rgba(48, 10, 20, 0.6)', BORDER],
      'line-width': lineWidth(0.45, 1.1),
    } });
    // Drawn above the shared borders so a status outline is never painted over by a neighbour.
    map.addLayer({ id: 'focus-line', type: 'line', source: 'outlines', layout: { 'line-join': 'round' }, paint: { 'line-color': strongLine, 'line-width': lineWidth(1.2, 2.2) } });
    map.addLayer({ id: 'missed-line', type: 'line', source: 'outlines', paint: { 'line-color': COLORS.missedLine, 'line-width': lineWidth(1, 1.8), 'line-dasharray': [2, 1.5], 'line-opacity': ['match', status, 'missed', 1, 0] } });
    // Halos: an invisible click area around an island country's islands. Never drawn: a visible outline around open ocean
    // reads as a hollow island, and it outshone the islands themselves.
    map.addLayer({ id: 'halo-hit', type: 'fill', source: 'halos', paint: { 'fill-color': '#000', 'fill-opacity': 0 } });
    map.addLayer({ id: 'marker-ring', type: 'circle', source: 'markers', maxzoom: 7, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5.5, 5, 8],
      'circle-color': ringColor(this.theme), 'circle-opacity': markerFade(0.45),
      'circle-stroke-color': ['match', status, 'found', COLORS.completedRing, 'selected', '#ffffff', ['answer', 'target'], COLORS.gold, 'missed', COLORS.missedLine, 'solved', COLORS.good, 'heat', '#ffe4e7', ['case', dimmed, '#3a4b6b', '#dbe8ff']],
      'circle-stroke-width': ['case', hovered, 2.2, 1.4], 'circle-stroke-opacity': markerFade(1),
    } });
    // One-off pulses for a correct answer or a wrong click; see flash(). Kept crisp: a thin line with little blur.
    map.addLayer({ id: 'flash-line', type: 'line', source: 'outlines', filter: none, layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 0, 'line-blur': 0.6, 'line-opacity': 0 } });
    map.addLayer({ id: 'flash-ring', type: 'circle', source: 'markers', filter: none, paint: { 'circle-radius': 8, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0 } });

    this.addSubdivisionLayers();
    map.on('click', e => {
      const at: LngLat = [e.lngLat.lng, e.lngLat.lat], sub = this.subPick(e.point);
      if (sub && this.events.onSubPick) { this.events.onSubPick(sub.id, at, sub.ambiguous); return; }
      const { id, land, ambiguous } = this.pickAt(e.point);
      this.events.onPick(id, at, land, ambiguous);
    });
    map.on('mousemove', e => {
      const sub = this.subAt(e.point);
      this.setSubHover(sub);
      if (sub) { map.getCanvas().style.cursor = 'pointer'; this.setHover(null); return; }
      const { id } = this.pickAt(e.point);
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      this.setHover(id);
    });
    map.on('mouseout', () => { this.setHover(null); this.setSubHover(null); });
    this.playable = countries.features.filter(f => f.properties?.playable === 1).map(f => String(f.properties!.id));
    this.rings = markers.features.map(f => ({ id: String(f.properties?.id), at: (f.geometry as GeoJSON.Point).coordinates as LngLat }));
    this.small = new Set([...this.rings.map(r => r.id), ...halos.features.map(f => String(f.properties?.id))]);
    this.loaded = true;
    if (this.pendingDim) this.setDimmed(this.pendingDim);
    return { countries, tiny: new Set(markers.features.map(f => String(f.properties?.id))) };
  }

  // ---- Subdivisions -------------------------------------------------------------------------------------------------
  // One country's first-level subdivisions, drawn over its country fill: fills in the country palette (neighbours never
  // share a colour), coastline traces for small islands, internal borders, and an outline for the hovered or selected
  // unit. Generic: the data says everything. Sources stay empty (and cost nothing) until a view opens; one country at a
  // time, replaced with setData, so the style never grows.
  private subIds: string[] = [];
  private subHoverId: string | null = null;
  private subSelectedId: string | null = null;
  private addSubdivisionLayers() {
    const map = this.map;
    for (const id of SUB_SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY, promoteId: 'id' });
    map.addSource('sub-borders', { type: 'geojson', data: EMPTY });
    const fill = subFill(this.theme);
    // Fills under the relief (so the globe keeps its shading) and above the country fills they replace.
    map.addLayer({ id: 'sub-fill', type: 'fill', source: 'sub-units', paint: { 'fill-color': fill, 'fill-opacity': 0.97 } }, 'relief');
    map.addLayer({ id: 'sub-edge', type: 'line', source: 'sub-islets', layout: { 'line-join': 'round' }, paint: { 'line-color': fill, 'line-width': LAND_EDGE, 'line-opacity': 0.97 } }, 'relief');
    // Internal borders, a little lighter than country borders; coasts and international borders stay the country layer's.
    map.addLayer({ id: 'sub-border', type: 'line', source: 'sub-borders', layout: { 'line-join': 'round' }, paint: {
      'line-color': 'rgba(240, 246, 255, 0.62)', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 5, 1.2],
    } }, 'country-line');
    // The selected or hovered unit (Explore); in a round, the answer shown in gold and the unit missed with Show me.
    map.addLayer({ id: 'sub-outline', type: 'line', source: 'sub-units', layout: { 'line-join': 'round' }, paint: {
      'line-color': ['match', status, ['answer', 'target'], COLORS.gold, 'missed', COLORS.missedLine, '#fff6dc'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 5, 2.4],
      'line-opacity': ['case', selectedSub, 1, ['match', status, ['answer', 'target', 'missed'], true, false], 0.9, hovered, 0.55, 0],
    } }, 'missed-line');
    map.addLayer({ id: 'sub-flash', type: 'line', source: 'sub-units', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 0, 'line-blur': 0.6, 'line-opacity': 0 } });
  }

  // Shows one country's subdivisions, or none. Clears hover and selection.
  showSubdivisions(data: SubdivisionLayerData | null) {
    if (!this.loaded) return;
    this.setSubHover(null);
    this.setSubSelected(null);
    (this.map.getSource('sub-units') as maplibregl.GeoJSONSource).setData(data?.units ?? EMPTY);
    (this.map.getSource('sub-islets') as maplibregl.GeoJSONSource).setData(data ? isletsOf(data.units, ISLET_KM2) : EMPTY);
    (this.map.getSource('sub-borders') as maplibregl.GeoJSONSource).setData(data?.borders ?? EMPTY);
    for (const id of Object.keys(this.subStatuses)) if (this.subIds.includes(id)) this.setSubState(id, { status: null });
    this.subStatuses = {};
    this.subIds = data ? data.units.features.map(f => String(f.properties?.id)) : [];
    // Each unit's extent, for its size on screen (see subPick).
    this.subBoxes = new Map(data ? data.units.features.map(f => [String(f.properties?.id), boxOf(f.geometry)]) : []);
  }

  // Round statuses for subdivisions (found, missed, answer, target), applied as a change list like setStatuses.
  private subStatuses: StatusMap = {};
  private subBoxes = new Map<string, [number, number, number, number]>();
  setSubStatuses(next: StatusMap) {
    if (!this.loaded) return;
    for (const id of Object.keys(this.subStatuses)) if (!(id in next)) this.setSubState(id, { status: null });
    for (const [id, st] of Object.entries(next)) if (this.subStatuses[id] !== st) this.setSubState(id, { status: st });
    this.subStatuses = { ...next };
  }

  // The unit under the pointer, when a subdivision view is open. Every point of the country belongs to exactly one unit
  // (scripts/build-admin1.ts), so near a border this is simply the unit whose land is under the pointer.
  private subAt(point: maplibregl.Point): string | null {
    if (!this.subIds.length) return null;
    const hit = this.map.queryRenderedFeatures(point, { layers: SUB_PICK })[0];
    return hit ? String(hit.properties.id) : null;
  }
  // A click: the unit under the pointer, exactly. Over water, units within the click reach (the same reach as country
  // rings, wider for touch) are considered, so a unit a few pixels wide at this zoom (Prince Edward Island with all of
  // Canada on a phone) can still be tapped: one in reach is that unit; several are reported, never guessed.
  // A unit that is tiny on screen next to the click makes it too close to call (see resolveSubPick in pick.ts).
  private subPick(point: maplibregl.Point): { id: string | null; ambiguous?: string[] } | null {
    if (!this.subIds.length) return null;
    const direct = this.subAt(point);
    const r = this.reach, box: [maplibregl.PointLike, maplibregl.PointLike] = [[point.x - r, point.y - r], [point.x + r, point.y + r]];
    const ids = [...new Set(this.map.queryRenderedFeatures(box, { layers: SUB_PICK }).map(f => String(f.properties.id)))];
    const near = ids.map(id => ({ id, sizePx: this.sizeOnScreen(id) }));
    const pick = resolveSubPick({ direct, near, overOtherLand: !direct && !!this.pickAt(point).id });
    if (pick.kind === 'country') return { id: pick.id };
    if (pick.kind === 'ambiguous') return { id: null, ambiguous: pick.ids };
    return null;
  }
  // The larger side of a unit's extent on screen, in pixels (its whole extent: Nunavut's islands count as one unit).
  private sizeOnScreen(id: string): number {
    const b = this.subBoxes.get(id);
    if (!b) return Infinity;
    const a = this.map.project([b[0], b[1]]), c = this.map.project([b[2], b[3]]);
    return Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
  }
  private setSubState(id: string, state: { [key: string]: unknown }) {
    for (const source of SUB_SOURCES) this.map.setFeatureState({ source, id }, state);
  }
  private setSubHover(id: string | null) {
    if (id === this.subHoverId) return;
    if (this.subHoverId) this.setSubState(this.subHoverId, { hover: false });
    if (id) this.setSubState(id, { hover: true });
    this.subHoverId = id;
    this.events.onSubHover?.(id);
  }
  setSubSelected(id: string | null) {
    if (id === this.subSelectedId || !this.loaded) return;
    if (this.subSelectedId && this.subIds.includes(this.subSelectedId)) this.setSubState(this.subSelectedId, { selected: false });
    if (id) this.setSubState(id, { selected: true });
    this.subSelectedId = id;
  }

  // Frames a region given by its centre and the distance to its farthest point. On the globe the scale at the centre is
  // 2π·R·cos(lat) / (512·2^zoom) km per pixel, so the zoom that fits 2·radius into the open space (inside the padding)
  // follows directly. Works the same across 180°.
  // If the padding changes while the flight is under way (a round's HUD appears), the zoom is worked out again for it.
  private framing: { center: LngLat; radiusKm: number; camera: Camera } | null = null;
  frame(center: LngLat, radiusKm: number, duration = 1100) {
    const c = this.map.getContainer(), p = this.padding;
    const px = Math.max(120, Math.min(c.clientWidth - p.left - p.right, c.clientHeight - p.top - p.bottom));
    const zoom = Math.log2((2 * Math.PI * 6371 * Math.cos((center[1] * Math.PI) / 180) * px) / (512 * 2 * radiusKm));
    const camera = { center, zoom: Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), zoom)) };
    this.framing = { center, radiusKm, camera };
    this.fly(camera, duration);
  }

  // Gathers what is under and near the pointer and lets resolvePick decide (see pick.ts for the rules).
  private pickAt(point: maplibregl.Point): { id: string | null; land?: Land; ambiguous?: string[] } {
    const hits = this.map.queryRenderedFeatures(point, { layers: PICK_LAYERS });
    const land = hits.find(f => isLandLayer(f.layer.id) && f.properties.playable === 1);
    const halo = hits.find(f => f.layer.id === 'halo-hit');
    const zoom = this.map.getZoom(), c = this.map.getCenter();
    // Rings on the far side of the globe are projected too, so only those within ~70° of the view centre count.
    const markers = this.rings
      .filter(r => markerActive(zoom) && distanceKm([c.lng, c.lat], r.at) < 7800)
      .map(r => ({ id: r.id, px: this.map.project(r.at).dist(point) }))
      .filter(m => m.px <= this.reach);
    const landId = land ? String(land.properties.id) : null;
    const pick = resolvePick({ land: landId, landIsSmall: !!landId && this.small.has(landId), halo: halo ? String(halo.properties.id) : null, markers, ringRadius: ringRadiusAt(zoom), reach: this.reach });
    if (pick.kind === 'country') return { id: pick.id };
    if (pick.kind === 'ambiguous') return { id: null, ambiguous: pick.ids };
    const other = hits.find(f => isLandLayer(f.layer.id));
    return { id: null, land: other && { id: String(other.properties.id), name: String(other.properties.name), sovereign: String(other.properties.sovereign ?? ''), kind: String(other.properties.kind ?? '') } };
  }

  private setState(id: string, state: { [key: string]: unknown }) {
    for (const source of SOURCES) this.map.setFeatureState({ source, id }, state);
  }

  private setHover(id: string | null) {
    if (id === this.hoverId) return;
    if (this.hoverId) this.setState(this.hoverId, { hover: false });
    if (id) this.setState(id, { hover: true });
    this.hoverId = id;
    this.events.onHover(id);
  }

  setTheme(theme: Theme) {
    if (theme === this.theme || !this.loaded) { this.theme = theme; return; }
    this.theme = theme;
    this.map.setPaintProperty('sub-fill', 'fill-color', subFill(theme));
    this.map.setPaintProperty('sub-edge', 'line-color', subFill(theme));
    this.map.setPaintProperty('country-active', 'fill-color', activeColor(theme));
    this.map.setPaintProperty('land-edge-active', 'line-color', activeColor(theme));
    this.map.setPaintProperty('marker-ring', 'circle-color', ringColor(theme));
  }

  // Applies only the changes since the last call, so a status update touches a handful of features, not all 255.
  setStatuses(next: StatusMap) {
    for (const id of Object.keys(this.statuses)) if (!(id in next)) this.setState(id, { status: null });
    for (const [id, s] of Object.entries(next)) if (this.statuses[id] !== s) this.setState(id, { status: s });
    this.statuses = { ...next };
  }

  // Mystery Country heat per guessed country (0–1), applied as a change list like setStatuses.
  private heats: { [id: string]: number } = {};
  setHeat(next: { [id: string]: number }) {
    for (const id of Object.keys(this.heats)) if (!(id in next)) this.setState(id, { heat: null });
    for (const [id, h] of Object.entries(next)) if (this.heats[id] !== h) this.setState(id, { heat: h });
    this.heats = { ...next };
  }

  // Outlines one country (or none) while keeping its colour; used for the country opened in Progress.
  setFocus(id: string | null) {
    if (id === this.focusId || !this.loaded) return;
    if (this.focusId) this.map.setFeatureState({ source: 'outlines', id: this.focusId }, { focus: false });
    if (id) this.map.setFeatureState({ source: 'outlines', id }, { focus: true });
    this.focusId = id;
  }

  // Point markers for cities (Explore: a country's capital and major cities). HTML markers, as the style has no glyphs;
  // a handful at a time is cheap. Labels are not clickable, so they never get in the way of picking countries.
  setCities(list: { id: string; name: string; at: LngLat; capital: boolean }[]) {
    for (const c of this.cities) c.marker.remove();
    this.cities = list.map(({ name, at, capital }) => {
      const el = document.createElement('div');
      el.className = capital ? 'city-marker capital' : 'city-marker';
      el.innerHTML = '<i></i><span></span>';
      el.querySelector('span')!.textContent = name;
      return { el, at, marker: new maplibregl.Marker({ element: el, anchor: 'left', offset: [-4, 0] }).setLngLat(at).addTo(this.map) };
    });
  }

  // Countries outside the chosen region (or outside the Classic 195 during a Classic round). They fade to neutral land;
  // everything else playable becomes the active, colourful region.
  setDimmed(ids: Set<string>) {
    if (!this.loaded) { this.pendingDim = ids; return; }
    for (const id of this.dimmed) if (!ids.has(id)) this.setState(id, { dim: false });
    for (const id of ids) if (!this.dimmed.has(id)) this.setState(id, { dim: true });
    this.dimmed = new Set(ids);
    this.fadeTo(new Set(this.playable.filter(id => !ids.has(id))));
  }

  // Fades the active region in about half a second: newcomers rise to full colour, leavers sink to the neutral land
  // beneath, countries active before and after are untouched. A new call mid-fade continues from each country's current
  // value, so rapid switching never jumps.
  private fadeTo(next: Set<string>) {
    const from = new Map<string, number>();
    for (const id of this.playable) {
      const now = this.act.get(id) ?? 0, goal = next.has(id) ? 1 : 0;
      if (now !== goal) from.set(id, now);
    }
    cancelAnimationFrame(this.fadeFrame);
    if (!from.size) return;
    const start = performance.now();
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / FADE_MS), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      for (const [id, a] of from) {
        const v = a + ((next.has(id) ? 1 : 0) - a) * e;
        this.act.set(id, v);
        this.map.setFeatureState({ source: 'countries', id }, { act: v });
        this.map.setFeatureState({ source: 'islets', id }, { act: v });
      }
      if (t < 1) this.fadeFrame = requestAnimationFrame(step);
    };
    this.fadeFrame = requestAnimationFrame(step);
  }

  // A short outline pulse around one country: green for a correct answer, red for a wrong click.
  flash(id: string, color: string, duration = 700) {
    const map = this.map;
    if (!map.getLayer('flash-line')) return;
    cancelAnimationFrame(this.flashFrame);
    const only = ['==', ['get', 'id'], id] as ExpressionSpecification;
    for (const layer of FLASH_LAYERS) map.setFilter(layer, only);
    map.setPaintProperty('flash-line', 'line-color', color);
    map.setPaintProperty('sub-flash', 'line-color', color);
    map.setPaintProperty('flash-ring', 'circle-stroke-color', color);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration), fade = 1 - t * t, swell = Math.sin(Math.min(1, t * 2.5) * Math.PI / 2);
      map.setPaintProperty('flash-line', 'line-width', 1.5 + 2.5 * swell);
      map.setPaintProperty('flash-line', 'line-opacity', fade);
      map.setPaintProperty('sub-flash', 'line-width', 1.5 + 2.5 * swell);
      map.setPaintProperty('sub-flash', 'line-opacity', fade);
      map.setPaintProperty('flash-ring', 'circle-radius', 8 + 6 * swell);
      map.setPaintProperty('flash-ring', 'circle-stroke-opacity', fade);
      if (t < 1) this.flashFrame = requestAnimationFrame(step);
    };
    this.flashFrame = requestAnimationFrame(step);
  }

  // Where an answer landed: a green ring with the points won, or a red ring with ✕. An HTML marker, so it follows the
  // camera; it never takes clicks, names nothing, and removes itself after PULSE_MS (the CSS animation is shorter).
  pulse(at: LngLat, kind: 'good' | 'bad', label: string, sub?: string) {
    const el = document.createElement('div');
    el.className = `answer-pulse ${kind}`;
    el.innerHTML = '<i></i><b></b>';
    el.querySelector('b')!.textContent = label;
    if (sub) el.append(Object.assign(document.createElement('small'), { textContent: sub }));
    const p = { marker: new maplibregl.Marker({ element: el }).setLngLat(at).addTo(this.map), timer: setTimeout(() => { p.marker.remove(); this.pulses.delete(p); }, PULSE_MS) };
    this.pulses.add(p);
  }

  // Every flight carries the current padding: a separate padding animation would cancel a flight already under way.
  fly(camera: Camera, duration = 1100) {
    this.flightTarget = camera;
    this.map.once('moveend', () => { if (this.flightTarget === camera) this.flightTarget = null; });
    this.map.flyTo({ center: camera.center, zoom: camera.zoom, padding: this.padding, duration, essential: true });
  }

  jump(camera: Camera) { this.map.jumpTo(camera); }

  // Keeps the globe centred in the open space beside the side panel or under the question card.
  // Mid-flight, the flight is restarted toward the same target with the new padding instead of being cancelled.
  setPadding(padding: Padding, animate = false) {
    this.padding = padding;
    if (!animate) this.map.setPadding(padding);
    else if (this.flightTarget && this.framing?.camera === this.flightTarget) this.frame(this.framing.center, this.framing.radiusKm);
    else if (this.flightTarget) this.fly(this.flightTarget);
    else this.map.easeTo({ padding, duration: 600 });
  }

  zoomBy(delta: number) { this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 300 }); }

  destroy() {
    cancelAnimationFrame(this.flashFrame); cancelAnimationFrame(this.fadeFrame); this.setCities([]);
    for (const p of this.pulses) { clearTimeout(p.timer); p.marker.remove(); }
    this.map.remove();
  }
}
