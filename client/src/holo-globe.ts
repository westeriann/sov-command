// A live holographic globe of the real world, for the Diplomacy window.
// Every pixel is looked up in the province grid each frame, so borders,
// conquests and occupation show as they happen; nations are coloured by how
// they stand with you (the diplomatic map's colours), the night side follows
// the game clock, and arcs join your capital to everyone you have ties with.
// Drag to turn it; click a nation to open its page.
import type { Game } from './game';
import type { Political } from './political';
import { DIPLO_CATS, diploColours, type DiploCat } from './diplo-map';

const ALL = new Set<DiploCat>(DIPLO_CATS.map(([k]) => k));
const TIES: DiploCat[] = ['war', 'truce', 'vassal', 'alliance', 'guarantee', 'trade', 'nap', 'access', 'research', 'contract'];
const CAT_NAME = Object.fromEntries(DIPLO_CATS.map(([k, n]) => [k, n])) as Record<DiploCat, string>;
const CAT_COL = Object.fromEntries(DIPLO_CATS.map(([k, , c]) => [k, c])) as Record<DiploCat, string>;
const D = Math.PI / 180;
const HOLO: [number, number, number] = [124, 196, 255];
const ZOOM_MAX = 4;

export class HoloGlobe {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readout: HTMLDivElement;
  private legend: HTMLDivElement;
  private n = 0; // canvas pixels across
  private img?: ImageData;
  private px?: Float32Array; // per pixel: view x, y, z (0 outside the disk)
  private own?: Int32Array; // per pixel: the nation drawn there, for borders
  private lon0 = 0;
  private lat0 = 18;
  private centred = false;
  private provNation = new Int32Array(0);
  private provOrig = new Int32Array(0);
  private colours = new Map<number, [number, number, number]>();
  private cats = new Map<number, DiploCat>();
  private sun: [number, number, number] = [0, 0, 1];
  private dataAt = 0;
  private lastFrame = 0;
  private idleSince = 0;
  private drag?: { x: number; y: number; lon: number; lat: number; moved: boolean };
  private raf = 0;
  private dirty = true;
  private facing?: number;
  private target?: [number, number];
  private zoom = 1; // 1 = the whole globe; up to ZOOM_MAX times closer
  private zoomFor = 0; // the zoom the per-pixel directions were worked out for
  private over = false; // the pointer is on the globe: hold still so what you aim at stays put
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  onPick?: (nation: number) => void;

  constructor(private game: Game, private pol: Political) {
    this.el = document.createElement('div');
    this.el.className = 'orb';
    this.el.innerHTML = `<div class="orb-stage"><canvas aria-label="Live globe: nations coloured by how they stand with you. Drag to turn it, click a nation to open its page."></canvas><i class="orb-base"></i></div>
      <div class="orb-readout mono">drag to turn · scroll to zoom · click a nation</div><div class="orb-legend"></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.readout = this.el.querySelector('.orb-readout')!;
    this.legend = this.el.querySelector('.orb-legend')!;
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(1, Math.min(ZOOM_MAX, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.idleSince = performance.now();
      this.dirty = true;
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.zoom = 1; this.dirty = true; });
    c.addEventListener('pointerenter', () => { this.over = true; });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, lon: this.lon0, lat: this.lat0, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        const k = 180 / c.clientWidth / this.zoom;
        this.lon0 = this.drag.lon - dx * k;
        this.lat0 = Math.max(-75, Math.min(75, this.drag.lat + dy * k));
        this.idleSince = performance.now();
        this.dirty = true;
      }
      this.hover(e);
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = undefined;
      if (d && !d.moved) {
        const id = this.nationAtEvent(e, true);
        if (id !== undefined && id !== this.game.mine?.id) this.onPick?.(id);
      }
    });
    c.addEventListener('pointerleave', () => { this.over = false; this.idleSince = performance.now(); this.readout.textContent = 'drag to turn · scroll to zoom · click a nation'; });
  }

  /** Put the globe inside an element (the screen's stage) and keep it turning while it shows. */
  mount(parent: Element) {
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
    if (!this.raf) { this.dataAt = 0; this.raf = requestAnimationFrame((t) => this.frame(t)); }
  }

  /** Turn smoothly to face a nation's capital (undefined: carry on turning). */
  lookAt(nation: number | undefined) {
    if (nation === this.facing) return;
    this.facing = nation;
    const cap = nation === undefined ? undefined : this.pol.provinces.get(this.pol.nations.get(nation)?.capital ?? -1);
    this.target = cap ? [cap.label[0], Math.max(-50, Math.min(50, cap.label[1]))] : undefined;
    this.centred = true;
  }

  /** Put the globe into a slot of a freshly drawn window and keep it turning while it shows. */
  attach(slot: Element | null) {
    if (!slot) return;
    slot.replaceWith(this.el);
    this.dataAt = 0;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number) {
    this.raf = 0;
    if (!this.el.isConnected || this.el.offsetParent === null) return; // the window closed: stop until attached again
    this.raf = requestAnimationFrame((u) => this.frame(u));
    if (t - this.lastFrame < 33) return;
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    this.size();
    if (t - this.dataAt > 1000) { this.refresh(); this.dataAt = t; this.dirty = true; }
    if (this.target && !this.drag) {
      let dl = ((this.target[0] - this.lon0 + 540) % 360) - 180;
      const db = this.target[1] - this.lat0;
      const k = this.still ? 1 : Math.min(1, dt * 4);
      this.lon0 += dl * k; this.lat0 += db * k; dl *= 1 - k;
      if (Math.abs(dl) < 0.2 && Math.abs(db * (1 - k)) < 0.2) { this.target = undefined; this.idleSince = t + 6000; }
      this.dirty = true;
    } else if (!this.drag && !this.over && t - this.idleSince > 6000) {
      // left alone for a few seconds: ease back out to the whole globe, then keep turning
      if (this.zoom > 1) { this.zoom = this.still ? 1 : Math.max(1, 1 + (this.zoom - 1) * (1 - Math.min(1, dt * 1.5))); if (this.zoom < 1.01) this.zoom = 1; this.dirty = true; }
      if (!this.still) { this.lon0 += 4 * dt / this.zoom; this.dirty = true; }
    }
    // the sun moves with the game clock every frame, so day and night sweep smoothly instead of jumping
    if (this.sunAt(t)) this.dirty = true;
    if (this.zoomFor !== this.zoom) this.directions();
    if (this.dirty) { this.draw(); this.dirty = false; }
  }

  private size() {
    const css = Math.round(this.canvas.clientWidth) || 300;
    const n = Math.min(640, Math.round(css * Math.min(2, devicePixelRatio || 1)));
    if (n === this.n) return;
    this.n = this.canvas.width = this.canvas.height = n;
    this.img = this.ctx.createImageData(n, n);
    this.px = new Float32Array(n * n * 3);
    this.own = new Int32Array(n * n);
    this.directions();
  }

  /** Each canvas pixel's view direction at the current zoom (0 where it misses the globe). */
  private directions() {
    const n = this.n, px = this.px!, r = this.radius();
    px.fill(0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5 - n / 2) / r, y = -(j + 0.5 - n / 2) / r, q = x * x + y * y;
      if (q >= 1) continue;
      const k = (j * n + i) * 3;
      px[k] = x; px[k + 1] = y; px[k + 2] = Math.sqrt(1 - q);
    }
    this.zoomFor = this.zoom;
    this.dirty = true;
  }

  /** The globe's radius in canvas pixels. */
  private radius() { return (this.n / 2 - 2) * this.zoom; }

  /** Work out where the sun is from the game clock; true if it moved enough to redraw. */
  private sunAt(t: number) {
    if (t - this.sunTime < 100) return false;
    this.sunTime = t;
    const now = this.game.gameNow();
    const start = Date.UTC(now.getUTCFullYear(), 0, 1);
    const doy = (now.getTime() - start) / 864e5;
    const dec = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365) * D;
    const hours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const slon = -(hours - 12) * 15 * D;
    const s: [number, number, number] = [Math.cos(dec) * Math.sin(slon), Math.sin(dec), Math.cos(dec) * Math.cos(slon)];
    const moved = Math.abs(s[0] - this.sun[0]) + Math.abs(s[1] - this.sun[1]) + Math.abs(s[2] - this.sun[2]) > 0.004;
    if (moved) this.sun = s;
    return moved;
  }
  private sunTime = 0;

  /** Owners, colours and the sun: read from the game about once a second. */
  private refresh() {
    const g = this.game, pol = this.pol, me = g.mine?.id;
    const maxId = Math.max(...pol.provinces.keys()) + 1;
    if (this.provNation.length !== maxId) { this.provNation = new Int32Array(maxId); this.provOrig = new Int32Array(maxId); }
    this.provNation.fill(-1); this.provOrig.fill(-1);
    for (const p of pol.provinces.values()) {
      if (p.kind !== 'land' || p.nation === undefined) continue;
      this.provOrig[p.id] = p.nation;
      this.provNation[p.id] = g.war.occupied[p.id] ?? p.nation;
    }
    this.cats.clear();
    this.colours = diploColours(g, pol, ALL, this.cats);
    if (!this.centred && me !== undefined) {
      const cap = pol.provinces.get(pol.nations.get(me)?.capital ?? -1);
      if (cap) { this.lon0 = cap.label[0]; this.lat0 = Math.max(-50, Math.min(50, cap.label[1])); this.centred = true; }
    }
    const shown = TIES.filter((k) => [...this.cats.values()].includes(k));
    this.legend.innerHTML = shown.map((k) => `<span><i style="background:${CAT_COL[k]}"></i>${CAT_NAME[k]}</span>`).join('')
      || '<span class="muted">No ties yet: treaties, trade and wars appear here</span>';
  }

  /** World direction for a view direction (inverse of the camera turn). */
  private toWorld(vx: number, vy: number, vz: number): [number, number, number] {
    const b = this.lat0 * D, l = this.lon0 * D;
    const y = vy * Math.cos(b) + vz * Math.sin(b);
    const z = -vy * Math.sin(b) + vz * Math.cos(b);
    return [vx * Math.cos(l) + z * Math.sin(l), y, -vx * Math.sin(l) + z * Math.cos(l)];
  }

  /** View direction for a world direction. */
  private toView(x: number, y: number, z: number): [number, number, number] {
    const b = this.lat0 * D, l = this.lon0 * D;
    const x1 = x * Math.cos(l) - z * Math.sin(l);
    const z1 = x * Math.sin(l) + z * Math.cos(l);
    return [x1, y * Math.cos(b) - z1 * Math.sin(b), y * Math.sin(b) + z1 * Math.cos(b)];
  }

  private provinceAtWorld(x: number, y: number, z: number) {
    const pol = this.pol;
    const lat = Math.asin(Math.max(-1, Math.min(1, y))), lon = Math.atan2(x, z);
    const gx = Math.min(pol.width - 1, Math.floor(((lon + Math.PI) / (2 * Math.PI)) * pol.width));
    const gy = Math.min(pol.height - 1, Math.max(0, Math.floor(((Math.PI / 2 - lat) / Math.PI) * pol.height)));
    return pol.grid[gy * pol.width + gx];
  }

  private draw() {
    const n = this.n, px = this.px!, own = this.own!, data = this.img!.data;
    const b = this.lat0 * D, l = this.lon0 * D, cb = Math.cos(b), sb = Math.sin(b), cl = Math.cos(l), sl = Math.sin(l);
    const [sx, sy, sz] = this.sun;
    const pn = this.provNation, po = this.provOrig, cols = this.colours, me = this.game.mine?.id ?? -2;
    const grid = this.pol.grid, W = this.pol.width, H = this.pol.height;
    const nationRgb = new Map<number, [number, number, number]>();
    const colourOf = (id: number) => {
      let c = nationRgb.get(id);
      if (!c) {
        const base = cols.get(id) ?? [106, 110, 115];
        c = [base[0] * 0.72 + HOLO[0] * 0.28, base[1] * 0.72 + HOLO[1] * 0.28, base[2] * 0.72 + HOLO[2] * 0.28];
        nationRgb.set(id, c);
      }
      return c;
    };
    for (let j = 0, k = 0; j < n; j++) {
      for (let i = 0; i < n; i++, k++) {
        const vz = px[k * 3 + 2], o = k * 4;
        if (vz === 0) { data[o + 3] = 0; own[k] = -9; continue; }
        const vx = px[k * 3], vy = px[k * 3 + 1];
        const y = vy * cb + vz * sb, z0 = -vy * sb + vz * cb;
        const x = vx * cl + z0 * sl, z = -vx * sl + z0 * cl;
        const lat = Math.asin(y), lon = Math.atan2(x, z);
        const gx = Math.min(W - 1, ((lon + Math.PI) * (W / (2 * Math.PI))) | 0);
        const gy = Math.min(H - 1, ((Math.PI / 2 - lat) * (H / Math.PI)) | 0);
        const prov = grid[gy * W + gx];
        const nat = pn[prov] ?? -1;
        own[k] = nat;
        // a soft, wide twilight band and a night side that stays readable: at the
        // game's speed a day passes in seconds, so a hard dark side would strobe
        const day = Math.max(0, Math.min(1, ((x * sx + y * sy + z * sz) + 0.25) / 0.5));
        const light = 0.6 + 0.4 * day;
        const rim = (1 - vz) * (1 - vz) * (1 - vz);
        let r: number, g: number, bl: number, a: number;
        if (nat < 0) {
          r = 14; g = 40; bl = 78; a = 215;
        } else {
          let c = colourOf(nat);
          if (po[prov] !== nat && (((i + j) >> 2) & 1)) c = colourOf(po[prov]); // occupied: stripes of the old owner
          r = c[0]; g = c[1]; bl = c[2]; a = 235;
          if (nat === me) { r = r * 0.8 + 51; g = g * 0.8 + 51; bl = bl * 0.8 + 51; }
          const left = i > 0 ? own[k - 1] : nat, up = j > 0 ? own[k - n] : nat;
          if ((left !== nat && left !== -9) || (up !== nat && up !== -9)) {
            const coast = left < 0 || up < 0;
            const f = coast ? 0.55 : 0.7, t = coast ? HOLO : [235, 246, 255];
            r = r * (1 - f) + t[0] * f; g = g * (1 - f) + t[1] * f; bl = bl * (1 - f) + t[2] * f;
          }
        }
        data[o] = Math.min(255, r * light + HOLO[0] * rim * 0.9);
        data[o + 1] = Math.min(255, g * light + HOLO[1] * rim * 0.9);
        data[o + 2] = Math.min(255, bl * light + HOLO[2] * rim * 0.9);
        data[o + 3] = Math.min(255, a + rim * 60);
      }
    }
    const ctx = this.ctx;
    ctx.putImageData(this.img!, 0, 0);
    this.overlay(ctx);
  }

  private project(lon: number, lat: number, alt = 1): [number, number, number] {
    const la = lat * D, lo = lon * D;
    const [x, y, z] = this.toView(Math.cos(la) * Math.sin(lo) * alt, Math.sin(la) * alt, Math.cos(la) * Math.cos(lo) * alt);
    const r = this.radius();
    return [this.n / 2 + x * r, this.n / 2 - y * r, z];
  }

  private overlay(ctx: CanvasRenderingContext2D) {
    const n = this.n, s = n / 300;
    ctx.lineWidth = Math.max(1, s * 0.8);
    ctx.strokeStyle = 'rgba(124,196,255,0.16)';
    for (let lat = -60; lat <= 60; lat += 30) this.line(ctx, (t) => [t * 360 - 180, lat]);
    for (let lon = -180; lon < 180; lon += 30) this.line(ctx, (t) => [lon, t * 180 - 90]);
    // atmosphere
    ctx.beginPath(); ctx.arc(n / 2, n / 2, this.radius(), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(124,196,255,0.85)'; ctx.lineWidth = 1.4 * s; ctx.stroke();
    const me = this.game.mine?.id;
    if (me === undefined) return;
    const capOf = (id: number) => this.pol.provinces.get(this.pol.nations.get(id)?.capital ?? -1)?.label;
    const home = capOf(me);
    if (!home) return;
    const a = this.unit(home[0], home[1]);
    for (const [id, cat] of this.cats) {
      if (!TIES.includes(cat)) continue;
      const c = capOf(id);
      if (!c) continue;
      const bv = this.unit(c[0], c[1]);
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * bv[0] + a[1] * bv[1] + a[2] * bv[2])));
      ctx.strokeStyle = CAT_COL[cat];
      ctx.lineWidth = (cat === 'alliance' || cat === 'war' ? 2.4 : 1.6) * s;
      ctx.setLineDash(cat === 'war' ? [7 * s, 5 * s] : cat === 'truce' ? [2 * s, 4 * s] : []);
      ctx.beginPath();
      let pen = false;
      for (let t = 0; t <= 1.0001; t += 1 / 40) {
        const p = this.slerp(a, bv, ang, t);
        const h = 1 + 0.06 + 0.22 * Math.sin(Math.PI * t) * (ang / Math.PI + 0.15);
        const [x, y, z] = this.toView(p[0] * h, p[1] * h, p[2] * h);
        const r = this.radius(), X = n / 2 + x * r, Y = n / 2 - y * r;
        const seen = z > 0 || x * x + y * y > 1;
        if (seen) { if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); pen = true; } else pen = false;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const [X, Y, z] = this.project(c[0], c[1]);
      if (z > 0) {
        ctx.fillStyle = CAT_COL[cat];
        ctx.beginPath(); ctx.arc(X, Y, 3.2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.font = `600 ${Math.round(11 * s)}px "Exo 2", sans-serif`;
        ctx.fillStyle = 'rgba(227,241,255,0.95)';
        ctx.fillText(this.pol.nations.get(id)?.name ?? '', Math.round(X + 6 * s), Math.round(Y - 4 * s));
      }
    }
    const [X, Y, z] = this.project(home[0], home[1]);
    if (z > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(X, Y, 4.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2 * s;
      ctx.beginPath(); ctx.arc(X, Y, 10 * s, 0, Math.PI * 2); ctx.stroke();
    }
  }

  private unit(lon: number, lat: number): [number, number, number] {
    return [Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D), Math.cos(lat * D) * Math.cos(lon * D)];
  }

  private slerp(a: number[], b: number[], ang: number, t: number) {
    if (ang < 1e-4) return a;
    const s = Math.sin(ang), p = Math.sin((1 - t) * ang) / s, q = Math.sin(t * ang) / s;
    return [a[0] * p + b[0] * q, a[1] * p + b[1] * q, a[2] * p + b[2] * q];
  }

  private line(ctx: CanvasRenderingContext2D, at: (t: number) => [number, number]) {
    ctx.beginPath();
    let pen = false;
    for (let t = 0; t <= 1.0001; t += 1 / 72) {
      const [lon, lat] = at(t);
      const [X, Y, z] = this.project(lon, lat);
      if (z > 0) { if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); pen = true; } else pen = false;
    }
    ctx.stroke();
  }

  /**
   * The nation under the pointer. For a click (`generous`), a small nation within a few
   * pixels wins over your own or the sea, so tiny neighbours can be picked.
   */
  private nationAtEvent(e: PointerEvent, generous = false) {
    const r = this.canvas.getBoundingClientRect();
    const scale = this.n / r.width; // canvas pixels per CSS pixel
    const at = (cx: number, cy: number) => {
      const x = (cx - this.n / 2) / this.radius(), y = -(cy - this.n / 2) / this.radius();
      const q = x * x + y * y;
      if (q >= 1) return -1;
      const [wx, wy, wz] = this.toWorld(x, y, Math.sqrt(1 - q));
      return this.provNation[this.provinceAtWorld(wx, wy, wz)] ?? -1;
    };
    const cx = (e.clientX - r.left) * scale, cy = (e.clientY - r.top) * scale;
    const hit = at(cx, cy);
    const me = this.game.mine?.id ?? -2;
    if (generous && (hit < 0 || hit === me)) {
      const reach = 7 * scale;
      let best = -1, bestD = Infinity;
      for (let dy = -reach; dy <= reach; dy += scale) for (let dx = -reach; dx <= reach; dx += scale) {
        const d = dx * dx + dy * dy;
        if (d > reach * reach || d >= bestD) continue;
        const id = at(cx + dx, cy + dy);
        if (id >= 0 && id !== me) { best = id; bestD = d; }
      }
      if (best >= 0) return best;
    }
    return hit >= 0 ? hit : undefined;
  }

  private hover(e: PointerEvent) {
    const id = this.nationAtEvent(e, true);
    if (id === undefined) { this.readout.textContent = 'drag to turn · scroll to zoom · click a nation'; this.canvas.style.cursor = 'grab'; return; }
    const name = this.pol.nations.get(id)?.name ?? '';
    const me = this.game.mine;
    const cat = this.cats.get(id);
    const o = me?.relations?.[id]?.total;
    const what = id === me?.id ? 'your nation' : cat && cat !== 'opinion' ? CAT_NAME[cat].toLowerCase() : 'no ties';
    this.readout.textContent = `${name} · ${what}${o !== undefined && id !== me?.id ? ` · opinion ${o > 0 ? '+' : ''}${o}` : ''}`;
    this.canvas.style.cursor = this.drag ? 'grabbing' : 'pointer';
  }
}

