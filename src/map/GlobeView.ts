import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { distanceKm, type LngLat } from '../game/geo';

export type Status = 'target' | 'correct' | 'missed' | 'wrong' | 'mastered' | 'selected';
export type StatusMap = { [id: string]: Status };
export type Camera = { center: LngLat; zoom: number };

export const COLORS = {
  ocean: '#081a33',
  land: '#172c45',        // non-playable land and countries outside the current area
  border: 'rgba(196, 222, 255, 0.32)',
  target: '#ffcf5c',
  correct: '#3fe0a6',
  missed: '#ff6f6f',
  wrong: '#ff6f6f',
  mastered: '#38c7d8',
  selected: '#ffcf5c',
  // Calm night palette for Natural Earth's 7 map colours, so neighbours never share a colour.
  base: ['#2f69ad', '#2f8ea3', '#5a6cc2', '#2e8d77', '#7660bd', '#3d7fcb', '#4d7d9c'],
};

const DATA = `${import.meta.env.BASE_URL}data`;
const status: ExpressionSpecification = ['feature-state', 'status'];
const stateColor = (fallback: ExpressionSpecification | string): ExpressionSpecification => [
  'case',
  ['==', status, 'target'], COLORS.target,
  ['==', status, 'selected'], COLORS.selected,
  ['==', status, 'correct'], COLORS.correct,
  ['==', status, 'missed'], COLORS.missed,
  ['==', status, 'wrong'], COLORS.wrong,
  ['==', status, 'mastered'], COLORS.mastered,
  fallback,
] as ExpressionSpecification;
const baseColor = ['match', ['get', 'color'], ...COLORS.base.flatMap((c, i) => [i + 1, c]), COLORS.base[0]] as unknown as ExpressionSpecification;
const countryColor = stateColor(['case', ['==', ['get', 'playable'], 0], COLORS.land, ['boolean', ['feature-state', 'dim'], false], COLORS.land, baseColor] as ExpressionSpecification);
const hovered = ['boolean', ['feature-state', 'hover'], false] as ExpressionSpecification;
const dimmed = ['boolean', ['feature-state', 'dim'], false] as ExpressionSpecification;
// Rings and halos of countries outside the current area fade with their land.
const outlineColor = (color: string) => stateColor(['case', dimmed, '#3a5372', color] as ExpressionSpecification);
// Ring markers show at world zoom and fade out once the real shape is big enough to click.
const markerFade = (max: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 4.5, max, 6.5, 0];

const OCEANS: [string, LngLat][] = [['Pacific Ocean', [-150, 8]], ['Pacific Ocean', [165, 22]], ['Atlantic Ocean', [-38, 22]], ['Atlantic Ocean', [-20, -25]], ['Indian Ocean', [78, -22]], ['Southern Ocean', [40, -62]], ['Arctic Ocean', [-10, 84]]];
const SOURCES = ['countries', 'halos', 'markers'] as const;
const PICK_LAYERS = ['marker-hit', 'halo-fill', 'country-fill'];

export type GlobeEvents = {
  onPick: (id: string | null, at: LngLat) => void;
  onHover: (id: string | null) => void;
};

export class GlobeView {
  readonly map: Map;
  private statuses: StatusMap = {};
  private dimmed = new Set<string>();
  private hoverId: string | null = null;
  private ready: Promise<void>;

  constructor(container: HTMLElement, private events: GlobeEvents) {
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
    const hideFarLabels = () => {
      const c = this.map.getCenter();
      for (const { el, at } of labels) el.style.visibility = distanceKm([c.lng, c.lat], at) > 7800 ? 'hidden' : 'visible';
    };
    this.map.on('move', hideFarLabels);
    hideFarLabels();
  }

  // Keeps the globe centred in the open space beside the side panel.
  setPadding(padding: { left: number; right: number; top: number; bottom: number }) { this.map.setPadding(padding); }

  // Resolves with the country shapes and the ids of countries small enough to carry a ring marker.
  async load(): Promise<{ countries: GeoJSON.FeatureCollection; tiny: Set<string> }> {
    await this.ready;
    const [countries, halos, markers] = await Promise.all(['countries', 'halos', 'markers'].map(async f => {
      const res = await fetch(`${DATA}/${f}.geojson`);
      if (!res.ok) throw new Error(`Could not load ${f} data (${res.status}).`);
      return res.json() as Promise<GeoJSON.FeatureCollection>;
    }));
    const map = this.map;
    map.addSource('countries', { type: 'geojson', data: countries, promoteId: 'id' });
    map.addSource('halos', { type: 'geojson', data: halos, promoteId: 'id' });
    map.addSource('markers', { type: 'geojson', data: markers, promoteId: 'id' });
    map.addSource('guess-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', paint: { 'fill-color': countryColor, 'fill-opacity': ['case', hovered, 1, 0.9] } });
    map.addLayer({ id: 'country-line', type: 'line', source: 'countries', paint: { 'line-color': COLORS.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 5, 1.1] } });
    map.addLayer({ id: 'halo-fill', type: 'fill', source: 'halos', paint: { 'fill-color': stateColor(['case', dimmed, COLORS.land, baseColor] as ExpressionSpecification), 'fill-opacity': ['case', hovered, 0.38, 0.22] } });
    map.addLayer({ id: 'halo-line', type: 'line', source: 'halos', paint: { 'line-color': outlineColor('#8fb6e8'), 'line-width': 1.1, 'line-opacity': 0.85, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'guess-line', type: 'line', source: 'guess-line', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [1, 2] } });
    map.addLayer({ id: 'marker-glow', type: 'circle', source: 'markers', maxzoom: 7, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 11, 5, 15], 'circle-color': outlineColor('#9cc7ff'), 'circle-blur': 1, 'circle-opacity': markerFade(0.35) } });
    map.addLayer({ id: 'marker-ring', type: 'circle', source: 'markers', maxzoom: 7, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5.5, 5, 8], 'circle-color': outlineColor(COLORS.base[0]), 'circle-opacity': markerFade(0.45), 'circle-stroke-color': outlineColor('#cfe3ff'), 'circle-stroke-width': ['case', hovered, 2.4, 1.5], 'circle-stroke-opacity': markerFade(1) } });
    // Invisible, wider click target so tiny countries are as easy to hit as large ones.
    map.addLayer({ id: 'marker-hit', type: 'circle', source: 'markers', maxzoom: 6.5, paint: { 'circle-radius': 14, 'circle-opacity': 0 } });

    map.on('click', e => this.events.onPick(this.pickAt(e.point), [e.lngLat.lng, e.lngLat.lat]));
    map.on('mousemove', e => {
      const id = this.pickAt(e.point);
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      this.setHover(id);
    });
    map.on('mouseout', () => this.setHover(null));
    return { countries, tiny: new Set(markers.features.map(f => String(f.properties?.id))) };
  }

  private pickAt(point: maplibregl.PointLike): string | null {
    const hit = this.map.queryRenderedFeatures(point, { layers: PICK_LAYERS })
      .find(f => f.layer.id !== 'country-fill' || f.properties.playable === 1);
    return hit ? String(hit.properties.id) : null;
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

  // Applies only the changes since the last call, so a status update touches a handful of features, not all 240.
  setStatuses(next: StatusMap) {
    for (const id of Object.keys(this.statuses)) if (!(id in next)) this.setState(id, { status: null });
    for (const [id, s] of Object.entries(next)) if (this.statuses[id] !== s) this.setState(id, { status: s });
    this.statuses = { ...next };
  }

  setDimmed(ids: Set<string>) {
    for (const id of this.dimmed) if (!ids.has(id)) this.setState(id, { dim: false });
    for (const id of ids) if (!this.dimmed.has(id)) this.setState(id, { dim: true });
    this.dimmed = new Set(ids);
  }

  showGuessLine(points: LngLat[] | null) {
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: points ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } }] : [] };
    (this.map.getSource('guess-line') as GeoJSONSource | undefined)?.setData(data);
  }

  fly(camera: Camera, duration = 1100) {
    this.map.flyTo({ center: camera.center, zoom: camera.zoom, duration, essential: true });
  }

  zoomBy(delta: number) { this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 300 }); }

  destroy() { this.map.remove(); }
}
