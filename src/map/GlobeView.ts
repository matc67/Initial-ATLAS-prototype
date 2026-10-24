import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { distanceKm, type LngLat } from '../game/geo';
import { isletsOf, outlinesOf } from './outlines';
import { MARKER_REACH_PX, markerActive, resolvePick, ringRadiusAt } from './pick';

// Round states: `found` = completed this round, `answer` = shown after the last miss, `target` = the country to name.
// Progress states, from one recorded run: `first` = correct first try, `retry` = needed more attempts, `hinted` = Show me.
export type Status = 'target' | 'answer' | 'found' | 'missed' | 'selected' | 'first' | 'retry' | 'hinted';
export type StatusMap = { [id: string]: Status };
export type Camera = { center: LngLat; zoom: number };
export type Padding = { left: number; right: number; top: number; bottom: number };
// `explore`: every country in full colour. `play`: muted until found. `progress`: dark neutral unless the run attempted it.
export type Theme = 'explore' | 'play' | 'progress';

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

// Colour of an active country (or its halo / ring) from its status, the theme and hover.
function activeColor(theme: Theme): ExpressionSpecification {
  const resting = theme === 'explore' ? vivid : theme === 'play' ? ['case', hovered, lifted, muted] : ['case', hovered, mix(COLORS.progress.none, '#ffffff', 0.12), COLORS.progress.none];
  const lift = (c: string) => ['case', hovered, mix(c, '#ffffff', 0.15), c];
  return ['match', status,
    'found', COLORS.completed,
    'selected', vivid,
    ['answer', 'target'], COLORS.gold,
    'missed', COLORS.missed,
    'first', lift(COLORS.progress.first),
    'retry', lift(COLORS.progress.retry),
    'hinted', lift(COLORS.progress.hinted),
    resting,
  ] as unknown as ExpressionSpecification;
}
// Inactive land: neutral blue-gray. A country selected in Explore outside the region still shows its own colour.
const baseColor = ['match', status, 'selected', vivid, ['case', hovered, '#2a3d58', inactive]] as unknown as ExpressionSpecification;
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
const FLASH_LAYERS = ['flash-line', 'flash-ring'];
// Borders: a muted blue-grey that reads against the ocean without outshining the land.
const BORDER = 'rgba(172, 196, 228, 0.5)';
// Coastline width for the land-edge layers: the land's own colour, drawn along its outline (see load()).
// Islands below this area get the land-edge trace: about 3 × 3 pixels at the zoom of a World round.
const ISLET_KM2 = 3000;
const LAND_EDGE = ['interpolate', ['linear'], ['zoom'], 1, 1.1, 4, 0.9, 7, 0.6] as ExpressionSpecification;
// Region fades: each country carries an `act` feature-state from 0 (neutral land) to 1 (full colour) that is animated per
// country. Layers and their filters never change, so a region switch never makes MapLibre rebuild its tiles.
const FADE_MS = 450;
const act = ['coalesce', ['feature-state', 'act'], 0] as ExpressionSpecification;
const RELIEF_BOUNDS: [[number, number], [number, number], [number, number], [number, number]] = [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]];

// Land that is not one of the 195 playable countries (Greenland, Puerto Rico, Western Sahara, Antarctica…).
export type Land = { id: string; name: string; sovereign: string; kind: string };

export type GlobeEvents = {
  // `id` is the playable country clicked; `land` is set instead when the click hit non-playable land. `ambiguous` lists
  // the countries when the click sat between rings too close to tell apart (then `id` is null).
  onPick: (id: string | null, at: LngLat, land?: Land, ambiguous?: string[]) => void;
  onHover: (id: string | null) => void;
};

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
  private rings: { id: string; at: LngLat }[] = [];
  private small = new Set<string>();

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
      'line-color': ['case', ['==', ['get', 'playable'], 0], COLORS.inactiveBorder, dimmed, COLORS.inactiveBorder, ['==', status, 'found'], COLORS.completedLine, BORDER],
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
      'circle-stroke-color': ['match', status, 'found', COLORS.completedRing, 'selected', '#ffffff', ['answer', 'target'], COLORS.gold, 'missed', COLORS.missedLine, ['case', dimmed, '#3a4b6b', '#dbe8ff']],
      'circle-stroke-width': ['case', hovered, 2.2, 1.4], 'circle-stroke-opacity': markerFade(1),
    } });
    // One-off pulses for a correct answer or a wrong click; see flash(). Kept crisp: a thin line with little blur.
    map.addLayer({ id: 'flash-line', type: 'line', source: 'outlines', filter: none, layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 0, 'line-blur': 0.6, 'line-opacity': 0 } });
    map.addLayer({ id: 'flash-ring', type: 'circle', source: 'markers', filter: none, paint: { 'circle-radius': 8, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0 } });

    map.on('click', e => { const { id, land, ambiguous } = this.pickAt(e.point); this.events.onPick(id, [e.lngLat.lng, e.lngLat.lat], land, ambiguous); });
    map.on('mousemove', e => {
      const { id } = this.pickAt(e.point);
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      this.setHover(id);
    });
    map.on('mouseout', () => this.setHover(null));
    this.playable = countries.features.filter(f => f.properties?.playable === 1).map(f => String(f.properties!.id));
    this.rings = markers.features.map(f => ({ id: String(f.properties?.id), at: (f.geometry as GeoJSON.Point).coordinates as LngLat }));
    this.small = new Set([...this.rings.map(r => r.id), ...halos.features.map(f => String(f.properties?.id))]);
    this.loaded = true;
    if (this.pendingDim) this.setDimmed(this.pendingDim);
    return { countries, tiny: new Set(markers.features.map(f => String(f.properties?.id))) };
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
      .filter(m => m.px <= MARKER_REACH_PX);
    const landId = land ? String(land.properties.id) : null;
    const pick = resolvePick({ land: landId, landIsSmall: !!landId && this.small.has(landId), halo: halo ? String(halo.properties.id) : null, markers, ringRadius: ringRadiusAt(zoom), reach: MARKER_REACH_PX });
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
    map.setPaintProperty('flash-ring', 'circle-stroke-color', color);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration), fade = 1 - t * t, swell = Math.sin(Math.min(1, t * 2.5) * Math.PI / 2);
      map.setPaintProperty('flash-line', 'line-width', 1.5 + 2.5 * swell);
      map.setPaintProperty('flash-line', 'line-opacity', fade);
      map.setPaintProperty('flash-ring', 'circle-radius', 8 + 6 * swell);
      map.setPaintProperty('flash-ring', 'circle-stroke-opacity', fade);
      if (t < 1) this.flashFrame = requestAnimationFrame(step);
    };
    this.flashFrame = requestAnimationFrame(step);
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
    else if (this.flightTarget) this.fly(this.flightTarget);
    else this.map.easeTo({ padding, duration: 600 });
  }

  zoomBy(delta: number) { this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 300 }); }

  destroy() { cancelAnimationFrame(this.flashFrame); cancelAnimationFrame(this.fadeFrame); this.setCities([]); this.map.remove(); }
}
