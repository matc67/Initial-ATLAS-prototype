// Builds public/data/relief.webp: a transparent light-and-shadow overlay from Natural Earth's 1:50m gray shaded relief.
// Run with `npm run relief`. The globe draws it over the country colours to give terrain depth without photo textures.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

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

// Shading = the image minus a blurred copy of itself: slopes facing the light come out positive, shadows negative,
// and flat ground of any tone, including the ocean, comes out near zero. Computed on the equirectangular source.
const equi = await sharp(TIF).greyscale().resize(EW, EH, { fit: 'fill', kernel: 'mitchell' }).raw().toBuffer();
// extractChannel keeps the result single-channel; sharp otherwise returns 3 channels from a 1-channel raw input.
const blurred = await sharp(equi, { raw: { width: EW, height: EH, channels: 1 } }).blur(3.5).extractChannel(0).raw().toBuffer();
if (blurred.length !== equi.length) throw new Error(`Blurred relief has ${blurred.length} bytes, expected ${equi.length}.`);
const shade = new Float32Array(EW * EH);
for (let k = 0; k < shade.length; k++) shade[k] = equi[k] - blurred[k];

// MapLibre image sources are placed in Web Mercator, so rows are resampled from latitude.
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
    if (d < 0) { rgba[o] = 2; rgba[o + 1] = 8; rgba[o + 2] = 24; rgba[o + 3] = Math.round(Math.min(1, m / 18) * 0.8 * 255); }
    else { rgba[o] = rgba[o + 1] = rgba[o + 2] = 255; rgba[o + 3] = Math.round(Math.min(1, m / 18) * 0.5 * 255); }
  }
}
await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 80, alphaQuality: 85 }).toFile(OUT);
console.log(`Wrote ${OUT} (${SIZE}×${SIZE}, Web Mercator).`);
