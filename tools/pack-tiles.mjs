// Packs the map's terrain tiles (thousands of small files) into a few bundles
// for hosts that limit file counts, such as the single-player test page.
//
//   node tools/pack-tiles.mjs <tiles dir> <out dir> [name]
//
// Writes <name>-<group>.bin files and <name>-index.json (name defaults to tiles): "z/x/y" -> [file, offset, length].
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [src, out, name = 'tiles'] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node tools/pack-tiles.mjs <tiles dir> <out dir>'); process.exit(1); }
mkdirSync(out, { recursive: true });

// groups keep each bundle well under 16 MB
const groupOf = (z, x) => (z <= 4 ? 'low' : z === 5 ? 'z5' : x < 16 ? 'z6a' : x < 32 ? 'z6b' : x < 48 ? 'z6c' : 'z6d');
const bundles = new Map();
const index = {};
for (const z of readdirSync(src).map(Number).sort((a, b) => a - b)) {
  for (const x of readdirSync(join(src, String(z))).map(Number).sort((a, b) => a - b)) {
    for (const f of readdirSync(join(src, String(z), String(x))).sort()) {
      if (f.startsWith('.')) continue;
      const y = Number(f.split('.')[0]);
      const g = groupOf(z, x);
      if (!bundles.has(g)) bundles.set(g, { parts: [], size: 0 });
      const b = bundles.get(g), data = readFileSync(join(src, String(z), String(x), f));
      index[`${z}/${x}/${y}`] = [g, b.size, data.length];
      b.parts.push(data);
      b.size += data.length;
    }
  }
}
for (const [g, b] of bundles) {
  writeFileSync(join(out, `${name}-${g}.bin`), Buffer.concat(b.parts));
  console.log(`${name}-${g}.bin  ${(b.size / 1e6).toFixed(1)} MB`);
}
writeFileSync(join(out, `${name}-index.json`), JSON.stringify(index));
console.log(`${Object.keys(index).length} tiles indexed`);
