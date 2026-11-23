// Cloud, rain and lightning images for storms on the map, drawn once in code to
// match the satellite look: layered noise for billowing cloud tops with soft grey
// shadows, spiral bands and a clear eye for hurricanes, streaks for rain.

/** Smooth value noise in 2D, tiling every `period` cells. */
function makeNoise(seed: number, period = 64) {
  const h = new Float32Array(period * period);
  let a = seed >>> 0;
  for (let i = 0; i < h.length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    h[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const at = (x: number, y: number) => h[((y % period) + period) % period * period + (((x % period) + period) % period)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
    const a0 = at(xi, yi), b0 = at(xi + 1, yi), a1 = at(xi, yi + 1), b1 = at(xi + 1, yi + 1);
    return (a0 + (b0 - a0) * fx) * (1 - fy) + (a1 + (b1 - a1) * fx) * fy;
  };
  return (x: number, y: number, octaves = 5) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) { s += amp * value(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;
  };
}

const S = 256;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvas(draw: (data: Uint8ClampedArray) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  draw(img.data);
  g.putImageData(img, 0, 0);
  return g.getImageData(0, 0, S, S);
}

/** A storm's cloud mass: billowing, brighter on top, ragged at the edges. */
export function cloudImage(seed: number) {
  const n = makeNoise(seed), n2 = makeNoise(seed + 7), w = makeNoise(seed + 13);
  return canvas((d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // a gentle warp turns round noise into billows and streamers
      const wx = x / 52 + (w(x / 70, y / 70, 3) - 0.5) * 1.6, wy = y / 52 + (w(x / 70 + 9, y / 70 + 4, 3) - 0.5) * 1.6;
      const billow = n(wx, wy, 6);
      const u = x / S - 0.5, v = y / S - 0.5;
      const r = Math.hypot(u, v) * 2;
      const density = billow * 1.5 - r * 1.05 + 0.05;
      const alpha = smooth(0.12, 0.5, density) * (1 - smooth(0.82, 1, r));
      // lit from the north-west: bright tops, grey shadowed bases where the cloud is thin
      const lit = n2(wx - 0.35, wy - 0.35, 4) - billow;
      const c = Math.max(140, Math.min(255, 228 + 70 * lit + 40 * (density - 0.5)));
      const i = (y * S + x) * 4;
      d[i] = c; d[i + 1] = c; d[i + 2] = Math.min(255, c + 8); d[i + 3] = alpha * 238;
    }
  });
}

/** A hurricane from orbit: spiral rain bands round a dense eyewall and a clear eye. */
export function hurricaneImage(seed: number, south: boolean) {
  const n = makeNoise(seed);
  return canvas((d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S - 0.5, v = (south ? -1 : 1) * (y / S - 0.5); // mirrored south: it turns the other way
      const r = Math.hypot(u, v) * 2;
      const th = Math.atan2(v, u);
      const spiral = 0.5 + 0.5 * Math.sin(2 * th + 7 * Math.log(r + 0.04));
      const tex = n(x / 18, y / 18);
      const eyewall = Math.exp(-(((r - 0.11) / 0.05) ** 2));
      const eye = smooth(0.05, 0.085, r);
      const bands = spiral * (0.55 + 0.6 * tex) * (1 - smooth(0.55, 1, r));
      const density = Math.max(eyewall * 1.2, bands * (1 - smooth(0.2, 0.95, r) * 0.4)) * eye;
      const alpha = smooth(0.18, 0.55, density);
      const c = 205 + 50 * Math.min(1, density) - 25 * (1 - tex);
      const i = (y * S + x) * 4;
      d[i] = c; d[i + 1] = c; d[i + 2] = Math.min(255, c + 8); d[i + 3] = alpha * 240;
    }
  });
}

/** Rain streaks, slanting, three frames for a falling shimmer. */
export function rainImage(frame: number) {
  const n = makeNoise(31 + frame, 32);
  return canvas((d) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S - 0.5, v = y / S - 0.5;
      const r = Math.hypot(u, v) * 2;
      const lane = ((x + y * 0.35 + frame * 9) % 9) / 9;
      const streak = lane < 0.12 ? 1 : 0;
      const gap = n(x / 6, (y + frame * 21) / 22) > 0.55 ? 1 : 0;
      const a = streak * gap * (1 - smooth(0.55, 0.95, r));
      const i = (y * S + x) * 4;
      d[i] = 170; d[i + 1] = 185; d[i + 2] = 200; d[i + 3] = a * 140;
    }
  });
}

/** A lightning flash: a white-blue glow around a forked bolt. */
export function flashImage() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(235, 240, 255, 0.95)');
  glow.addColorStop(0.3, 'rgba(190, 210, 255, 0.45)');
  glow.addColorStop(1, 'rgba(160, 190, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(58, 20); g.lineTo(70, 50); g.lineTo(56, 62); g.lineTo(72, 100);
  g.moveTo(56, 62); g.lineTo(44, 84);
  g.stroke();
  return g.getImageData(0, 0, 128, 128);
}
