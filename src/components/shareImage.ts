// A City Rush result as a 1200×630 PNG (the usual link-preview size): the country's real outline from the map data and a
// dot at the real position of every city found. Drawn on a plain canvas, so it needs no library and no copy of the WebGL
// map (which would need preserveDrawingBuffer for the whole game).
import type { LngLat } from '../game/geo';

export type ShareImageInput = {
  title: string;          // "CITY RUSH"
  countryName: string;
  big: string;            // "42.8%"
  label: string;          // "city population coverage"
  detail: string;         // "38 cities · 5 minutes"
  site: string;           // the site's host, shown small
  shape: GeoJSON.Geometry | null;
  frame: { center: LngLat; radiusKm: number };
  cities: LngLat[];
};

const W = 1200, H = 630;

export async function renderShareImage(p: ShareImageInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  try { await document.fonts?.ready; } catch { /* fonts are a nicety */ }

  const bg = ctx.createRadialGradient(W * 0.68, H * 0.5, 40, W * 0.68, H * 0.5, W * 0.75);
  bg.addColorStop(0, '#0a1d3c'); bg.addColorStop(0.6, '#040c1d'); bg.addColorStop(1, '#030a18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // The map area: the country's frame (its cities, without far outliers) in a simple projection, x scaled by cos(latitude)
  // at the centre, which is faithful enough at country size. Longitudes are unwrapped around the centre, so a country
  // across 180° stays in one piece.
  const box = { x: 470, y: 40, w: 690, h: 550 };
  const [cx, cy] = p.frame.center, k = Math.cos((cy * Math.PI) / 180);
  const spanDeg = (p.frame.radiusKm / 111.2) * 1.08;
  const scale = Math.min(box.w / (2 * spanDeg * k), box.h / (2 * spanDeg));
  const unwrap = (lng: number) => lng - 360 * Math.round((lng - cx) / 360);
  const project = ([lng, lat]: LngLat): [number, number] => [box.x + box.w / 2 + (unwrap(lng) - cx) * k * scale, box.y + box.h / 2 - (lat - cy) * scale];

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x - 20, box.y - 20, box.w + 40, box.h + 40);
  ctx.clip();
  if (p.shape && (p.shape.type === 'Polygon' || p.shape.type === 'MultiPolygon')) {
    const polys = p.shape.type === 'Polygon' ? [p.shape.coordinates] : p.shape.coordinates;
    ctx.beginPath();
    for (const poly of polys) for (const ring of poly) {
      ring.forEach((pt, i) => { const [x, y] = project(pt as LngLat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }
    ctx.fillStyle = '#1d4f9a';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(226, 238, 255, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  // Dots, smaller when there are many so a big haul still reads as a map, not a blob.
  const r = p.cities.length > 800 ? 1.6 : p.cities.length > 200 ? 2.3 : 3.4;
  ctx.fillStyle = 'rgba(255, 207, 92, 0.25)';
  for (const c of p.cities) { const [x, y] = project(c); ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ffcf5c';
  for (const c of p.cities) { const [x, y] = project(c); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();

  // Text column.
  const ink = '#e5f1ff', ink2 = '#a6b8d6', accent = '#7fb0fb';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = '700 22px "DM Sans", system-ui, sans-serif';
  ctx.fillText(`ATLAS · ${p.title}`, 64, 112);
  ctx.fillStyle = ink;
  ctx.font = '600 52px "Space Grotesk", system-ui, sans-serif';
  wrap(ctx, p.countryName, 64, 182, 380, 58);
  ctx.font = '700 104px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = '#ffcf5c';
  fit(ctx, p.big, 380, 104, '700', '"Space Grotesk", system-ui, sans-serif');
  ctx.fillText(p.big, 64, 390);
  ctx.font = '600 30px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = ink;
  fit(ctx, p.label, 380, 30, '600', '"Space Grotesk", system-ui, sans-serif');
  ctx.fillText(p.label, 64, 434);
  ctx.fillStyle = ink2;
  ctx.font = '500 26px "DM Sans", system-ui, sans-serif';
  ctx.fillText(p.detail, 64, 478);
  ctx.fillStyle = accent;
  ctx.font = '600 22px "DM Sans", system-ui, sans-serif';
  ctx.fillText(p.site, 64, 570);

  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not draw the image.'))), 'image/png'));
}

// Shrinks the font until the text fits the column.
function fit(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight: string, family: string) {
  while (size > 12 && ctx.measureText(text).width > max) { size -= 2; ctx.font = `${weight} ${size}px ${family}`; }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number) {
  const words = text.split(' ');
  let row = '', n = 0;
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (ctx.measureText(next).width > max && row) { ctx.fillText(row, x, y + n * line); row = w; n++; } else row = next;
  }
  if (row) ctx.fillText(row, x, y + n * line);
}

