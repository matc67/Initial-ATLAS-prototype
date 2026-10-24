// Checks the built relief overlay (run `npm run relief` after changing scripts/build-relief.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

const file = new URL('../../public/data/relief.webp', import.meta.url).pathname;

test('relief wraps cleanly at 180° and fades out at the Mercator limit', async () => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const alpha = (x: number, y: number) => data[(y * W + x) * C + 3];
  // Across the 180° seam (last column → first column) the shading changes no more than between ordinary neighbours.
  const diff = (a: number, b: number) => { let d = 0; for (let y = 0; y < H; y++) d += Math.abs(alpha(a, y) - alpha(b, y)); return d / H; };
  const typical = (diff(W / 2 - 1, W / 2) + diff(W / 4 - 1, W / 4) + diff(100, 101)) / 3;
  assert.ok(diff(W - 1, 0) <= typical * 2 + 1, `seam ${diff(W - 1, 0).toFixed(2)} vs typical ${typical.toFixed(2)}`);
  // The top and bottom rows (the Mercator limit) are fully transparent, so the polar caps carry on without a ring.
  for (const y of [0, 1, H - 2, H - 1]) for (let x = 0; x < W; x++) assert.equal(alpha(x, y), 0, `row ${y} column ${x}`);
});

test('relief shades land only: the sea (here the Ross Ice Shelf, which the borders leave as sea) stays clear', async () => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const at = (lng: number, lat: number) => {
    const x = Math.floor(((lng + 180) / 360) * W), y = Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * H);
    return data[(y * W + x) * C + 3];
  };
  for (const lng of [177.5, 177.7, -177.4, -177.6]) for (const lat of [-79, -81, -83]) assert.equal(at(lng, lat), 0, `relief over the Ross Ice Shelf at ${lng}, ${lat}`);
  // Mountains still carry shading: the Himalaya and the Andes.
  let shaded = 0;
  for (let lng = 80; lng <= 92; lng += 0.25) shaded += at(lng, 28) > 0 ? 1 : 0;
  for (let lat = -40; lat <= -20; lat += 0.25) shaded += at(-70, lat) > 0 ? 1 : 0;
  assert.ok(shaded > 40, `only ${shaded} shaded samples on the Himalaya and the Andes`);
});
