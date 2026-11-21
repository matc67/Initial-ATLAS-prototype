import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { dataDirOf, dataHash, placeReleaseData } from './scripts/release-data.ts';

// Production builds serve the data from a folder named after its contents (scripts/release-data.ts, src/data/release.ts).
function releaseData(hash: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'atlas-release-data',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { outDir = c.build.outDir; },
    // index.html preloads the country shapes: from this release's folder.
    transformIndexHtml: html => html.replaceAll('href="/data/', `href="/${dataDirOf(hash)}`),
    closeBundle() { placeReleaseData(outDir, hash); },
  };
}

export default defineConfig(({ command }) => {
  const hash = command === 'build' ? dataHash('public/data') : null;
  return {
    plugins: [react(), ...(hash ? [releaseData(hash)] : [])],
    define: hash ? { 'import.meta.env.ATLAS_DATA_DIR': JSON.stringify(dataDirOf(hash)) } : {},
    build: {
      // MapLibre is most of the JavaScript and changes only with a dependency update, so it gets a file of its own:
      // returning players keep it cached across ATLAS releases. It is one ~800 kB library, so the size warning is moved.
      chunkSizeWarningLimit: 1100,
      rollupOptions: { output: { manualChunks: id => (id.includes('node_modules/maplibre-gl') ? 'maplibre' : id.includes('node_modules') ? 'vendor' : undefined) } },
    },
  };
});
