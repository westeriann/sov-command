import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const SERVER = process.env.GAME_SERVER ?? 'http://localhost:8787';
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  // `vite build --mode offline`: the single-player test build. The world simulation
  // runs in the browser, so server modules that touch Node are swapped out.
  const offline = mode === 'offline';
  return {
    base: offline ? './' : '/',
    define: offline ? { 'import.meta.env.VITE_OFFLINE': JSON.stringify('1') } : {},
    publicDir: offline ? false : 'public', // the offline build packs its own copy of the world
    build: offline ? { outDir: 'dist-offline', emptyOutDir: true, chunkSizeWarningLimit: 2000 } : {},
    worker: { format: 'es' },
    resolve: {
      alias: offline ? [
        { find: /^node:(fs|path)$/, replacement: here('./src/offline/node-stub.ts') },
        { find: /^\.\/db\.ts$/, replacement: here('../server/src/schema.ts') },
      ] : [],
    },
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
  };
});
