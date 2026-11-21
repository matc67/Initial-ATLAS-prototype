// Draws the site's link-preview image and icons into public/, with the same code that draws result cards
// (src/components/shareCard.ts) and the game's own country shapes and colours. Run with `npm run share-assets` after a
// change to the card design or the map data; the files are committed.
//
//   public/og-image.jpg          1800×945 (1200×630 at 1.5×): what chat apps and social sites show for a link to ATLAS
//   public/apple-touch-icon.png  180×180: the icon iOS uses for links and home-screen shortcuts
//   public/icon-512.png          512×512: the same, large
//
// It starts the Vite dev server, opens it in Playwright's Chromium (a dev dependency already), and draws there.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const SITE = 'atlasxp.netlify.app';
const step = (m: string) => process.env.DEBUG && console.log(`[share-assets] ${m}`);
step('starting vite');
const server = await createServer({ server: { port: 5195, strictPort: false }, logLevel: 'warn' });
await server.listen();
const url = server.resolvedUrls!.local[0];
step(`vite at ${url}`);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  step('browser up');
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  page.on('console', m => step(`page: ${m.text().slice(0, 160)}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  step('page loaded');
  const files = await page.evaluate(async site => {
    const { feature } = await import('/node_modules/topojson-client/src/index.js' as string);
    const card = await import('/src/components/shareCard.ts' as string);
    const { COLORS } = await import('/src/map/GlobeView.ts' as string);
    const topo = await (await fetch('/data/countries.topo.json')).json();
    const fc = feature(topo, topo.objects.countries) as GeoJSON.FeatureCollection;
    const land = fc.features.map(f => f.geometry);
    // The globe as the game first shows it: every country in its own colour from the game's palette.
    const palette: string[] = COLORS.country;
    const shapes = fc.features.filter(f => f.properties?.playable !== false && typeof f.properties?.color === 'number')
      .map(f => ({ geometry: f.geometry, fill: palette[f.properties!.color % palette.length], stroke: 'rgba(10, 20, 40, 0.55)', width: 0.6 }));
    const og = await card.renderBrandCard({ center: [12, 22], radiusKm: null, land, shapes, points: [] }, site);
    // The icon: the ATLAS globe mark on the night sky.
    const icon = (size: number) => new Promise<Blob>((resolve, reject) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const ctx = c.getContext('2d')!, r = size * 0.3, m = size / 2;
      const bg = ctx.createRadialGradient(m, m * 0.9, size * 0.05, m, m, size * 0.75);
      bg.addColorStop(0, '#14366b'); bg.addColorStop(1, '#030914');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#8ab8ff'; ctx.lineWidth = size * 0.045; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(m, m, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(m, m, r * 0.42, r, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m - r, m); ctx.lineTo(m + r, m); ctx.stroke();
      c.toBlob(b => (b ? resolve(b) : reject(new Error('icon'))), 'image/png');
    });
    const b64 = async (b: Blob) => { const a = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s); };
    return { og: await b64(og), touch: await b64(await icon(180)), large: await b64(await icon(512)) };
  }, SITE);
  writeFileSync('public/og-image.jpg', Buffer.from(files.og, 'base64'));
  writeFileSync('public/apple-touch-icon.png', Buffer.from(files.touch, 'base64'));
  writeFileSync('public/icon-512.png', Buffer.from(files.large, 'base64'));
  console.log('Wrote public/og-image.jpg, public/apple-touch-icon.png and public/icon-512.png.');
} finally {
  await browser.close();
  await server.close();
}
