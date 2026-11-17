import { defineConfig } from 'vite';

const SERVER = process.env.GAME_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  // MapLibre loads its web worker relative to its own module file;
  // pre-bundling moves that file and breaks the worker URL.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    fs: { allow: ['..'] }, // shared/ lives next to client/
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
});
