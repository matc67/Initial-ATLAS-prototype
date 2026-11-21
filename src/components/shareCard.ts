// Draws a share card (game/shareCard.ts decides what is on it and where) as a PNG: ATLAS's dark night sky, and on the
// right a globe drawn from the game's own country shapes, turned to the place that was played and lit like the one in
// the game, with the result marked on it (the country and its cities, the countries of a round, a mystery's guesses).
// Plain canvas 2D: no library, and no copy of the WebGL map. The same code draws the site's link preview image
// (scripts/build-share-assets.ts).
import { flagUrl } from '../data/flags';
import type { LngLat } from '../game/geo';
import { CARD, cardContent, fontCss, layoutCard, type CardContent, type CardLayout, type Font, type ShareResult, type TextItem } from '../game/shareCard.ts';

export type GlobeShape = { geometry: GeoJSON.Geometry; fill: string; stroke?: string; width?: number };
export type GlobePoint = { at: LngLat; color: string; r: number };
export type CardGlobe = {
  center: LngLat;
  radiusKm: number | null;      // the area to fill the globe with; null shows the whole hemisphere
  land: GeoJSON.Geometry[];     // every country, drawn quietly
  shapes: GlobeShape[];         // the result, drawn over the land
  points: GlobePoint[];
};

const INK = { ink: '#eaf3ff', ink2: '#b4c5e0', ink3: '#7f93b4', accent: '#8ab8ff', gold: '#ffcf5c' } as const;
const GLOBE = { x: 905, y: 318, r: 262 };
const LAND = '#1b2d48', LAND_LINE = 'rgba(150, 182, 224, 0.22)';

export async function renderShareCard(result: ShareResult, globe: CardGlobe, site: string): Promise<{ blob: Blob; alt: string; content: CardContent }> {
  const content = cardContent(result);
  const blob = await draw(globe, site, content);
  return { blob, alt: content.alt, content };
}

// The site's own card for link previews: no result, the brand and the globe.
export async function renderBrandCard(globe: CardGlobe, site: string): Promise<Blob> {
  return draw(globe, site, null);
}

async function draw(globe: CardGlobe, site: string, content: CardContent | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD.w * CARD.scale; canvas.height = CARD.h * CARD.scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.scale(CARD.scale, CARD.scale);
  await fontsReady();

  sky(ctx);
  drawGlobe(ctx, globe);
  const measure = (text: string, font: string) => { ctx.font = font; return ctx.measureText(text).width; };
  if (content) {
    const layout = layoutCard(content, measure, site);
    await drawLayout(ctx, layout);
  } else brand(ctx, site);

  // JPEG at high quality: a fifth of the PNG's size for the same look (the sky's gradients are most of a PNG's weight).
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not draw the image.'))), 'image/jpeg', 0.92));
}

const FONTS: Font[] = [
  { weight: 700, size: 24, family: 'display' }, { weight: 600, size: 24, family: 'display' },
  { weight: 700, size: 16, family: 'body' }, { weight: 600, size: 16, family: 'body' }, { weight: 500, size: 16, family: 'body' },
];
async function fontsReady() {
  try { await Promise.all(FONTS.map(f => document.fonts.load(fontCss(f)))); await document.fonts.ready; } catch { /* system fonts then */ }
}

// ---- The sky -------------------------------------------------------------------------------------------------------------------
function sky(ctx: CanvasRenderingContext2D) {
  const { w, h } = CARD;
  ctx.fillStyle = '#030914';
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(GLOBE.x, GLOBE.y, GLOBE.r * 0.6, GLOBE.x, GLOBE.y, GLOBE.r * 2.3);
  glow.addColorStop(0, 'rgba(22, 58, 120, 0.55)'); glow.addColorStop(0.45, 'rgba(10, 30, 70, 0.28)'); glow.addColorStop(1, 'rgba(3, 9, 20, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  // Stars: the same every time (seeded), sparse, faint, fewer behind the text.
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 190; i++) {
    const x = rnd() * w, y = rnd() * h, a = 0.12 + rnd() * 0.5, r = 0.5 + rnd() * 0.9;
    if (x < 620 && rnd() < 0.55) continue;
    if (Math.hypot(x - GLOBE.x, y - GLOBE.y) < GLOBE.r + 6) continue;
    ctx.fillStyle = `rgba(214, 229, 255, ${a.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- The globe -----------------------------------------------------------------------------------------------------------------
// Orthographic projection around `center`, zoomed so the result fills the disc. Points on the far side are pushed to the
// edge, which is invisible once clipped to the disc.
function projector(globe: CardGlobe) {
  const rad = Math.PI / 180, [l0, p0] = [globe.center[0] * rad, globe.center[1] * rad];
  const theta = globe.radiusKm === null ? Math.PI / 2 : Math.min(1.4, globe.radiusKm / 6371);
  const zoom = globe.radiusKm === null ? 1 : Math.max(1, Math.min(40, 0.62 / Math.sin(theta)));
  const R = GLOBE.r * zoom, sp0 = Math.sin(p0), cp0 = Math.cos(p0);
  const project = ([lng, lat]: number[]): [number, number, boolean] => {
    const l = lng * rad - l0, p = lat * rad, cp = Math.cos(p);
    let x = cp * Math.sin(l), y = cp0 * Math.sin(p) - sp0 * cp * Math.cos(l);
    const front = sp0 * Math.sin(p) + cp0 * cp * Math.cos(l) >= 0;
    if (!front) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; }
    return [GLOBE.x + x * R, GLOBE.y - y * R, front];
  };
  return { project, zoom };
}

function polygons(g: GeoJSON.Geometry): number[][][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygons);
  return [];
}
function tracePolygons(ctx: CanvasRenderingContext2D, g: GeoJSON.Geometry, project: ReturnType<typeof projector>['project']) {
  for (const poly of polygons(g)) for (const ring of poly) {
    let any = false;
    const pts = ring.map(pt => { const q = project(pt); any ||= q[2]; return q; });
    if (!any) continue;
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }
}

function drawGlobe(ctx: CanvasRenderingContext2D, globe: CardGlobe) {
  const { x, y, r } = GLOBE, { project, zoom } = projector(globe);
  // Atmosphere: a soft blue halo around the rim.
  const halo = ctx.createRadialGradient(x, y, r * 0.96, x, y, r * 1.2);
  halo.addColorStop(0, 'rgba(110, 170, 255, 0.42)'); halo.addColorStop(0.35, 'rgba(70, 130, 240, 0.16)'); halo.addColorStop(1, 'rgba(40, 90, 200, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
  // Ocean, lit from the upper left.
  const sea = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.05, x, y, r * 1.05);
  sea.addColorStop(0, '#16407a'); sea.addColorStop(0.55, '#08204a'); sea.addColorStop(1, '#040f27');
  ctx.fillStyle = sea;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // Graticule.
  ctx.strokeStyle = 'rgba(140, 180, 240, 0.09)'; ctx.lineWidth = 1;
  const step = zoom > 8 ? 2 : zoom > 3 ? 5 : 15;
  ctx.beginPath();
  if (zoom <= 12) {
  for (let lng = -180; lng < 180; lng += step) line(ctx, project, Array.from({ length: 73 }, (_, i) => [lng, -90 + i * 2.5]));
  for (let lat = -90 + step; lat < 90; lat += step) line(ctx, project, Array.from({ length: 145 }, (_, i) => [-180 + i * 2.5, lat]));
  }
  ctx.stroke();
  // Land, then the result over it.
  ctx.beginPath();
  for (const g of globe.land) tracePolygons(ctx, g, project);
  ctx.fillStyle = LAND; ctx.fill('evenodd');
  ctx.strokeStyle = LAND_LINE; ctx.lineWidth = 0.8; ctx.stroke();
  for (const s of globe.shapes) {
    ctx.beginPath();
    tracePolygons(ctx, s.geometry, project);
    ctx.fillStyle = s.fill; ctx.fill('evenodd');
    ctx.strokeStyle = s.stroke ?? 'rgba(235, 244, 255, 0.55)'; ctx.lineWidth = s.width ?? 1; ctx.stroke();
  }
  for (const p of globe.points) {
    const [px, py, front] = project(p.at);
    if (!front) continue;
    ctx.fillStyle = withAlpha(p.color, 0.22);
    ctx.beginPath(); ctx.arc(px, py, p.r * 2.6, 0, Math.PI * 2); ctx.fill();
  }
  for (const p of globe.points) {
    const [px, py, front] = project(p.at);
    if (!front) continue;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(px, py, p.r, 0, Math.PI * 2); ctx.fill();
  }
  // Night side and depth: darker toward the lower right edge.
  const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.2, x, y, r);
  shade.addColorStop(0, 'rgba(255, 255, 255, 0.05)'); shade.addColorStop(0.6, 'rgba(2, 6, 18, 0.05)'); shade.addColorStop(1, 'rgba(2, 6, 18, 0.62)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
  // The rim.
  ctx.strokeStyle = 'rgba(150, 196, 255, 0.55)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, project: ReturnType<typeof projector>['project'], pts: number[][]) {
  let down = false;
  for (const pt of pts) {
    const [px, py, front] = project(pt);
    if (!front) { down = false; continue; }
    if (down) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    down = true;
  }
}
function withAlpha(hex: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---- Text ---------------------------------------------------------------------------------------------------------------------------
function text(ctx: CanvasRenderingContext2D, t: TextItem | { text: string; x: number; y: number; font: Font; color: keyof typeof INK }) {
  ctx.font = fontCss(t.font);
  ctx.fillStyle = INK[t.color];
  if (!t.font.tracking) { ctx.fillText(t.text, t.x, t.y); return; }
  let x = t.x;
  for (const ch of t.text) { ctx.fillText(ch, x, t.y); x += ctx.measureText(ch).width + t.font.tracking; }
}

function glyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.strokeStyle = INK.accent; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.42, r, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  ctx.restore();
}

async function drawLayout(ctx: CanvasRenderingContext2D, layout: CardLayout) {
  ctx.textBaseline = 'alphabetic';
  glyph(ctx, CARD.x + 14, 80, 13);
  for (const t of layout.texts) text(ctx, t);
  ctx.fillStyle = 'rgba(160, 190, 230, 0.22)';
  for (const d of layout.dividers) ctx.fillRect(d.x, d.y, 1, d.h);
  if (layout.strip) {
    const { x, y, size, gap, colors } = layout.strip;
    colors.forEach((c, i) => { ctx.fillStyle = c; roundRect(ctx, x + i * (size + gap), y, size, size, 5); ctx.fill(); });
  }
  if (layout.flag) {
    const { x, y, w, h, iso2 } = layout.flag;
    const img = await loadImage(flagUrl(iso2)).catch(() => null);
    if (img) {
      ctx.save();
      roundRect(ctx, x, y, w, h, 5); ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = 'rgba(230, 240, 255, 0.35)'; ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5); ctx.stroke();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}

// The link preview: brand, line and site.
function brand(ctx: CanvasRenderingContext2D, site: string) {
  const x = CARD.x;
  glyph(ctx, x + 14, 80, 13);
  text(ctx, { text: 'ATLAS', x: x + 40, y: 88, font: { weight: 700, size: 24, family: 'display', tracking: 7 }, color: 'ink' });
  text(ctx, { text: 'A GEOGRAPHY GAME ON A 3D GLOBE', x, y: 200, font: { weight: 700, size: 17, family: 'body', tracking: 2.4 }, color: 'accent' });
  text(ctx, { text: 'Master', x: x - 3, y: 300, font: { weight: 700, size: 92, family: 'display' }, color: 'ink' });
  text(ctx, { text: 'the World', x: x - 3, y: 392, font: { weight: 700, size: 92, family: 'display' }, color: 'gold' });
  text(ctx, { text: '200 countries · their flags · their regions · their cities', x, y: 452, font: { weight: 500, size: 22, family: 'body' }, color: 'ink2' });
  text(ctx, { text: 'Play free in your browser', x, y: 560, font: { weight: 600, size: 24, family: 'display' }, color: 'ink' });
  text(ctx, { text: site, x, y: 596, font: { weight: 600, size: 17, family: 'body', tracking: 1 }, color: 'accent' });
}
