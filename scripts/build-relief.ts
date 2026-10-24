// Builds public/data/relief.webp: a transparent light-and-shadow overlay from Natural Earth's 1:50m gray shaded relief.
// Run with `npm run relief`, after `npm run data` (the shading is masked to the land in countries.topo.json).
// The globe draws it over the country colours to give terrain depth without photo textures.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

const URL = 'https://naciscdn.org/naturalearth/50m/raster/GRAY_50M_SR.zip';
const ZIP = 'data-raw/GRAY_50M_SR.zip';
const TIF = 'data-raw/GRAY_50M_SR/GRAY_50M_SR.tif';
const OUT = 'public/data/relief.webp';
// Output is 2048² (about 16 MB of GPU memory); detail beyond that is not visible at globe zooms.
const SIZE = 2048;
// A third of the 10800×5400 source in each direction.
const EW = 3600, EH = 1800;
// Differences smaller than this are flat ground or ocean and stay fully transparent.
const DEAD_ZONE = 2;

if (!existsSync(TIF)) {
  mkdirSync('data-raw', { recursive: true });
  if (!existsSync(ZIP)) {
    console.log(`Downloading ${URL}`);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    writeFileSync(ZIP, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('unzip', ['-o', '-q', ZIP, '-d', 'data-raw/GRAY_50M_SR']);
}

// Land, as the globe draws it (countries.topo.json), rasterised into two masks: one on the equirectangular source grid for
// the shading, one on the Web Mercator output grid for the final cut-out.
const LIMIT = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI, FADE_DEG = 1.5;
const topo = JSON.parse(readFileSync('public/data/countries.topo.json', 'utf8')) as Topology<{ countries: GeometryCollection }>;
const land = (feature(topo, topo.objects.countries) as GeoJSON.FeatureCollection).features;
async function landMask(width: number, height: number, y: (lat: number) => number): Promise<Float32Array> {
  const ring = (r: number[][]) => `M${r.map(([lng, lat]) => `${(((lng + 180) / 360) * width).toFixed(2)},${y(lat).toFixed(2)}`).join('L')}Z`;
  const d = land.map(f => {
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(p => p.map(ring).join('')).join('');
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="#fff" fill-rule="evenodd" d="${d}"/></svg>`;
  const a = await sharp(Buffer.from(svg)).extractChannel(3).raw().toBuffer();
  return Float32Array.from(a, v => v / 255);
}
const equiMask = await landMask(EW, EH, lat => ((90 - lat) / 180) * EH);
const mercY = (lat: number) => { const c = (Math.max(-LIMIT, Math.min(LIMIT, lat)) * Math.PI) / 180; return ((1 - Math.log(Math.tan(Math.PI / 4 + c / 2)) / Math.PI) / 2) * SIZE; };
const mercMask = await landMask(SIZE, SIZE, mercY);

// Separable Gaussian blur on floats. Wraps east–west (±180° are neighbours) and clamps at the poles.
function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0), kn = k.map(v => v / sum);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += src[y * w + ((x + i + w) % w)] * kn[i + r];
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * kn[i + r];
    out[y * w + x] = v;
  }
  return out;
}

// Shading = the image minus the local average of the land around it: slopes facing the light come out positive, shadows
// negative, flat ground near zero. The average is taken over land only (a masked, normalised blur). A plain blur mixes in
// the sea's flat tone, which washes every small island in a uniform white or black blob (up to 50% over the Solomon
// Islands and Fiji, 45% black over Cabo Verde) that hides its colour and says nothing about its terrain.
const equi = Float32Array.from(await sharp(TIF).greyscale().resize(EW, EH, { fit: 'fill', kernel: 'mitchell' }).raw().toBuffer());
const weighted = blur(equi.map((v, k) => v * equiMask[k]), EW, EH, 3.5), weight = blur(equiMask, EW, EH, 3.5);
const shade = new Float32Array(EW * EH);
for (let k = 0; k < shade.length; k++) shade[k] = equiMask[k] > 0 && weight[k] > 1e-3 ? equi[k] - weighted[k] / weight[k] : 0;
// The image ends at the Web Mercator limit (±85.05°), and MapLibre's globe does not extend image sources over the polar
// caps. Shading fades out over the last FADE_DEG of latitude so the land carries on into the cap without a hard ring.
const edgeFade = (lat: number) => { const t = Math.min(1, Math.max(0, (LIMIT - Math.abs(lat)) / FADE_DEG)); return t * t * (3 - 2 * t); };

// MapLibre image sources are placed in Web Mercator, so rows are resampled from latitude. Shading is cut to the land
// outline (the source also shades ice shelves, which the borders leave as sea, and has a hard tonal step across the
// Ross Ice Shelf at about 177.5°E and 177.5°W that shading would turn into two straight lines).
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let j = 0; j < SIZE; j++) {
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (j + 0.5)) / SIZE))) * 180) / Math.PI;
  const sy = Math.min(EH - 1, Math.max(0, ((90 - lat) / 180) * EH - 0.5));
  const y0 = Math.floor(sy), y1 = Math.min(EH - 1, y0 + 1), ty = sy - y0;
  for (let i = 0; i < SIZE; i++) {
    const sx = Math.min(EW - 1, ((i + 0.5) / SIZE) * EW - 0.5), x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(EW - 1, x0 + 1), tx = sx - x0;
    const at = (x: number, y: number) => shade[y * EW + x];
    const d = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
    if (Math.abs(d) < DEAD_ZONE) continue;
    const o = (j * SIZE + i) * 4, m = Math.abs(d) - DEAD_ZONE;
    const fade = edgeFade(lat) * mercMask[j * SIZE + i];
    if (d < 0) { rgba[o] = 2; rgba[o + 1] = 8; rgba[o + 2] = 24; rgba[o + 3] = Math.round(Math.min(1, m / 18) * 0.8 * 255 * fade); }
    else { rgba[o] = rgba[o + 1] = rgba[o + 2] = 255; rgba[o + 3] = Math.round(Math.min(1, m / 18) * 0.5 * 255 * fade); }
  }
}
await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 80, alphaQuality: 85 }).toFile(OUT);
console.log(`Wrote ${OUT} (${SIZE}×${SIZE}, Web Mercator).`);
