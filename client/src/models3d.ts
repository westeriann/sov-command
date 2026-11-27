// 3D models on the map: troops, ships and aircraft under their counters, city
// skylines, and province buildings, all animated. Drawn with three.js into the
// map's own WebGL context as a MapLibre custom layer.
//
// Models are built from simple shapes in code (no model files), one instanced
// mesh per part, so a whole theatre of war costs a few dozen draw calls.
//
// Placement: MapLibre's main matrix projects the globe as a unit sphere (or,
// on the flat map, web mercator 0..1). Each object gets its own frame on that
// surface (east, up, and south or north), raised to the terrain under it, and
// is drawn relative to a frame at the view centre for float precision.
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TOON, inkMaterial, toonColour, toonMaterial, type ToonKind } from './toon-units';
import type { BuildingType } from '../../shared/buildings';
import { domainOf, UNIT_SPECS, UNIT_TYPES, type UnitType, type UnitView } from '../../shared/military';
import type { CityShape } from './cities';
import { cloudImage, flashImage, hurricaneImage, rainCurtainImage, rainImage } from './weather';
import type { Forces } from './forces';
import type { Game } from './game';
import type { Political } from './political';

type Pos = [number, number];
const R = 6371008.8; // MapLibre's globe radius, metres
const RAD = Math.PI / 180;

/** Zoom where models start to appear, and where they are fully grown. */
export const MODELS_FROM = 3.3;
const CLIP = 0.12;          // how far two core buildings' footprints may overlap, as a share of their size
const SPACING_CELL = 12000; // metres: grid cell for the spacing check
/** A building's size on the ground, metres: big enough to read from the zoom models appear at. */
const BUILDING_M = 9650;
const MODELS_FULL = 3.8;

// ---- geometry -------------------------------------------------------------------

type Part = { g: THREE.BufferGeometry; color: string };

/** A shape, coloured, moved into place: [x, y, z] position, optional rotation (radians, XYZ). */
function part(g: THREE.BufferGeometry, color: string, at: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]): Part {
  g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]);
  g.translate(at[0], at[1], at[2]);
  return { g, color };
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const ball = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
const cone = (r: number, h: number, seg = 10) => new THREE.ConeGeometry(r, h, seg);

/** Merge parts into one geometry with per-vertex colour. */
function build(parts: Part[]): THREE.BufferGeometry {
  const gs = parts.map(({ g, color }) => {
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  merged.computeVertexNormals();
  return merged;
}

// Paint colours: PAINT parts take the nation's colour (tinted per instance), the
// rest are multiplied by it too, so they are kept dark or neutral.
const PAINT = '#ffffff';
const DARK = '#2a2c2e';
const STEEL = '#7d8288';
const CONCRETE = '#b9b4aa';
const GLASS = '#5d7d93';

// Model space: +X forward, +Y up, about one unit long for a vehicle.
const GEOMETRY = {
  // --- troops, ships and aircraft: the bold toon models (toon-units.ts), built there with their ink
  soldier: () => TOON.soldier().geo,
  apcHull: () => TOON.apcHull().geo,
  tankHull: () => TOON.tankHull().geo,
  tankTurret: () => TOON.tankTurret().geo,
  destroyer: () => TOON.destroyer().geo,
  submarine: () => TOON.submarine().geo,
  carrier: () => TOON.carrier().geo,
  jet: () => TOON.jet().geo,
  bomber: () => TOON.bomber().geo,
  drone: () => TOON.drone().geo,
  // --- cities
  tower: () => build([part(box(1, 1, 1), PAINT, [0, 0.5, 0])]),
  roofCap: () => build([part(box(1.04, 0.04, 1.04), '#6b6f73', [0, 1.0, 0])]),
  dome: () => build([
    part(box(1, 0.5, 1), PAINT, [0, 0.25, 0]),
    part(cyl(0.3, 0.32, 0.18, 14), PAINT, [0, 0.59, 0]),
    part(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#b7a46a', [0, 0.68, 0]),
    part(cyl(0.015, 0.015, 0.2, 4), DARK, [0, 1.05, 0]),
  ]),
  // --- buildings
  factory: () => build([
    ...[0, 1, 2].map((i) => part(box(0.32, 0.28, 0.8), '#a59d90', [i * 0.34 - 0.34, 0.14, 0])),
    ...[0, 1, 2].map((i) => part(box(0.05, 0.16, 0.8), '#5f6a72', [i * 0.34 - 0.27, 0.34, 0], [0, 0, 0.6])),
    part(cyl(0.05, 0.07, 0.9, 10), '#8a5a4a', [0.42, 0.45, 0.26]),
    part(cyl(0.05, 0.07, 0.9, 10), '#8a5a4a', [0.42, 0.45, -0.1]),
  ]),
  coalPlant: () => build([
    part(box(0.7, 0.36, 0.5), '#9b968c', [0, 0.18, 0]),
    part(box(0.3, 0.5, 0.3), '#8f8a80', [-0.15, 0.25, 0.28]),
    part(cyl(0.06, 0.1, 1.3, 10), '#b9b2a4', [0.36, 0.65, -0.12]),
    part(cyl(0.065, 0.065, 0.06, 10), '#a3412f', [0.36, 1.22, -0.12]),
    part(cone(0.22, 0.18, 8), '#2b2b2b', [-0.35, 0.09, -0.35]),
  ]),
  gasPlant: () => build([
    part(box(0.6, 0.3, 0.42), '#c2bdb3', [0, 0.15, 0]),
    part(cyl(0.05, 0.05, 0.7, 10), '#d2cec6', [0.25, 0.35, 0.1]),
    part(cyl(0.05, 0.05, 0.7, 10), '#d2cec6', [0.25, 0.35, -0.1]),
    ...[-0.2, 0.05].map((x) => part(cyl(0.12, 0.12, 0.2, 12), '#e0dcd2', [x, 0.1, 0.38])),
  ]),
  coolingTower: () => build([
    part(new THREE.LatheGeometry([0.42, 0.34, 0.28, 0.26, 0.28, 0.31].map((r, i) => new THREE.Vector2(r, i * 0.18)), 18), '#d8d4ca'),
    part(box(0.3, 0.22, 0.3), '#a7a296', [0.62, 0.11, 0]),
    part(cyl(0.12, 0.12, 0.24, 12), '#8f97a0', [0.62, 0.34, 0]),
  ]),
  turbineMast: () => build([
    part(cyl(0.012, 0.025, 0.9, 6), '#e9e9e4', [0, 0.45, 0]),
    part(box(0.08, 0.04, 0.04), '#e9e9e4', [0.02, 0.9, 0]),
  ]),
  // three blades round the hub, turning about the X axis (into the wind)
  turbineRotor: () => build([0, 1, 2].map((i) => ({ g: box(0.012, 0.42, 0.03).translate(0, 0.21, 0).rotateX((i * Math.PI * 2) / 3), color: '#f2f2ee' }))),
  solar: () => build([...[-1, 0, 1].map((i) => part(box(0.5, 0.02, 0.16), '#2b3d5c', [0, 0.06, i * 0.2], [0.35, 0, 0]))]),
  // a ploughed field in its crop colour (tinted per instance), with darker furrows
  field: () => build([
    part(box(0.5, 0.025, 0.42), PAINT, [0, 0.012, 0]),
    ...[-0.15, -0.05, 0.05, 0.15].map((z) => part(box(0.46, 0.012, 0.018), '#bdb6a6', [0, 0.03, z])),
  ]),
  barn: () => build([
    part(box(0.3, 0.2, 0.22), PAINT, [0, 0.1, 0]),
    part(box(0.33, 0.03, 0.16), '#5c5a58', [0, 0.235, 0.055], [0.6, 0, 0]),
    part(box(0.33, 0.03, 0.16), '#5c5a58', [0, 0.235, -0.055], [-0.6, 0, 0]),
    part(cyl(0.06, 0.06, 0.36, 10), '#d8d4cc', [0.24, 0.18, 0.02]),
    part(ball(0.06, 8), '#9aa1a8', [0.24, 0.36, 0.02]),
  ]),
  tree: () => build([
    part(cyl(0.015, 0.02, 0.12, 5), '#5a3e28', [0, 0.06, 0]),
    part(cone(0.09, 0.26, 7), PAINT, [0, 0.24, 0]),
  ]),
  logPile: () => build([
    ...[[0, 0.03], [0.06, 0.03], [-0.06, 0.03], [0.03, 0.08], [-0.03, 0.08]].map(([z, y]) => part(cyl(0.03, 0.03, 0.34, 6), '#8a6440', [0, y, z], [0, 0, Math.PI / 2])),
    part(box(0.26, 0.16, 0.2), '#7a5434', [0.05, 0.08, 0.3]),
    part(box(0.28, 0.02, 0.22), '#4f4a44', [0.05, 0.17, 0.3]),
  ]),
  mine: () => build([
    part(cone(0.42, 0.34, 7), '#7d7466', [-0.3, 0.17, 0.2]),
    part(box(0.36, 0.2, 0.3), '#958c80', [0.25, 0.1, -0.15]),
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z]) => part(cyl(0.012, 0.012, 0.62, 4), STEEL, [0.22 + x * 0.06, 0.31, 0.22 + z * 0.06], [z * 0.08, 0, x * 0.08])),
  ]),
  mineWheel: () => build([
    part(new THREE.TorusGeometry(0.09, 0.012, 4, 14), '#5b6066'),
    part(box(0.18, 0.012, 0.012), '#5b6066'),
    part(box(0.012, 0.18, 0.012), '#5b6066'),
  ]),
  port: () => build([
    part(box(1.1, 0.06, 0.24), CONCRETE, [0, 0.03, 0]),
    part(box(0.24, 0.06, 0.7), CONCRETE, [0.4, 0.03, 0.35]),
    ...[[-0.3, '#b1442f'], [-0.12, '#2f6a8a'], [0.06, '#c7a23a']].map(([x, c]) => part(box(0.14, 0.08, 0.1), c as string, [x as number, 0.1, -0.05])),
    part(box(0.07, 0.5, 0.07), '#c9a23a', [-0.4, 0.25, 0.08]),
  ]),
  craneBoom: () => build([
    part(box(0.6, 0.04, 0.05), '#d4aa3c', [0.18, 0, 0]),
    part(box(0.12, 0.08, 0.1), '#a9852e', [-0.14, 0, 0]),
  ]),
  // a cut through the land: concrete banks, the water between, a pair of lock gates and a ship in the lock
  canal: () => build([
    part(box(1.3, 0.05, 0.12), CONCRETE, [0, 0.025, 0.2]),
    part(box(1.3, 0.05, 0.12), CONCRETE, [0, 0.025, -0.2]),
    part(box(1.3, 0.02, 0.28), '#3f7fa3', [0, 0.012, 0]),
    part(box(0.03, 0.08, 0.3), DARK, [-0.2, 0.04, 0]),
    part(box(0.03, 0.08, 0.3), DARK, [0.2, 0.04, 0]),
    part(box(0.3, 0.06, 0.1), '#c9ccd0', [0, 0.05, 0]),
    part(box(0.08, 0.08, 0.08), '#9a4b3a', [-0.06, 0.1, 0]),
    part(box(0.1, 0.16, 0.08), CONCRETE, [-0.35, 0.08, 0.3]),
  ]),
  airbase: () => build([
    part(box(1.4, 0.015, 0.18), '#4a4d50', [0, 0.008, 0]),
    part(box(1.3, 0.002, 0.012), '#e8e2d0', [0, 0.017, 0]),
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 10, 1, false, 0, Math.PI), '#8d9298', [-0.2, 0, -0.32], [Math.PI / 2, 0, Math.PI / 2]),
    part(cyl(0.04, 0.05, 0.3, 8), '#c6c1b6', [0.35, 0.15, -0.3]),
    part(cyl(0.07, 0.06, 0.06, 8), GLASS, [0.35, 0.32, -0.3]),
  ]),
  depot: () => build([
    ...[[-0.3, -0.15], [0, -0.15], [0.3, -0.15], [-0.15, 0.2], [0.15, 0.2]].map(([x, z]) => part(box(0.26, 0.16, 0.18), '#6b6a4e', [x, 0.08, z])),
    part(box(0.9, 0.02, 0.06), '#555', [0, 0.01, 0.42]),
  ]),
  fort: () => build([
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return part(box(0.36, 0.12, 0.06), '#8e8a78', [Math.cos(a) * 0.36, 0.06, Math.sin(a) * 0.36], [0, -a + Math.PI / 2, 0]);
    }),
    part(cyl(0.16, 0.2, 0.14, 8), '#7f7b6b', [0, 0.07, 0]),
    part(box(0.2, 0.02, 0.03), DARK, [0.15, 0.12, 0]),
  ]),
  launcher: () => build([
    part(box(0.36, 0.08, 0.2), '#5f6a52', [0, 0.04, 0]),
    part(box(0.34, 0.12, 0.18), '#6f7a62', [-0.02, 0.16, 0], [0, 0, 0.6]),
  ]),
  radarBase: () => build([part(cyl(0.03, 0.05, 0.3, 6), STEEL, [0, 0.15, 0]), part(box(0.2, 0.08, 0.16), '#5f6a52', [0, 0.04, 0])]),
  radarDish: () => build([part(box(0.025, 0.12, 0.26), '#c9ccd0', [0, 0, 0], [0, 0, 0.2])]),
  // --- night: lit towers (UVs kept for the window texture) and the ground glow
  towerLit: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  glow: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  // --- weather: flat sheets a little above the ground
  cloud0: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  cloud1: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  cloud2: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  hurN: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  cloudBase: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  polarCap: () => {
    // rings from the pole out to 6.5 degrees away, following the curve of the globe, a little above it
    const rings = 14, seg = 96, maxA = 6.5 * (Math.PI / 180), lift = 1500;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= rings; i++) {
      const a = (maxA * i) / rings, rr = R * Math.sin(a), y = R * (Math.cos(a) - 1) + lift;
      for (let j = 0; j <= seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        pos.push(rr * Math.cos(t), y, rr * Math.sin(t));
        uv.push(0.5 + 0.5 * (i / rings) * Math.cos(t), 0.5 + 0.5 * (i / rings) * Math.sin(t));
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  },
  rainCurtain: () => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), // upright, standing on the ground
  hurS: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  rain0: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  rain1: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  rain2: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  bolt: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  // --- effects
  puff: () => build([part(new THREE.IcosahedronGeometry(1, 1), '#ffffff')]),
  flash: () => build([part(new THREE.IcosahedronGeometry(1, 1), '#ffffff')]),
};
type Kind = keyof typeof GEOMETRY;

/** Office and flat windows at night: a facade texture, most windows lit warm, some cool, some dark. */
function windowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d1014';
  g.fillRect(0, 0, 128, 128);
  const r = rng(99);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = r();
    if (v < 0.28) continue; // dark window
    g.fillStyle = v < 0.85 ? `rgb(255, ${190 + Math.floor(r() * 40)}, ${90 + Math.floor(r() * 50)})` : '#cfe3ff';
    g.fillRect(x * 16 + 4, y * 16 + 5, 8, 7);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round pool of light: warm, fading out, for the glow a city casts on land and water. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 200, 120, 0.9)');
  grad.addColorStop(0.35, 'rgba(255, 170, 80, 0.45)');
  grad.addColorStop(1, 'rgba(255, 140, 60, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Polar ice seen from orbit: packed white and blue-white, with pressure ridges, fading out at the rim. */
function iceCapTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S - 0.5, v = y / S - 0.5, r = Math.hypot(u, v) * 2;
    const n = Math.sin(u * 41 + Math.sin(v * 13) * 2) * Math.sin(v * 37 + Math.sin(u * 17) * 2) * 0.5 + Math.sin((u + v) * 90) * 0.15;
    const k = (y * S + x) * 4, base = 226 + n * 18;
    d[k] = base - 6; d[k + 1] = base + 2; d[k + 2] = Math.min(255, base + 14);
    // solid over the pole, fading out over the band where the photo still shows (84 to 85.5 degrees)
    const f = Math.min(1, Math.max(0, (r - 0.45) / 0.5)); const a = 1 - f * f * (3 - 2 * f); // a long, soft fade: no rim
    d[k + 3] = Math.round(255 * a);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A weather image as a texture. */
function weatherTexture(img: ImageData) {
  const t = new THREE.DataTexture(img.data, img.width, img.height);
  t.flipY = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
const sheet = (img: ImageData, additive = false, opacity = 0.9) => new THREE.MeshBasicMaterial({
  map: weatherTexture(img), transparent: true, depthWrite: false, opacity, side: THREE.DoubleSide,
  blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
});

/** Window size in metres: windows tile by the building's real size, never stretched. */
const nightUniforms = { uWin: { value: 400 } };

/** Effects use their own, unlit and see-through, materials. */
const EFFECTS: Partial<Record<Kind, THREE.Material>> = {
  cloud0: sheet(cloudImage(101)), cloud1: sheet(cloudImage(118)), cloud2: sheet(cloudImage(135)),
  // the grey underside of a cloud, under the lit tops: gives the cloud depth from any angle
  cloudBase: (() => { const m = sheet(cloudImage(152), false, 0.75); m.color.set('#8b939c'); return m; })(),
  polarCap: new THREE.MeshBasicMaterial({ map: iceCapTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  rainCurtain: (() => { const m = sheet(rainCurtainImage(), false, 0.85); m.map!.wrapT = THREE.RepeatWrapping; m.map!.repeat.set(1, 3); return m; })(),
  hurN: sheet(hurricaneImage(7, false), false, 0.95), hurS: sheet(hurricaneImage(7, true), false, 0.95),
  rain0: sheet(rainImage(0), false, 0.8), rain1: sheet(rainImage(1), false, 0.8), rain2: sheet(rainImage(2), false, 0.8),
  bolt: sheet(flashImage(), true, 1),
  towerLit: (() => {
    const m = new THREE.MeshBasicMaterial({ map: windowTexture(), side: THREE.DoubleSide });
    // tile the windows by the instance's real width and height, and keep roofs dark
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWin = nightUniforms.uWin;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWin;\nvarying float vRoof;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_INSTANCING
            vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
            vMapUv = uv * max(vec2(1.0), floor(size / uWin));
          #endif
          vRoof = abs(normal.y);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRoof;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  if (vRoof > 0.5) diffuseColor.rgb = vec3(0.04, 0.05, 0.06);');
    };
    return m;
  })(),
  glow: new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  puff: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }),
  flash: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
};

// ---- deterministic randomness ---------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ---- the layer ------------------------------------------------------------------

const MAX_INSTANCES = 4096;
/** City blocks are many: from afar the visible cities need far more than other models (past the
 * cap, the tallest towers lost their bodies and kept only their roofs). */
const CAP: Partial<Record<string, number>> = { tower: 24576, towerLit: 24576, roofCap: 8192 };
const capOf = (kind: string) => CAP[kind] ?? MAX_INSTANCES;
const WHITE = new THREE.Color('#ffffff');
const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** A city's buildings in metres from its centre (x east, z south), laid out once over its flat picture. */
/** A model drawn last frame that a click can land on. */
type Pick = { lon: number; lat: number; r: number } & ({ kind: 'stack'; key: string } | { kind: 'building'; province: number });

interface City { id: number; at: Pos; pop: number; capital: boolean; size: number; towers: { x: number; z: number; w: number; d: number; h: number; color: THREE.Color }[] }

function inRing(x: number, y: number, ring: Pos[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class Models3D implements CustomLayerInterface {
  id = 'models-3d';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private meshes = new Map<Kind, THREE.InstancedMesh>();
  /** Instances drawn last frame, by model (for tests). */
  counts = new Map<Kind, number>();
  private sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  private sky = new THREE.HemisphereLight('#e8eef2', '#3a3328', 1.1);
  /** Night lights mode: moonlight, lit windows, cities glowing on the land and water. */
  night = false;
  /** How brightly a nation's cities shine at night (set by the map: blackouts go dark). */
  brightness: (nation: number) => number = () => 1;
  setNight(on: boolean) {
    this.night = on;
    this.sun.intensity = on ? 0.35 : 2.2;
    this.sun.color.set(on ? '#9fb4d9' : '#fff4e0');
    this.sky.intensity = on ? 0.22 : 1.1;
    this.map.triggerRepaint();
  }
  private cities: City[] = [];
  private cityById = new Map<number, City>();
  private enabled = true;
  private start = performance.now();
  private repaintQueued = false;
  /** Storms to draw (set by the game from the weather state); shown at every zoom, whatever the 3D switch. */
  weather: () => { clouds: { lon: number; lat: number; km: number; img: string; rot: number; part: string }[]; flashes: { lon: number; lat: number; km: number }[]; rainFrame: number } = () => ({ clouds: [], flashes: [], rainFrame: 0 });
  /** What was drawn last frame and where, so a click on a model can select it. */
  private picks: Pick[] = [];

  /** The troop stack or building model under a screen point (troops win), if any. */
  pick(x: number, y: number): { kind: 'stack'; key: string } | { kind: 'building'; province: number } | null {
    let best: Pick | null = null, bestD = Infinity;
    for (const p of this.picks) {
      const q = this.map.project([p.lon, p.lat]);
      // models stand up from their point: the hit area sits a little above it
      const d = Math.hypot(q.x - x, q.y - p.r * 0.35 - y);
      const score = d - (p.kind === 'stack' ? 6 : 0);
      if (d < p.r && score < bestD) { best = p; bestD = score; }
    }
    if (!best) return null;
    return best.kind === 'stack' ? { kind: 'stack', key: best.key } : { kind: 'building', province: best.province };
  }

  /** Pixels a vehicle model spans on screen right now; 0 while models are hidden. */
  sizePx = 0;
  onSize: (px: number) => void = () => {};

  /** Core building footprints placed so far, in metres on a grid of SPACING_CELL, for the spacing rule. */
  private footprints = new Map<string, { x: number; z: number; r: number }[]>();

  constructor(private map: MLMap, private game: Game, private pol: Political, private forces: Forces, shapes: Map<number, CityShape>) {
    for (const [id, shape] of shapes) this.cities.push(this.planCity(id, shape));
    this.cityById = new Map(this.cities.map((c) => [c.id, c]));
    this.footprints.clear();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.map.triggerRepaint();
    if (!on) { this.sizePx = 0; this.onSize(0); }
  }

  /**
   * A city's skyline, laid out once over its flat picture: towers in the built-up core,
   * low blocks across the suburbs, every one inside the city's land-cut shapes.
   */
  private planCity(id: number, c: CityShape): City {
    const rand = rng(id * 2654435761);
    const [lon0, lat0] = c.at;
    const kx = 111_320 * Math.cos(lat0 * RAD), kz = 110_540;
    const local = ([lon, lat]: Pos): [number, number] => [(lon - lon0) * kx, -(lat - lat0) * kz];
    const big = c.pop > 4e6 || c.capital;
    const arid = ['desert_sand', 'desert_rock', 'savanna', 'shrubland', 'steppe'].includes(c.terrain);
    const tones = arid ? ['#c9b48f', '#d8c7a5', '#b59f7c', '#e2d6bd'] : ['#a9a59e', '#bdb8ae', '#8f949a', '#cfc8ba', '#9aa3ab'];
    const block = c.km * 1000 * 0.3; // footprint of one block: chunky, sized to the city
    const towers: City['towers'] = [];
    // place() answers false when the spot is taken, and another spot is tried
    const sample = (ring: Pos[], n: number, place: (x: number, z: number, centrality: number) => boolean | void) => {
      const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const rMax = Math.max(1, Math.hypot(...local([x1, y1])), Math.hypot(...local([x0, y0])));
      for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
        const lon = x0 + rand() * (x1 - x0), lat = y0 + rand() * (y1 - y0);
        if (!inRing(lon, lat, ring)) continue;
        const [x, z] = local([lon, lat]);
        if (place(x, z, 1 - Math.min(1, Math.hypot(x, z) / rMax)) === false) continue;
        i++;
      }
    };
    // the core's buildings keep their distance: footprints may clip a little (CLIP of their
    // size), never stand inside one another, in this city or a neighbouring one. The low sprawl
    // around them is left to overlap freely, so a big city reads as one dense mass.
    const free = (x: number, z: number, r: number) => {
      const gx = lon0 * kx + x, gz = -lat0 * kz + z;
      const cx = Math.floor(gx / SPACING_CELL), cz = Math.floor(gz / SPACING_CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const o of this.footprints.get(`${cx + a},${cz + b}`) ?? []) {
          if (Math.hypot(o.x - gx, o.z - gz) < (o.r + r) * (1 - CLIP)) return false;
        }
      }
      const k = `${cx},${cz}`;
      if (!this.footprints.has(k)) this.footprints.set(k, []);
      this.footprints.get(k)!.push({ x: gx, z: gz, r });
      return true;
    };
    // the core: denser and taller toward the middle
    c.core.forEach((ring, k) => sample(ring, Math.round(Math.min(34, Math.max(5, c.km * 1.5)) * (k ? 0.35 : 1)), (x, z, central) => {
      const tall = big && !k && central > 0.35 && rand() < 0.55;
      const w = block * (tall ? 0.7 + rand() * 0.4 : 0.8 + rand() * 0.6);
      const d = w * (0.7 + rand() * 0.6);
      if (!free(x, z, Math.max(w, d) / 2)) return false;
      const h = tall ? w * (2.2 + rand() * 2.8) * (c.pop > 9e6 ? 1.3 : 1) : w * (0.4 + rand() * 0.6 + central * 0.6);
      towers.push({ x, z, w, d, h, color: new THREE.Color(tall && rand() < 0.5 ? GLASS : tones[Math.floor(rand() * tones.length)]) });
    }));
    // suburbs: scattered low houses and sheds, outside the core
    sample(c.suburbs, Math.round(Math.min(30, Math.max(4, c.km * 1.2))), (x, z) => {
      const w = block * (0.45 + rand() * 0.35);
      towers.push({ x, z, w, d: w * (0.7 + rand() * 0.6), h: w * (0.5 + rand() * 0.6), color: new THREE.Color(tones[Math.floor(rand() * tones.length)]) });
    });
    return { id, at: c.at, pop: c.pop, capital: c.capital, size: block, towers };
  }

  onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.scene.add(this.sky);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // both faces: seen from low down, tall towers' sides were dropped and only their roofs were left
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const toonMat = toonMaterial(), ink = inkMaterial();
    for (const kind of Object.keys(GEOMETRY) as Kind[]) {
      // troops: the toon model, and its ink shell drawn as a second mesh that follows it instance for instance
      const toon = kind in TOON ? TOON[kind as ToonKind]() : null;
      const mesh = new THREE.InstancedMesh(toon?.geo ?? GEOMETRY[kind](), toon ? toonMat : EFFECTS[kind] ?? lit, capOf(kind));
      if (toon) {
        const shell = new THREE.InstancedMesh(toon.ink, ink, capOf(kind));
        shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        shell.frustumCulled = false;
        shell.count = 0;
        this.inks.set(kind, shell);
        this.scene.add(shell);
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, WHITE);
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      if (EFFECTS[kind]) mesh.renderOrder = 2;
      this.meshes.set(kind, mesh);
      this.scene.add(mesh);
    }
  }

  onRemove() { this.renderer?.dispose(); }

  // ---- frames on the planet -----------------------------------------------------
  private flat = false;
  private origin = new THREE.Matrix4();
  private originInv = new THREE.Matrix4();

  /**
   * Object frame at a point: X east, Y up, Z south, scaled to metres. On the flat map
   * mercator y already runs south; the frame matches the globe's handedness on screen,
   * so faces keep their winding and their light.
   */
  private frame(lon: number, lat: number, alt: number, out: THREE.Matrix4, metres = 1) {
    if (this.flat) {
      const c = MercatorCoordinate.fromLngLat([lon, lat], alt);
      const u = c.meterInMercatorCoordinateUnits() * metres;
      return out.set(u, 0, 0, c.x, 0, 0, u, c.y, 0, u, 0, c.z, 0, 0, 0, 1);
    }
    const la = lat * RAD, lo = lon * RAD;
    const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
    const k = 1 + alt / R, s = metres / R;
    // up = (sin lo cos la, sin la, cos lo cos la); east = (cos lo, 0, -sin lo); south = -north
    return out.set(
      co * s, so * cl * s, so * sl * s, so * cl * k,
      0, sl * s, -cl * s, sl * k,
      -so * s, co * cl * s, co * sl * s, co * cl * k,
      0, 0, 0, 1,
    );
  }

  /** Model rotation about the vertical so +X points along a bearing (dEast, dNorth). */
  private heading(dEast: number, dNorth: number) {
    return Math.atan2(dNorth, dEast);
  }

  private ground(lon: number, lat: number) {
    return Math.max(0, this.map.queryTerrainElevation([lon, lat]) ?? 0);
  }

  // ---- instances ----------------------------------------------------------------
  private base = new THREE.Matrix4();

  /** Start drawing an object at a point; later puts are relative to it, in model units. */
  private at(lon: number, lat: number, unitMetres: number, alt = this.ground(lon, lat)) {
    this.frame(lon, lat, alt, _m, unitMetres);
    this.base.multiplyMatrices(this.originInv, _m);
  }

  /** The ink shells of the toon models, by kind. */
  private inks = new Map<Kind, THREE.InstancedMesh>();

  private put(kind: Kind, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, color: THREE.Color = WHITE, rx = 0, rz = 0) {
    const mesh = this.meshes.get(kind)!;
    const i = this.counts.get(kind) ?? 0;
    if (i >= capOf(kind)) return;
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    _l.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    mesh.setMatrixAt(i, _m.multiplyMatrices(this.base, _l));
    mesh.setColorAt(i, color);
    this.inks.get(kind)?.setMatrixAt(i, _m);
    this.counts.set(kind, i + 1);
  }

  // ---- what is visible ----------------------------------------------------------
  private centre = new THREE.Vector3();
  /** The camera, in the globe's own space (the planet is a unit sphere there). */
  private eye = new THREE.Vector3();
  private visible(lon: number, lat: number) {
    if (!this.flat) {
      // above the horizon: seen from the camera, the point faces us (its normal points at the eye)
      const la = lat * RAD, lo = lon * RAD;
      const x = Math.sin(lo) * Math.cos(la), y = Math.sin(la), z = Math.cos(lo) * Math.cos(la);
      if (x * this.eye.x + y * this.eye.y + z * this.eye.z < 1.0005) return false;
    }
    const p = this.map.project([lon, lat]);
    const c = this.map.getCanvas();
    return p.x > -120 && p.y > -120 && p.x < c.clientWidth + 120 && p.y < c.clientHeight + 160;
  }

  // ---- drawing ------------------------------------------------------------------
  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const z = this.map.getZoom();
    const grow = Math.min(1, Math.max(0, (z - MODELS_FROM) / (MODELS_FULL - MODELS_FROM)));
    const on = this.enabled && grow > 0;
    const px = on ? Math.min(44, 30 + (z - MODELS_FULL) * 4) * grow : 0; // troops grow only a little as you zoom in
    if (Math.abs(px - this.sizePx) > 0.5) { this.sizePx = px; this.onSize(px); }
    const sky = this.weather();
    const caps = !this.flat;

    this.flat = this.map.getProjection()?.type === 'mercator';
    const c = this.map.getCenter();
    { const la = c.lat * RAD, lo = c.lng * RAD; this.centre.set(Math.sin(lo) * Math.cos(la), Math.sin(la), Math.cos(lo) * Math.cos(la)); }
    this.frame(c.lng, c.lat, 0, this.origin);
    this.originInv.copy(this.origin).invert();
    const main = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
    // the eye is where the projection sends to infinity: main * eye = (0, 0, c, 0)
    { const e = new THREE.Vector4(0, 0, 1, 0).applyMatrix4(main.clone().invert()); this.eye.set(e.x / e.w, e.y / e.w, e.z / e.w); }
    this.camera.projectionMatrix.copy(main).multiply(this.origin);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.sun.position.set(-0.6, 1, -0.5).multiplyScalar(1e6); // from the north-west, like the hill shading

    // metres per pixel at the view centre, from the zoom alone: tilting or turning the camera never changes model sizes
    const mpp = (40_075_016.686 * Math.cos(c.lat * RAD)) / (512 * 2 ** z);
    const unit = px * mpp; // metres in one model unit
    const t = (performance.now() - this.start) / 1000;
    for (const k of this.meshes.keys()) this.counts.set(k, 0);
    this.picks = [];

    nightUniforms.uWin.value = Math.max(250, mpp * 3);
    const rainMap = (EFFECTS.rainCurtain as THREE.MeshBasicMaterial).map;
    if (rainMap) rainMap.offset.y = (t * 0.9) % 1;
    if (on) {
      this.drawCities(t, mpp);
      this.drawBuildings(t, mpp, BUILDING_M); // buildings: a fixed size on the ground, in fixed places
      this.drawForces(unit * 1.6, t, px * 1.6);
    }
    this.drawWeather(sky, z);
    if (caps) this.drawPolarCaps();

    for (const [k, mesh] of this.meshes) {
      mesh.count = this.counts.get(k) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const shell = this.inks.get(k);
      if (shell) { shell.count = mesh.count; shell.instanceMatrix.needsUpdate = true; }
    }
    this.renderer.resetState();
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    // keep animating, at most ~30 frames a second, so map data still loads between frames on slower
    // machines; the ice caps alone are still, so they need no repainting of their own
    if ((on || sky.clouds.length) && !this.repaintQueued) {
      this.repaintQueued = true;
      window.setTimeout(() => { this.repaintQueued = false; this.map.triggerRepaint(); }, 33);
    }
  }

  /**
   * Ice caps over the poles: the map's imagery stops at 85 degrees, so the globe had a hole
   * there. Each cap is drawn only while its pole faces the camera (the 3D layer is not hidden
   * by the far side of the globe).
   */
  /** How sunlit each pole is (north, south), 0..1: set from the sunlight, so caps go dark in polar night. */
  capLight: [number, number] = [0.94, 0.94];

  private drawPolarCaps() {
    for (const lat of [90, -90]) {
      const up = lat > 0 ? 1 : -1;
      if (this.centre.y * up < 0.05) continue; // that pole is round the back of the globe
      // drawn only where the pole is really in sight: the 3D layer is not hidden by the globe, so
      // a pole just past the horizon showed through the land. A point is in sight when the map,
      // asked what lies at its spot on screen, answers with that point.
      const seen = [0, 90, 180, 270].some((lon) => {
        const q = this.map.project([lon, up * 86.5]);
        const back = this.map.unproject(q);
        return Math.abs(back.lat - up * 86.5) < 0.6;
      });
      if (!seen) continue;
      const l = this.capLight[lat > 0 ? 0 : 1];
      this.at(0, lat, 1, 0);
      this.put('polarCap', 0, 0, 0, 0, 1, 1, 1, new THREE.Color(l * 0.97, l, Math.min(1, l * 1.04)));
    }
  }

  /** Clouds float a few kilometres up, real size; rain hangs under storm cores up close; lightning flashes inside. */
  private drawWeather(sky: ReturnType<Models3D['weather']>, z: number) {
    const kinds: Record<string, Kind> = { 'cloud-0': 'cloud0', 'cloud-1': 'cloud1', 'cloud-2': 'cloud2', 'hurricane-n': 'hurN', 'hurricane-s': 'hurS' };
    for (const c of sky.clouds) {
      if (!this.visible(c.lon, c.lat)) continue;
      const kind = kinds[c.img];
      if (!kind) continue;
      const size = c.km * 1000, rot = (c.rot * Math.PI) / 180;
      const top = 9000 + (c.part === 'core' ? 1500 : 0);
      if (kind === 'hurN' || kind === 'hurS') {
        // a hurricane: the spiral, a second thinner deck turning above it, a grey base below
        this.at(c.lon, c.lat, 1, top - 3000); this.put('cloudBase', 0, 0, 0, rot * 0.7, size * 0.8, 1, size * 0.8);
        this.at(c.lon, c.lat, 1, top); this.put(kind, 0, 0, 0, rot, size, 1, size);
        this.at(c.lon, c.lat, 1, top + 2500); this.put(kind, 0, 0, 0, rot * 1.15 + 0.6, size * 0.82, 1, size * 0.82);
      } else {
        // a cloud in three decks, each a different cloud picture, stretched and nudged its own way, so
        // no two clouds share an outline (copies of one picture, turned, stacked into crosses)
        const h = Math.abs(Math.sin(c.lon * 12.9898 + c.lat * 78.233) * 43758.5453) % 1, h2 = (h * 7.31) % 1, h3 = (h * 13.7) % 1;
        const decks: Kind[] = ['cloud0', 'cloud1', 'cloud2'];
        const pick = (k: number) => decks[(Math.floor(h * 3) + k) % 3];
        const sx = 0.7 + h * 0.8, sz = 0.7 + h2 * 0.6, off = size * 0.18;
        this.at(c.lon, c.lat, 1, top - 2500); this.put('cloudBase', (h2 - 0.5) * off, 0, (h3 - 0.5) * off, rot + h * 6, size * sx * 0.85, 1, size * sz * 0.9);
        this.at(c.lon, c.lat, 1, top); this.put(pick(0), 0, 0, 0, rot, size * sx, 1, size * sz);
        this.at(c.lon, c.lat, 1, top + 2200); this.put(pick(1), (h3 - 0.5) * off * 1.6, 0, (h - 0.5) * off, rot + 0.4 + h2, size * sx * 0.62, 1, size * sz * 0.7);
      }
      if (c.part === 'core' && z >= 3) {
        // rain falls from the cloud base to the ground: curtains of streaks standing under the core
        const base = top - 2500, seed = Math.floor(c.lon * 13 + c.lat * 7);
        this.at(c.lon, c.lat, 1, 0);
        for (let k = 0; k < 9; k++) {
          const a = seed * 0.37 + k * 2.39, d = size * 0.28 * Math.sqrt((k + 0.5) / 9);
          this.put('rainCurtain', Math.cos(a) * d, 0, Math.sin(a) * d, a * 1.7, size * 0.22, base, 1);
        }
      }
    }
    for (const f of sky.flashes) {
      if (!this.visible(f.lon, f.lat)) continue;
      this.at(f.lon, f.lat, 1, 10_500);
      this.put('bolt', 0, 0, 0, Math.random() * 6, f.km * 1000, 1, f.km * 1000);
    }
  }

  private drawCities(t: number, mpp: number) {
    for (const city of this.cities) {
      const [lon, lat] = city.at;
      if (!this.visible(lon, lat)) continue;
      this.at(lon, lat, 1); // the city in real metres, on its flat picture
      // zoomed out, blocks swell in place (never move) so the city still reads; up close they are true to size
      const g = Math.min(3.5, Math.max(1, (5 * mpp) / city.size));
      if (this.night) {
        const lit = this.brightness(this.pol.provinces.get(city.id)?.nation ?? 0);
        const col = new THREE.Color(lit, lit, lit);
        for (const b of city.towers) this.put('towerLit', b.x, 0, b.z, 0, b.w * g, b.h * g, b.d * g, col);
        // the city's light spilling onto the land and water around it
        const r = city.size * 9 * g;
        this.put('glow', 0, city.size * 0.05, 0, 0, r, 1, r, new THREE.Color(lit, lit * 0.9, lit * 0.75));
      } else {
        for (const b of city.towers) {
          if (g > 2 && b.h < b.w * 0.75) continue; // from far out the low houses are lost anyway: leave them out
          this.put('tower', b.x, 0, b.z, 0, b.w * g, b.h * g, b.d * g, b.color);
          if (b.h > b.w * 2.5) this.put('roofCap', b.x, 0, b.z, 0, b.w * g, b.h * g, b.d * g);
        }
      }
      if (city.capital) { const s = city.size * 2.2; this.put('dome', 0, 0, 0, 0.3, s, s, s); }
      if (city.pop > 4e6 && Math.sin(t * 3 + city.id) > 0.6) {
        const top = city.towers.reduce((m, x) => (x.h > m.h ? x : m), city.towers[0]);
        if (top) { const s = city.size * 0.15; this.put('flash', top.x, top.h + s, top.z, 0, s, s, s, new THREE.Color('#ff4a3a')); }
      }
    }
  }

  /** Buildings stand at a fixed size on the ground in fixed places: they neither drift nor swell as the camera moves. */
  private drawBuildings(t: number, mpp: number, size: number) {
    const unitM = size, g = 1;
    for (const [pid, list] of Object.entries(this.game.war.buildings)) {
      const done = list.filter((x) => x.progress >= 1).map((x) => x.type);
      const broken = new Set(list.filter((x) => x.damaged).map((x) => x.type));
      if (!done.length) continue;
      const id = Number(pid);
      const p = this.pol.provinces.get(id);
      if (!p) continue;
      const city = this.cityById.get(id);
      const [lon0, lat0] = city?.at ?? p.label;
      if (!this.visible(lon0, lat0)) continue;
      // a ring just outside the built-up area, in fixed metres, on land
      const ring = (city ? city.size / 0.3 * 0.9 : 0) + unitM * 1.2;
      const types = [...new Set(done)];
      const kx = 111_320 * Math.max(0.2, Math.cos(lat0 * RAD));
      types.forEach((type, i) => {
        for (let k = 0; k < 8; k++) {
          const ang = 3.6 + (i + k * 0.37) * 0.95;
          const r = ring + Math.floor(i / 6) * unitM * 1.4;
          const lon = lon0 + (Math.cos(ang) * r) / kx, lat = lat0 + (Math.sin(ang) * r) / 110_540;
          if (k < 7 && this.pol.provinceAt(lat, lon)?.kind !== 'land' && type !== 'port') continue; // try another spot on land
          this.at(lon, lat, unitM * g);
          this.picks.push({ kind: 'building', province: id, lon, lat, r: Math.max(10, (unitM * g * 0.7) / mpp) });
          this.drawBuilding(type, done.filter((x) => x === type).length, t, id * 31 + i);
          if (broken.has(type)) this.smoke(0, 0.3, 0, t, id * 7 + i, '#3a3634', 1.2); // storm damage smoulders until repaired
          break;
        }
      });
    }
  }

  private smoke(x: number, y: number, z: number, t: number, seed: number, color: string, size = 1) {
    const col = new THREE.Color(color);
    for (let k = 0; k < 5; k++) {
      const ph = (t * 0.22 + k / 5 + (seed % 97) / 97) % 1;
      const s = (0.05 + ph * 0.16) * size * (1 - ph * ph);
      this.put('puff', x + ph * 0.35 * size, y + ph * 0.9 * size, z + Math.sin(ph * 6 + seed) * 0.05, 0, s, s, s, col);
    }
  }

  private drawBuilding(type: BuildingType, n: number, t: number, seed: number) {
    switch (type) {
      case 'factory':
        this.put('factory', 0, 0, 0, 0.4);
        this.smoke(0.42 * Math.cos(0.4), 0.92, -0.42 * Math.sin(0.4) + 0.26, t, seed, '#8b8580');
        if (n > 3) this.put('factory', -0.6, 0, 0.7, 0.4, 0.8);
        break;
      case 'coal_plant':
        this.put('coalPlant', 0, 0, 0);
        this.smoke(0.36, 1.28, -0.12, t, seed, '#4a4744', 1.3);
        break;
      case 'gas_plant':
        this.put('gasPlant', 0, 0, 0);
        this.smoke(0.25, 0.72, 0.1, t, seed, '#cfcac2', 0.7);
        break;
      case 'nuclear_plant':
        this.put('coolingTower', 0, 0, 0);
        this.put('coolingTower', -0.75, 0, 0.35, 0, 0.9);
        this.smoke(0, 0.95, 0, t, seed, '#f2f2f0', 1.6);
        this.smoke(-0.75, 0.85, 0.35, t + 1.7, seed + 5, '#f2f2f0', 1.4);
        break;
      case 'renewables':
        for (let i = 0; i < 3; i++) {
          const x = (i - 1) * 0.45, zz = (i % 2) * 0.25;
          this.put('turbineMast', x, 0, zz);
          this.put('turbineRotor', x + 0.05, 0.9, zz, 0, 1, 1, 1, WHITE, t * 2.2 + i, 0);
        }
        this.put('solar', 0.1, 0, -0.55);
        break;
      case 'mine':
        this.put('mine', 0, 0, 0);
        this.put('mineWheel', 0.22, 0.64, 0.22, Math.PI / 2, 1, 1, 1, WHITE, 0, t * 2.5);
        break;
      case 'port':
        this.put('port', 0, 0, 0);
        this.put('craneBoom', -0.4, 0.5, 0.08, Math.sin(t * 0.35 + seed) * 1.2);
        break;
      case 'airbase': {
        this.put('airbase', 0, 0, 0);
        // a jet taking off down the runway, again and again
        const ph = (t * 0.18 + (seed % 10) / 10) % 1;
        this.put('jet', -0.6 + ph * 1.4, 0.03 + Math.max(0, ph - 0.6) * 0.8, 0, 0, 0.35, 0.35, 0.35, new THREE.Color('#9aa1a8'), 0, Math.max(0, ph - 0.6) * 0.6);
        break;
      }
      case 'fort':
        this.put('fort', 0, 0, 0);
        break;
      case 'canal':
        this.put('canal', 0, 0, 0, 0.3);
        break;
      case 'depot':
        this.put('depot', 0, 0, 0);
        break;
      case 'air_defense':
        this.put('launcher', -0.15, 0, 0, 0.5);
        this.put('radarBase', 0.25, 0, 0.1);
        this.put('radarDish', 0.25, 0.32, 0.1, t * 1.6);
        break;
      // the producers, made of the same parts: fields and a barn, a sawmill in the trees, a nodding
      // pumpjack, a gas flare, a dark coal pit and a red-earth quarry
      case 'farm': {
        const tones = ['#8fa64a', '#d9c25e', '#6f9a3a', '#c4a050'];
        for (let i = 0; i < 4; i++) this.put('field', (i % 2) * 0.55 - 0.28, 0, Math.floor(i / 2) * 0.48 - 0.24, 0, 1, 1, 1, new THREE.Color(tones[(i + seed) % 4]));
        this.put('barn', 0.55, 0, 0.45, 0.3, 1, 1, 1, new THREE.Color('#a8432f'));
        break;
      }
      case 'logging_camp':
        for (let i = 0; i < 7; i++) this.put('tree', -0.5 + i * 0.17, 0, (i % 2) * 0.22 - 0.4 + (i % 3) * 0.05, 0, 1.3, 1.3, 1.3, new THREE.Color(i % 2 ? '#3f7a38' : '#2f6430'));
        this.put('logPile', 0.05, 0, 0.1, 0.2);
        this.smoke(0.3, 0.45, 0.35, t, seed, '#b9b2a6', 0.5);
        break;
      case 'oil_well':
        // the pumpjack nods
        this.put('launcher', 0, 0, 0, 0.6, 0.9, 0.9, 0.9, new THREE.Color('#2b2b2e'), 0, Math.sin(t * 2 + seed) * 0.35);
        this.put('depot', 0.55, 0, -0.3, 0, 0.35, 0.5, 0.35, new THREE.Color('#5a5f66'));
        break;
      case 'gas_well':
        this.put('gasPlant', 0, 0, 0, 0, 0.55);
        this.put('turbineMast', -0.45, 0, 0.2, 0, 1, 0.6, 1, new THREE.Color('#9aa1a8'));
        this.put('flash', -0.45, 0.62 + Math.sin(t * 7 + seed) * 0.02, 0.2, 0, 0.07, 0.11, 0.07, new THREE.Color('#ffb347'));
        break;
      case 'coal_mine':
        this.put('mine', 0, 0, 0, 0, 1, 1, 1, new THREE.Color('#3b3836'));
        this.put('mineWheel', 0.22, 0.64, 0.22, Math.PI / 2, 1, 1, 1, WHITE, 0, t * 2.5);
        this.smoke(-0.2, 0.6, -0.1, t, seed, '#4a4744', 0.6);
        break;
      case 'rare_earth_mine':
        this.put('mine', 0, 0, 0, 0.8, 1, 0.8, 1, new THREE.Color('#b0603c'));
        this.put('mineWheel', 0.22, 0.52, 0.22, Math.PI / 2, 0.8, 0.8, 0.8, WHITE, 0, t * 2);
        break;
      case 'missile_defense':
        this.put('launcher', -0.2, 0, -0.15, 0.2, 1.2);
        this.put('launcher', -0.2, 0, 0.2, 0.2, 1.2);
        this.put('radarBase', 0.3, 0, 0, 0, 1.3);
        this.put('radarDish', 0.3, 0.42, 0, t * 0.9, 1.6, 1.6, 1.6);
        break;
    }
  }

  private drawForces(unit: number, t: number, px: number) {
    const tint = new Map<number, THREE.Color>();
    const colourOf = (nation: number) => {
      let c = tint.get(nation);
      if (!c) {
        c = toonColour(this.pol.nations.get(nation)?.color ?? '#888888'); // bright nation colour, as the toon style wears it
        tint.set(nation, c);
      }
      return c;
    };
    const slotKm = (42 / Math.max(1, px)) * unit; // counters are 42 px apart: models follow them
    for (const s of this.forces.stacks()) {
      let [lon, lat] = s.at;
      if (s.slot) lon += (s.slot * slotKm) / (111_320 * Math.max(0.2, Math.cos(lat * RAD)));
      if (!this.visible(lon, lat)) continue;
      this.picks.push({ kind: 'stack', key: s.key, lon, lat, r: px * 0.9 });
      const u0 = s.units[0];
      const sea = this.pol.provinces.get(u0.province)?.kind === 'sea';
      // facing: toward the next province, or toward the enemy's side of the map at rest
      let ry = (hash(s.key) % 628) / 100;
      if (s.toward) {
        const dE = (s.toward[0] - lon) * Math.cos(lat * RAD), dN = s.toward[1] - lat;
        if (Math.abs(dE) + Math.abs(dN) > 1e-6) ry = this.heading(dE, dN);
      }
      this.at(lon, lat, unit, sea ? 0 : undefined);
      const colour = colourOf(u0.nation);
      const moving = !!s.toward;
      const seed = hash(s.key);
      const lead = this.leadType(s.units);
      const n = Math.min(3, s.units.length);
      const dom = domainOf(lead);
      this.anchor = { lon, lat, unit };
      if (dom === 'air') this.drawAir(lead, n, colour, t, seed);
      else if (dom === 'sea' || sea) this.drawSea(lead, n, colour, t, seed, ry, moving);
      else this.drawLand(lead, n, colour, t, seed, ry, moving, s.fighting);
      if (s.fighting) this.drawBattle(t, seed);
    }
  }

  private leadType(units: UnitView[]): UnitType {
    const counts = new Map<UnitType, number>();
    for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] * UNIT_SPECS[b[0]].attack - a[1] * UNIT_SPECS[a[0]].attack || UNIT_TYPES.indexOf(a[0]) - UNIT_TYPES.indexOf(b[0]))[0][0];
  }

  /** The stack being drawn: where its counter stands and how many metres a model unit is. */
  private anchor = { lon: 0, lat: 0, unit: 1 };

  /**
   * A formation slot whose ground suits the unit: land for armies, water for ships. The leader keeps its
   * place under the counter; the others step in toward it when their slot is over the coast, and stay
   * out of sight if there is no room at all, so no tank wades into the sea and no ship sits on a beach.
   */
  private fit(i: number, ry: number, sea: boolean): [number, number] | null {
    const [sx, sz] = this.slot(i, ry);
    if (i === 0) return [sx, sz];
    const { lon, lat, unit } = this.anchor;
    const kx = 111_320 * Math.max(0.2, Math.cos(lat * RAD));
    const ok = (x: number, z: number) => {
      // the middle of the model and its two ends (about half a unit along its heading)
      for (const d of [0, 0.5, -0.5]) {
        const px = x + Math.cos(ry) * d, pz = z - Math.sin(ry) * d;
        const p = this.pol.provinceAt(lat - (pz * unit) / 110_540, lon + (px * unit) / kx);
        if (!p || (p.kind === 'sea') !== sea) return false;
      }
      return true;
    };
    for (const k of [1, 0.75, 0.5]) if (ok(sx * k, sz * k)) return [sx * k, sz * k];
    // try the other side of the column
    const [mx, mz] = this.slot(i === 1 ? 2 : 1, ry);
    for (const k of [1, 0.6]) if (ok(mx * k, mz * k)) return [(mx * k + sx * 0.15), (mz * k + sz * 0.15)];
    return null;
  }

  /** Formation slots behind the leader, in model units, rotated to the stack's heading. */
  private slot(i: number, ry: number): [number, number] {
    const pos: [number, number][] = [[0, 0], [-0.75, 0.55], [-0.75, -0.55]];
    const [x, z] = pos[i];
    return [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  }

  private drawLand(lead: UnitType, n: number, colour: THREE.Color, t: number, seed: number, ry: number, moving: boolean, fighting: boolean) {
    for (let i = 0; i < n; i++) {
      const at = this.fit(i, ry, false);
      if (!at) continue;
      const [x, z] = at;
      const bob = moving ? Math.abs(Math.sin(t * 9 + i * 1.3 + seed)) * 0.03 : 0;
      if (lead === 'armored') {
        const sweep = moving ? 0 : Math.sin(t * 0.45 + seed + i) * 0.7;
        this.put('tankHull', x, bob, z, ry, 1, 1, 1, colour, moving ? Math.sin(t * 7 + i) * 0.02 : 0);
        this.put('tankTurret', x, 0.32 + bob, z, ry + sweep, 1, 1, 1, colour);
        if (fighting && Math.sin(t * 5 + seed + i * 2) > 0.85) {
          const a = ry + sweep;
          this.put('flash', x + Math.cos(a) * 0.75, 0.34, z - Math.sin(a) * 0.75, 0, 0.08, 0.08, 0.08, new THREE.Color('#ffc65a'));
        }
      } else if (lead === 'mechanized') {
        this.put('apcHull', x, bob, z, ry, 0.95, 0.95, 0.95, colour);
      } else {
        // infantry, marines, special forces: a squad of three per slot, marching when on the move
        const squad = [[0.1, 0], [-0.12, 0.16], [-0.12, -0.16]];
        squad.forEach(([sx, sz], k) => {
          const c = Math.cos(ry), sn = Math.sin(ry);
          const hop = moving ? Math.abs(Math.sin(t * 10 + k * 2.1 + i)) * 0.05 : 0;
          const lean = moving ? 0.12 : fighting ? Math.sin(t * 6 + k) * 0.1 : 0;
          this.put('soldier', x + sx * c + sz * sn, hop, z - sx * sn + sz * c, ry, 1.7, 1.7, 1.7, colour, 0, -lean);
          if (fighting && Math.sin(t * 9 + k * 2 + seed) > 0.9) {
            this.put('flash', x + sx * c + sz * sn + Math.cos(ry) * 0.38, 0.42, z - sx * sn + sz * c - Math.sin(ry) * 0.38, 0, 0.04, 0.04, 0.04, new THREE.Color('#ffd27a'));
          }
        });
      }
    }
  }

  private drawSea(lead: UnitType, n: number, colour: THREE.Color, t: number, seed: number, ry: number, moving: boolean) {
    const kind: Kind = lead === 'carrier' ? 'carrier' : lead === 'submarines' ? 'submarine' : lead === 'destroyers' ? 'destroyer' : 'destroyer';
    for (let i = 0; i < n; i++) {
      const at = this.fit(i, ry, true);
      if (!at) continue;
      const [x, z] = at;
      const roll = Math.sin(t * 1.1 + seed + i) * 0.06, pitch = Math.sin(t * 0.8 + seed * 0.3 + i) * 0.03;
      const heave = Math.sin(t * 1.3 + i) * 0.015 - (kind === 'submarine' ? 0.04 : 0);
      this.put(i === 0 ? kind : kind === 'carrier' ? 'destroyer' : kind, x, heave, z, ry, i ? 0.8 : 1, i ? 0.8 : 1, i ? 0.8 : 1, colour, roll, pitch);
      if (moving && kind !== 'submarine') {
        // a short wake of white foam behind each ship
        for (let k = 1; k <= 3; k++) {
          const ph = ((t * 0.8 + k / 3) % 1);
          const d = 0.55 + ph * 0.6;
          this.put('puff', x - Math.cos(ry) * d, 0.01, z + Math.sin(ry) * d, 0, 0.05 + ph * 0.06, 0.012, 0.05 + ph * 0.06, WHITE);
        }
      }
    }
  }

  private drawAir(lead: UnitType, n: number, colour: THREE.Color, t: number, seed: number) {
    const kind: Kind = lead === 'bombers' ? 'bomber' : lead === 'drones' ? 'drone' : 'jet';
    const speed = kind === 'bomber' ? 0.35 : kind === 'drone' ? 0.5 : 0.7;
    for (let i = 0; i < n; i++) {
      // circle over the base, each plane a third of the way round from the last
      const a = t * speed + (seed % 628) / 100 + (i * Math.PI * 2) / Math.max(1, n);
      const r = 0.9 + i * 0.12;
      const x = Math.cos(a) * r, z = -Math.sin(a) * r;
      const yaw = a + Math.PI / 2; // tangent to the circle
      const s = kind === 'bomber' ? 1.1 : kind === 'drone' ? 1 : 0.9;
      this.put(kind, x, 1.0 + i * 0.12 + Math.sin(t + i) * 0.04, z, yaw, s, s, s, colour, kind === 'drone' ? 0 : -0.45);
    }
  }

  private drawBattle(t: number, seed: number) {
    // shell bursts landing around the fight
    const fire = new THREE.Color('#ff8a3a'), dust = new THREE.Color('#8f8070');
    for (let k = 0; k < 4; k++) {
      const ph = (t * 0.9 + k / 4 + (seed % 13) / 13) % 1;
      const r = rng(seed + k + Math.floor(t * 0.9 + k / 4));
      const x = (r() - 0.5) * 1.8, z = (r() - 0.5) * 1.8;
      if (ph < 0.25) { const s = 0.06 + ph * 0.5; this.put('flash', x, 0.05, z, 0, s, s, s, fire); }
      const ds = 0.08 + ph * 0.18;
      this.put('puff', x, 0.05 + ph * 0.3, z, 0, ds, ds, ds, dust);
    }
  }
}
