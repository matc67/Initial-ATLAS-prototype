import maplibregl, { type ExpressionSpecification, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { distanceKm, type LngLat } from '../game/geo';

// Round states: `found` = first try, `found-late` = a later try, `answer` = shown after the last miss, `target` = the
// country to name. Progress states: `mastered`, `learned`, `practicing`.
export type Status = 'target' | 'answer' | 'found' | 'found-late' | 'missed' | 'selected' | 'mastered' | 'learned' | 'practicing';
export type StatusMap = { [id: string]: Status };
export type Camera = { center: LngLat; zoom: number };
export type Padding = { left: number; right: number; top: number; bottom: number };
// `explore`: every country in full colour. `play`: muted until found. `progress`: grey until practised.
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
  notStarted: '#2b3654',   // Progress view: never practised
  gold: '#ffcf5c',
  missed: '#5a2333',
  missedLine: '#ff7d7d',
  good: '#4ade80',
  bad: '#ff6b6b',
  progress: { mastered: '#a855f7', learned: '#3b82f6', practicing: '#22c55e' },
  // One colour per Natural Earth MAPCOLOR7 class (1-7). MAPCOLOR7 never gives two bordering countries the same class,
  // so neighbours always differ, and a country keeps the same colour in every region.
  country: ['#3982f6', '#ef5350', '#25b96a', '#f2b544', '#9a5ce0', '#21a99f', '#f97316'],
};
const NAVY = '#0b1a33';
// Shared by country, halo and ring layers; falls back to the inactive colour for land without a class.
const palette = (colors: string[]): ExpressionSpecification =>
  ['match', ['get', 'color'], ...colors.flatMap((c, i) => [i + 1, c]), COLORS.inactive] as unknown as ExpressionSpecification;
// Full colour (active region), muted (in a round, not yet found) and lifted (muted country under the cursor).
const vivid = palette(COLORS.country), muted = palette(COLORS.country.map(c => mix(c, NAVY, 0.5))), lifted = palette(COLORS.country.map(c => mix(c, NAVY, 0.25)));
const inactive = ['match', ['%', ['get', 'color'], 2], 0, COLORS.inactiveAlt, COLORS.inactive] as unknown as ExpressionSpecification;

const DATA = `${import.meta.env.BASE_URL}data`;
const status = ['coalesce', ['feature-state', 'status'], ''] as ExpressionSpecification;
const hovered = ['boolean', ['feature-state', 'hover'], false] as ExpressionSpecification;
const dimmed = ['boolean', ['feature-state', 'dim'], false] as ExpressionSpecification;

// Colour of an active country (or its halo / ring) from its status, the theme and hover.
function activeColor(theme: Theme): ExpressionSpecification {
  const resting = theme === 'explore' ? vivid : theme === 'play' ? ['case', hovered, lifted, muted] : ['case', hovered, '#3a4766', COLORS.notStarted];
  return ['match', status,
    ['found', 'found-late', 'selected'], vivid,
    ['answer', 'target'], COLORS.gold,
    'missed', COLORS.missed,
    'mastered', COLORS.progress.mastered,
    'learned', COLORS.progress.learned,
    'practicing', COLORS.progress.practicing,
    resting,
  ] as unknown as ExpressionSpecification;
}
// Inactive land: neutral blue-gray. A country selected in Explore outside the region still shows its own colour.
const baseColor = ['match', status, 'selected', vivid, ['case', hovered, '#2a3d58', inactive]] as unknown as ExpressionSpecification;
// Ring markers read like their country: active colour inside the region, neutral outside.
const ringColor = (theme: Theme): ExpressionSpecification => ['case', dimmed, inactive, activeColor(theme)] as unknown as ExpressionSpecification;
const strongLine = ['match', status,
  ['selected', 'target', 'answer'], '#fff6dc',
  ['found', 'found-late'], 'rgba(255, 255, 255, 0.8)',
  'rgba(0, 0, 0, 0)'] as unknown as ExpressionSpecification;
// Ring markers show at world zoom and fade out once the real shape is big enough to click.
// Countries with a halo hand over to it sooner (by zoom 4.2), so ring and halo never crowd the same islands.
const withHalo = ['==', ['get', 'halo'], 1] as ExpressionSpecification;
const markerFade = (max: number): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], 3.2, max, 4.2, ['case', withHalo, 0, max], 4.5, ['case', withHalo, 0, max], 6.5, 0];

const OCEANS: [string, LngLat][] = [['Pacific Ocean', [-150, 8]], ['Pacific Ocean', [165, 22]], ['Atlantic Ocean', [-38, 22]], ['Atlantic Ocean', [-20, -25]], ['Indian Ocean', [78, -22]], ['Southern Ocean', [40, -62]], ['Arctic Ocean', [-10, 84]]];
const SOURCES = ['countries', 'halos', 'markers'] as const;
const PICK_LAYERS = ['marker-hit', 'halo-base', 'country-base'];
const FLASH_LAYERS = ['flash-line', 'flash-halo', 'flash-ring'];
// Region fades: each country carries an `act` feature-state from 0 (neutral land) to 1 (full colour) that is animated per
// country. Layers and their filters never change, so a region switch never makes MapLibre rebuild its tiles.
const FADE_MS = 450;
const act = ['coalesce', ['feature-state', 'act'], 0] as ExpressionSpecification;
const RELIEF_BOUNDS: [[number, number], [number, number], [number, number], [number, number]] = [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]];

// Land that is not one of the 195 playable countries (Greenland, Puerto Rico, Western Sahara, Antarctica…).
export type Land = { id: string; name: string; sovereign: string; kind: string };

export type GlobeEvents = {
  // `id` is the playable country clicked; `land` is set instead when the click hit non-playable land.
  onPick: (id: string | null, at: LngLat, land?: Land) => void;
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
      for (const { el, at } of labels) el.style.visibility = distanceKm([c.lng, c.lat], at) > 7800 ? 'hidden' : 'visible';
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
    map.addImage('atlas-hatch', hatchPattern(), { pixelRatio: 2 });
    map.addSource('countries', { type: 'geojson', data: countries, promoteId: 'id' });
    map.addSource('halos', { type: 'geojson', data: halos, promoteId: 'id' });
    map.addSource('markers', { type: 'geojson', data: markers, promoteId: 'id' });
    const none = ['==', ['get', 'id'], ''] as ExpressionSpecification;
    const lineWidth = (a: number, b: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 1, a, 5, b];

    // Neutral land everywhere, with the active region's colours faded in above it per country (see fadeTo).
    map.addLayer({ id: 'country-base', type: 'fill', source: 'countries', paint: { 'fill-color': baseColor, 'fill-opacity': 0.97 } });
    map.addLayer({ id: 'country-active', type: 'fill', source: 'countries', paint: { 'fill-color': activeColor(this.theme), 'fill-opacity': ['*', 0.97, act] } });
    // Shaded relief from Natural Earth, pre-converted to a transparent light/shadow overlay (scripts/build-relief.ts).
    // It fades out before the 2048-pixel texture turns blurry when zoomed in.
    map.addSource('relief', { type: 'image', url: `${DATA}/relief.webp`, coordinates: RELIEF_BOUNDS });
    map.addLayer({ id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 3.5, 0.55, 5, 0], 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
    map.addLayer({ id: 'found-late-hatch', type: 'fill', source: 'countries', paint: { 'fill-pattern': 'atlas-hatch', 'fill-opacity': ['match', status, 'found-late', 0.5, 0] } });
    map.addLayer({ id: 'country-line', type: 'line', source: 'countries', paint: {
      'line-color': ['case', ['==', ['get', 'playable'], 0], COLORS.inactiveBorder, dimmed, COLORS.inactiveBorder, 'rgba(232, 241, 255, 0.42)'],
      'line-width': lineWidth(0.45, 1.1),
    } });
    // Drawn above the shared borders so a status outline is never painted over by a neighbour.
    map.addLayer({ id: 'focus-line', type: 'line', source: 'countries', layout: { 'line-join': 'round' }, paint: { 'line-color': strongLine, 'line-width': lineWidth(1.2, 2.2) } });
    map.addLayer({ id: 'missed-line', type: 'line', source: 'countries', paint: { 'line-color': COLORS.missedLine, 'line-width': lineWidth(1, 1.8), 'line-dasharray': [2, 1.5], 'line-opacity': ['match', status, 'missed', 1, 0] } });
    map.addLayer({ id: 'halo-base', type: 'fill', source: 'halos', paint: { 'fill-color': baseColor, 'fill-opacity': 0.16 } });
    map.addLayer({ id: 'halo-active', type: 'fill', source: 'halos', paint: { 'fill-color': activeColor(this.theme), 'fill-opacity': ['*', act, ['match', status, ['', 'missed'], ['case', hovered, 0.4, 0.26], 0.45]] } });
    map.addLayer({ id: 'halo-line', type: 'line', source: 'halos', paint: { 'line-color': ['match', status, ['found', 'found-late', 'selected'], '#ffffff', ['answer', 'target'], COLORS.gold, 'missed', COLORS.missedLine, ['case', dimmed, 'rgba(125, 154, 191, 0.4)', '#b4cdf0']], 'line-width': 1, 'line-opacity': 0.85, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'marker-ring', type: 'circle', source: 'markers', maxzoom: 7, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5.5, 5, 8],
      'circle-color': ringColor(this.theme), 'circle-opacity': markerFade(0.8),
      'circle-stroke-color': ['match', status, ['found', 'found-late', 'selected'], '#ffffff', ['answer', 'target'], COLORS.gold, 'missed', COLORS.missedLine, ['case', dimmed, '#3a4b6b', '#dbe8ff']],
      'circle-stroke-width': ['case', hovered, 2.2, 1.4], 'circle-stroke-opacity': markerFade(1),
    } });
    // Invisible, wider click target so tiny countries are as easy to hit as large ones.
    // Once a halo has taken over (zoom 4.5) its country's hit circle shrinks to nothing, so it cannot steal clicks from neighbours.
    map.addLayer({ id: 'marker-hit', type: 'circle', source: 'markers', maxzoom: 6.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.2, 14, 4.5, ['case', withHalo, 0, 14]], 'circle-opacity': 0 } });
    // One-off pulses for a correct answer or a wrong click; see flash(). Kept crisp: a thin line with little blur.
    map.addLayer({ id: 'flash-line', type: 'line', source: 'countries', filter: none, layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 0, 'line-blur': 0.6, 'line-opacity': 0 } });
    map.addLayer({ id: 'flash-halo', type: 'line', source: 'halos', filter: none, paint: { 'line-color': '#fff', 'line-width': 0, 'line-blur': 0.6, 'line-opacity': 0 } });
    map.addLayer({ id: 'flash-ring', type: 'circle', source: 'markers', filter: none, paint: { 'circle-radius': 8, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0 } });

    map.on('click', e => { const { id, land } = this.pickAt(e.point); this.events.onPick(id, [e.lngLat.lng, e.lngLat.lat], land); });
    map.on('mousemove', e => {
      const { id } = this.pickAt(e.point);
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      this.setHover(id);
    });
    map.on('mouseout', () => this.setHover(null));
    this.playable = countries.features.filter(f => f.properties?.playable === 1).map(f => String(f.properties!.id));
    this.loaded = true;
    if (this.pendingDim) this.setDimmed(this.pendingDim);
    return { countries, tiny: new Set(markers.features.map(f => String(f.properties?.id))) };
  }

  private pickAt(point: maplibregl.PointLike): { id: string | null; land?: Land } {
    const hits = this.map.queryRenderedFeatures(point, { layers: PICK_LAYERS });
    const country = hits.find(f => f.layer.id !== 'country-base' || f.properties.playable === 1);
    if (country) return { id: String(country.properties.id) };
    const other = hits.find(f => f.layer.id === 'country-base');
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
    this.map.setPaintProperty('halo-active', 'fill-color', activeColor(theme));
    this.map.setPaintProperty('marker-ring', 'circle-color', ringColor(theme));
  }

  // Applies only the changes since the last call, so a status update touches a handful of features, not all 255.
  setStatuses(next: StatusMap) {
    for (const id of Object.keys(this.statuses)) if (!(id in next)) this.setState(id, { status: null });
    for (const [id, s] of Object.entries(next)) if (this.statuses[id] !== s) this.setState(id, { status: s });
    this.statuses = { ...next };
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
        this.map.setFeatureState({ source: 'halos', id }, { act: v });
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
    map.setPaintProperty('flash-halo', 'line-color', color);
    map.setPaintProperty('flash-ring', 'circle-stroke-color', color);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration), fade = 1 - t * t, swell = Math.sin(Math.min(1, t * 2.5) * Math.PI / 2);
      map.setPaintProperty('flash-line', 'line-width', 1.5 + 2.5 * swell);
      map.setPaintProperty('flash-line', 'line-opacity', fade);
      map.setPaintProperty('flash-halo', 'line-width', 1.5 + 2 * swell);
      map.setPaintProperty('flash-halo', 'line-opacity', fade);
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

  destroy() { cancelAnimationFrame(this.flashFrame); cancelAnimationFrame(this.fadeFrame); this.map.remove(); }
}

// Diagonal white stripes marking a country found on a later try, so it differs from a first-try find by pattern, not only colour.
function hatchPattern(): ImageData {
  const size = 16, ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = ctx.canvas.height = size;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 2.5;
  for (const o of [-size, 0, size]) { ctx.beginPath(); ctx.moveTo(o, size); ctx.lineTo(o + size, 0); ctx.stroke(); }
  return ctx.getImageData(0, 0, size, size);
}
