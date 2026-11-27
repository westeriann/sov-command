// Troops, ships and aircraft in the "bold toon" style: detailed shapes, two-step
// shading and a dark ink outline round every part, in bright nation colour.
// EVERY troop model (present and future) is made here, the same way:
//   - parts are built with P(shape, paint, at, rot) in model units (+X forward, +Y up,
//     a vehicle about one unit long);
//   - paints: 'paint' (nation colour), 'paint2' (darker nation colour, for detail),
//     'dark', 'steel', 'glass', 'skin', 'light' (pale grey), 'glow';
//   - toonModel(parts) gives the merged shape and its ink shell.
// Only the nation's paints take the per-instance colour (the `paintMask`
// attribute); the rest keep their own colour, so tracks, rifles and glass stay dark.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Paint = 'paint' | 'paint2' | 'dark' | 'steel' | 'glass' | 'skin' | 'light' | 'glow';
interface ToonPart { geo: THREE.BufferGeometry; paint: Paint; at: [number, number, number]; rot: [number, number, number] }

const P = (geo: THREE.BufferGeometry, paint: Paint, at: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]): ToonPart => ({ geo, paint, at, rot });

const G = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt: number, rb: number, h: number, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s),
  ball: (r: number, s = 12) => new THREE.SphereGeometry(r, s, Math.max(6, s - 4)),
  cone: (r: number, h: number, s = 12) => new THREE.ConeGeometry(r, h, s),
  dome: (r: number, s = 12) => new THREE.SphereGeometry(r, s, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  /** A flat outline (x, z) raised to a height. */
  slab(points: [number, number][], h: number) {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z))), { depth: h, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, h, 0);
    return g;
  },
  /** A side profile (x, y) given a thickness. */
  plate(points: [number, number][], t: number) {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    return g;
  },
};

// vertex colour and how much of the nation colour each paint takes
const PAINTS: Record<Paint, [string, number]> = {
  paint: ['#ffffff', 1], paint2: ['#b3b3b3', 1],
  dark: ['#2a2c2e', 0], steel: ['#5d6268', 0], glass: ['#3c5a70', 0], skin: ['#c99f78', 0], light: ['#c9ccd0', 0], glow: ['#ffb85a', 0],
};
// at sea the hull is a grey with a share of the nation colour
const SEA_PAINTS: Partial<Record<Paint, [string, number]>> = { paint: ['#b8c0c8', 0.45], paint2: ['#8d969e', 0.4] };

/** The ink round a part: a shell a little larger than it, at least INK model units thick. */
const INK = 0.008;
const INK_SCALE = 1.045;

/** Merge parts into one shape (with colour and paint mask) and its ink shell. */
export function toonModel(parts: ToonPart[], sea = false): { geo: THREE.BufferGeometry; ink: THREE.BufferGeometry } {
  const solid: THREE.BufferGeometry[] = [], shell: THREE.BufferGeometry[] = [];
  const c = new THREE.Vector3(), size = new THREE.Vector3();
  for (const p of parts) {
    let g = p.geo;
    g.rotateX(p.rot[0]); g.rotateY(p.rot[1]); g.rotateZ(p.rot[2]);
    g.translate(p.at[0], p.at[1], p.at[2]);
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const [hex, mask] = (sea && SEA_PAINTS[p.paint]) || PAINTS[p.paint];
    const col = new THREE.Color(hex);
    const n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3), masks = new Float32Array(n);
    for (let i = 0; i < n; i++) { cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b; masks[i] = mask; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setAttribute('paintMask', new THREE.BufferAttribute(masks, 1));
    solid.push(g);
    if (p.paint === 'glow') continue; // lights have no ink
    // the ink: the same part, grown about its own centre so the line sits evenly round it
    const ink = g.clone();
    ink.deleteAttribute('color'); ink.deleteAttribute('paintMask');
    ink.computeBoundingBox();
    ink.boundingBox!.getCenter(c); ink.boundingBox!.getSize(size);
    const k = (d: number) => (d < 1e-4 ? 1 : Math.max(INK_SCALE, (d + 2 * INK) / d));
    ink.translate(-c.x, -c.y, -c.z); ink.scale(k(size.x), k(size.y), k(size.z)); ink.translate(c.x, c.y, c.z);
    shell.push(ink);
  }
  const geo = mergeGeometries(solid, false)!;
  geo.computeVertexNormals();
  const ink = mergeGeometries(shell, false)!;
  ink.computeVertexNormals();
  return { geo, ink };
}

// ---- the models -------------------------------------------------------------------

function soldier(x: number, z: number, kneel = false): ToonPart[] {
  const k = kneel ? -0.07 : 0, parts: ToonPart[] = [];
  parts.push(P(G.box(0.045, kneel ? 0.07 : 0.13, 0.045), 'paint2', [x, kneel ? 0.035 : 0.075, z + 0.028]));
  parts.push(P(G.box(0.045, 0.13, 0.045), 'paint2', [x + (kneel ? 0.05 : 0), kneel ? 0.1 : 0.075, z - 0.028], kneel ? [0, 0, 0.9] : [0, 0, 0]));
  parts.push(P(G.box(0.05, 0.025, 0.05), 'dark', [x + 0.01, 0.012, z + 0.028]), P(G.box(0.05, 0.025, 0.05), 'dark', [x + 0.01 + (kneel ? 0.1 : 0), 0.012, z - 0.028]));
  parts.push(P(G.box(0.08, 0.13, 0.1), 'paint', [x, 0.21 + k, z]));
  parts.push(P(G.box(0.09, 0.08, 0.11), 'paint2', [x + 0.003, 0.22 + k, z]));
  parts.push(P(G.box(0.05, 0.09, 0.08), 'paint2', [x - 0.06, 0.22 + k, z]));
  parts.push(P(G.cyl(0.018, 0.016, 0.1, 6), 'paint', [x + 0.04, 0.21 + k, z + 0.06], [0.2, 0, -0.9]));
  parts.push(P(G.cyl(0.018, 0.016, 0.1, 6), 'paint', [x + 0.05, 0.2 + k, z - 0.055], [-0.2, 0, -1.1]));
  parts.push(P(G.ball(0.034, 10), 'skin', [x + 0.005, 0.315 + k, z]));
  parts.push(P(G.dome(0.045), 'paint2', [x, 0.325 + k, z]));
  parts.push(P(G.cyl(0.052, 0.052, 0.006, 12), 'paint2', [x, 0.325 + k, z]));
  parts.push(P(G.box(0.2, 0.022, 0.018), 'dark', [x + 0.07, 0.22 + k, z + 0.075], [0, 0, 0.35]));
  parts.push(P(G.box(0.03, 0.05, 0.014), 'dark', [x + 0.04, 0.19 + k, z + 0.075], [0, 0, 0.35]));
  return parts;
}

/** Tracks, skirts and road wheels down both sides. */
function running(len: number, wheels: number, y = 0.07, half = 0.24): ToonPart[] {
  const p: ToonPart[] = [];
  for (const s of [-1, 1]) {
    p.push(P(G.box(len, 0.13, 0.1), 'dark', [0, 0.075, s * half]));
    p.push(P(G.plate([[-len / 2, 0.14], [len / 2 - 0.04, 0.14], [len / 2, 0.21], [-len / 2, 0.21]], 0.02), 'paint2', [0, 0, s * (half + 0.055)]));
    const step = (len - 0.24) / (wheels - 1);
    for (let i = 0; i < wheels; i++) p.push(P(G.cyl(0.055, 0.055, 0.03, 14), 'steel', [-(len - 0.24) / 2 + i * step, y, s * (half + 0.05)], [Math.PI / 2, 0, 0]));
    p.push(P(G.cyl(0.05, 0.05, 0.035, 8), 'dark', [len / 2 - 0.02, 0.11, s * (half + 0.04)], [Math.PI / 2, 0, 0]));
  }
  return p;
}

/** The turret's own height: it is drawn as a separate model this far above the hull. */
export const TURRET_Y = 0.32;

export const TOON = {
  soldier: () => toonModel(soldier(0, 0)),
  tankHull: () => toonModel([
    P(G.box(0.86, 0.12, 0.38), 'paint', [0, 0.16, 0]),
    P(G.plate([[-0.46, 0.1], [0.36, 0.1], [0.5, 0.17], [0.36, 0.26], [-0.44, 0.26]], 0.42), 'paint', [0, 0, 0]),
    P(G.box(0.2, 0.03, 0.34), 'paint2', [-0.3, 0.27, 0]),
    ...[-1, 1].map((s) => P(G.box(0.18, 0.06, 0.06), 'paint2', [-0.2, 0.3, s * 0.15])),
    ...running(0.98, 6),
  ]),
  // turned about its ring: model y 0 is the hull roof
  tankTurret: () => toonModel([
    P(G.plate([[-0.26, 0], [0.12, 0], [0.26, 0.05], [0.24, 0.11], [-0.24, 0.12]], 0.36), 'paint', [0, 0.27 - TURRET_Y, 0]),
    P(G.box(0.16, 0.08, 0.3), 'paint2', [-0.3, 0.33 - TURRET_Y, 0]),
    P(G.box(0.06, 0.09, 0.12), 'paint', [0.27, 0.33 - TURRET_Y, 0]),
    P(G.cyl(0.022, 0.026, 0.62, 12), 'dark', [0.58, 0.34 - TURRET_Y, 0], [0, 0, Math.PI / 2]),
    P(G.cyl(0.034, 0.034, 0.08, 12), 'dark', [0.52, 0.34 - TURRET_Y, 0], [0, 0, Math.PI / 2]),
    P(G.cyl(0.032, 0.032, 0.05, 12), 'dark', [0.86, 0.34 - TURRET_Y, 0], [0, 0, Math.PI / 2]),
    P(G.cyl(0.05, 0.055, 0.05, 12), 'paint2', [-0.06, 0.42 - TURRET_Y, 0.08]),
    P(G.box(0.12, 0.014, 0.014), 'dark', [0.02, 0.45 - TURRET_Y, 0.08]),
    P(G.cyl(0.004, 0.004, 0.32, 4), 'dark', [-0.32, 0.53 - TURRET_Y, -0.1]),
  ]),
  // an eight-wheeled infantry carrier: a sloped box hull, a small gun turret, a rear door
  apcHull: () => toonModel([
    P(G.plate([[-0.42, 0.12], [0.3, 0.12], [0.44, 0.2], [0.3, 0.32], [-0.42, 0.32]], 0.4), 'paint', [0, 0, 0]),
    P(G.box(0.3, 0.025, 0.36), 'paint2', [-0.18, 0.33, 0]),
    P(G.box(0.02, 0.14, 0.2), 'paint2', [-0.43, 0.22, 0]),
    P(G.cyl(0.07, 0.08, 0.07, 12), 'paint2', [0.05, 0.36, 0]),
    P(G.cyl(0.012, 0.014, 0.32, 8), 'dark', [0.24, 0.37, 0], [0, 0, Math.PI / 2]),
    P(G.box(0.03, 0.03, 0.4), 'dark', [0.38, 0.28, 0]),
    ...[-0.3, -0.12, 0.08, 0.26].flatMap((x) => [-1, 1].map((s) => P(G.cyl(0.075, 0.075, 0.05, 14), 'dark', [x, 0.08, s * 0.21], [Math.PI / 2, 0, 0]))),
    ...[-0.3, -0.12, 0.08, 0.26].flatMap((x) => [-1, 1].map((s) => P(G.cyl(0.035, 0.035, 0.055, 10), 'steel', [x, 0.08, s * 0.215], [Math.PI / 2, 0, 0]))),
    P(G.cyl(0.004, 0.004, 0.26, 4), 'dark', [-0.32, 0.46, 0.12]),
  ]),
  destroyer: () => toonModel([
    P(G.slab([[-0.66, -0.12], [0.3, -0.13], [0.62, -0.06], [0.76, 0], [0.62, 0.06], [0.3, 0.13], [-0.66, 0.12]], 0.14), 'paint', [0, 0, 0]),
    P(G.slab([[-0.66, -0.125], [0.3, -0.135], [0.62, -0.065], [0.76, 0], [0.62, 0.065], [0.3, 0.135], [-0.66, 0.125]], 0.02), 'dark', [0, -0.005, 0]),
    P(G.box(1.36, 0.006, 0.2), 'paint2', [0.03, 0.142, 0]),
    P(G.box(0.34, 0.12, 0.17), 'light', [0.06, 0.2, 0]),
    P(G.box(0.18, 0.08, 0.15), 'light', [0.1, 0.3, 0]),
    P(G.box(0.02, 0.025, 0.14), 'glass', [0.19, 0.31, 0]),
    P(G.cyl(0.01, 0.014, 0.34, 6), 'dark', [0.08, 0.5, 0]),
    P(G.box(0.012, 0.06, 0.12), 'dark', [0.08, 0.58, 0]),
    P(G.box(0.08, 0.01, 0.01), 'dark', [0.08, 0.48, 0]),
    P(G.box(0.12, 0.1, 0.1), 'light', [-0.22, 0.2, 0]),
    P(G.cyl(0.035, 0.045, 0.12, 10), 'dark', [-0.22, 0.31, 0]),
    P(G.cyl(0.05, 0.06, 0.05, 12), 'light', [0.42, 0.17, 0]),
    P(G.cyl(0.01, 0.012, 0.16, 8), 'dark', [0.51, 0.18, 0], [0, 0, Math.PI / 2]),
    P(G.box(0.1, 0.012, 0.12), 'dark', [0.28, 0.15, 0]),
    P(G.cyl(0.075, 0.075, 0.004, 20), 'light', [-0.5, 0.146, 0]),
  ], true),
  // a long dark hull riding low, the sail in nation colour, hydroplanes and a cross tail
  submarine: () => {
    const hull = G.cyl(0.085, 0.085, 0.96, 14); hull.rotateZ(Math.PI / 2);
    return toonModel([
      P(hull, 'dark', [0, 0.04, 0]),
      P(G.ball(0.085, 14), 'dark', [0.48, 0.04, 0]),
      P(G.cone(0.085, 0.24, 14), 'dark', [-0.6, 0.04, 0], [0, 0, Math.PI / 2]),
      P(G.plate([[-0.1, 0], [0.12, 0], [0.1, 0.15], [-0.06, 0.15]], 0.06), 'paint', [0.12, 0.1, 0]),
      P(G.box(0.08, 0.008, 0.24), 'paint2', [0.14, 0.21, 0]),
      P(G.box(0.1, 0.008, 0.26), 'dark', [-0.64, 0.04, 0]),
      P(G.box(0.1, 0.22, 0.008), 'dark', [-0.64, 0.04, 0]),
      P(G.cyl(0.006, 0.006, 0.1, 4), 'steel', [0.14, 0.3, 0.015]),
      P(G.box(0.9, 0.006, 0.05), 'paint2', [0, 0.126, 0]),
    ], true);
  },
  // a flat deck with the island to starboard, deck markings and parked jets
  carrier: () => toonModel([
    P(G.slab([[-0.78, -0.17], [0.5, -0.18], [0.8, -0.08], [0.86, 0], [0.8, 0.08], [0.5, 0.18], [-0.78, 0.17]], 0.16), 'paint', [0, 0, 0]),
    P(G.slab([[-0.82, -0.26], [0.84, -0.22], [0.9, 0], [0.84, 0.2], [-0.82, 0.2]], 0.025), 'steel', [0, 0.16, 0]),
    P(G.box(1.5, 0.004, 0.012), 'light', [0, 0.187, -0.02]),
    P(G.box(0.7, 0.004, 0.012), 'light', [-0.1, 0.187, 0.1], [0, 0.18, 0]),
    P(G.box(0.24, 0.16, 0.08), 'light', [-0.05, 0.265, 0.19]),
    P(G.box(0.12, 0.08, 0.07), 'light', [-0.02, 0.37, 0.19]),
    P(G.box(0.02, 0.025, 0.07), 'glass', [0.05, 0.37, 0.19]),
    P(G.cyl(0.008, 0.01, 0.16, 6), 'dark', [-0.04, 0.48, 0.19]),
    ...[-0.55, -0.4].map((x) => P(G.slab([[0.08, 0], [-0.06, 0.07], [-0.08, 0.07], [-0.06, 0], [-0.08, -0.07], [-0.06, -0.07]], 0.012), 'paint2', [x, 0.188, -0.12])),
  ], true),
  jet: () => {
    const p: ToonPart[] = [
      P(G.cyl(0.045, 0.055, 0.66, 12), 'paint', [-0.02, 0, 0], [0, 0, Math.PI / 2]),
      P(G.cone(0.045, 0.22, 12), 'paint', [0.42, 0, 0], [0, 0, -Math.PI / 2]),
      P(G.dome(0.05, 14), 'glass', [0.2, 0.03, 0]),
      P(G.slab([[0.18, 0.05], [-0.26, 0.48], [-0.34, 0.48], [-0.3, 0.05]], 0.016), 'paint', [0, -0.012, 0]),
      P(G.slab([[0.18, -0.05], [-0.26, -0.48], [-0.34, -0.48], [-0.3, -0.05]], 0.016), 'paint', [0, -0.012, 0]),
      P(G.slab([[-0.24, 0.05], [-0.4, 0.2], [-0.45, 0.2], [-0.42, 0.05]], 0.012), 'paint2', [0, -0.008, 0]),
      P(G.slab([[-0.24, -0.05], [-0.4, -0.2], [-0.45, -0.2], [-0.42, -0.05]], 0.012), 'paint2', [0, -0.008, 0]),
    ];
    for (const s of [-1, 1]) {
      p.push(P(G.plate([[-0.42, 0], [-0.24, 0], [-0.36, 0.17], [-0.42, 0.17]], 0.01), 'paint2', [0, 0.03, s * 0.05], [s * 0.35, 0, 0]));
      p.push(P(G.box(0.16, 0.05, 0.035), 'paint2', [0.05, -0.02, s * 0.06]));
      p.push(P(G.cyl(0.024, 0.028, 0.06, 12), 'dark', [-0.38, -0.005, s * 0.025], [0, 0, Math.PI / 2]));
      p.push(P(G.cyl(0.018, 0.018, 0.02, 12), 'glow', [-0.415, -0.005, s * 0.025], [0, 0, Math.PI / 2]));
    }
    return toonModel(p);
  },
  // a heavy bomber: long body, swept wings with four engines, a tall fin
  bomber: () => {
    const p: ToonPart[] = [
      P(G.cyl(0.06, 0.065, 0.92, 14), 'paint', [0, 0, 0], [0, 0, Math.PI / 2]),
      P(G.cone(0.06, 0.2, 14), 'paint', [0.56, 0, 0], [0, 0, -Math.PI / 2]),
      P(G.cone(0.065, 0.16, 14), 'paint', [-0.54, 0.005, 0], [0, 0, Math.PI / 2]),
      P(G.box(0.06, 0.03, 0.08), 'glass', [0.5, 0.045, 0]),
      P(G.slab([[0.14, 0.05], [-0.18, 0.62], [-0.26, 0.62], [-0.1, 0.05]], 0.02), 'paint', [0, -0.01, 0]),
      P(G.slab([[0.14, -0.05], [-0.18, -0.62], [-0.26, -0.62], [-0.1, -0.05]], 0.02), 'paint', [0, -0.01, 0]),
      P(G.slab([[-0.42, 0.04], [-0.54, 0.22], [-0.59, 0.22], [-0.56, 0.04]], 0.014), 'paint2', [0, 0.01, 0]),
      P(G.slab([[-0.42, -0.04], [-0.54, -0.22], [-0.59, -0.22], [-0.56, -0.04]], 0.014), 'paint2', [0, 0.01, 0]),
      P(G.plate([[-0.6, 0], [-0.4, 0], [-0.54, 0.22], [-0.62, 0.22]], 0.014), 'paint2', [0, 0.04, 0]),
    ];
    for (const z of [-0.42, -0.22, 0.22, 0.42]) {
      const x = 0.02 - Math.abs(z) * 0.5;
      p.push(P(G.cyl(0.03, 0.03, 0.14, 12), 'dark', [x, -0.04, z], [0, 0, Math.PI / 2]));
      p.push(P(G.cyl(0.02, 0.02, 0.012, 10), 'glow', [x - 0.075, -0.04, z], [0, 0, Math.PI / 2]));
    }
    return toonModel(p);
  },
  // a long-winged surveillance drone with a bulbous sensor nose and a V tail
  drone: () => toonModel([
    P(G.cyl(0.03, 0.025, 0.5, 12), 'paint', [0, 0, 0], [0, 0, Math.PI / 2]),
    P(G.ball(0.045, 12), 'paint', [0.25, 0.01, 0]),
    P(G.ball(0.025, 10), 'glass', [0.27, -0.03, 0]),
    P(G.box(0.08, 0.01, 0.9), 'paint', [0.02, 0.01, 0]),
    P(G.box(0.08, 0.008, 0.2), 'paint2', [-0.24, 0.04, 0.06], [0.6, 0, 0]),
    P(G.box(0.08, 0.008, 0.2), 'paint2', [-0.24, 0.04, -0.06], [-0.6, 0, 0]),
    P(G.cyl(0.022, 0.022, 0.06, 10), 'dark', [-0.28, 0, 0], [0, 0, Math.PI / 2]),
  ]),
};
export type ToonKind = keyof typeof TOON;

let ramp: THREE.DataTexture | undefined;
/** Two-step shading (shadow, half-light, full light), as in the mockup. */
function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

/** The toon material: stepped light; only the nation's paints take the instance colour. */
export function toonMaterial() {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paintMask;')
      .replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, paintMask);');
  };
  m.customProgramCacheKey = () => 'toon-paint-mask';
  return m;
}

/** The ink: the shells' back faces in near-black. */
export function inkMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x0a0d12, side: THREE.BackSide });
}

/** The nation's colour as the toon models wear it: brighter and a little richer, as in the mockup. */
export function toonColour(hex: string) {
  return new THREE.Color(hex).offsetHSL(0, 0.15, 0.12);
}
