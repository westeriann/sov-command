// Bundles the world server into one file the desktop app can run with its own
// Node, and copies the multiplayer website next to it:
//   desktop/host/server.mjs   the server
//   desktop/host/site/        the website it serves (client/dist, with the planet)
// Run after `npm run build` (the multiplayer client). Uses the esbuild that tsx brings.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'server', 'node_modules', 'tsx', 'package.json')); // tsx brings esbuild
const esbuild = require('esbuild');
const out = join(root, 'desktop', 'host');
if (!existsSync(join(root, 'client', 'dist', 'index.html'))) throw new Error('Build the multiplayer client first: npm run build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [join(root, 'server', 'src', 'host.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: join(out, 'server.mjs'),
  nodePaths: [join(root, 'server', 'node_modules')],
  // ws has optional native helpers; without them it uses plain JavaScript
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
cpSync(join(root, 'client', 'dist'), join(out, 'site'), { recursive: true });
console.log(`host bundle ready in ${out}`);
