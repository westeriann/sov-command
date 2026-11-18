// After `vite build --mode offline`: copy the planet's data next to the
// single-player build, with the map tiles packed into a few bundles.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'client/public/world');
const out = join(root, 'client/dist-offline/world');
if (!existsSync(join(src, 'provinces.json'))) {
  console.error('The planet has not been generated: run `npm run world` first.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src)) if (f !== 'tiles') copyFileSync(join(src, f), join(out, f));
execFileSync(process.execPath, [join(root, 'tools/pack-tiles.mjs'), join(src, 'tiles'), out], { stdio: 'inherit' });
// some static hosts serve only known file types: binary data goes out as .bin.wasm (raw bytes either way)
for (const f of readdirSync(out)) if (f.endsWith('.bin')) renameSync(join(out, f), join(out, `${f}.wasm`));
console.log(`single-player build ready in ${join(root, 'client/dist-offline')}`);
