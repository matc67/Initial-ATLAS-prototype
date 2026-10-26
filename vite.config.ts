import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // MapLibre is most of the JavaScript and changes only with a dependency update, so it gets a file of its own:
    // returning players keep it cached across ATLAS releases. It is one ~800 kB library, so the size warning is moved.
    chunkSizeWarningLimit: 1100,
    rollupOptions: { output: { manualChunks: id => (id.includes('node_modules/maplibre-gl') ? 'maplibre' : id.includes('node_modules') ? 'vendor' : undefined) } },
  },
});
