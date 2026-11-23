// Land forces on the client: unit markers that glide between provinces in game
// time, selection and move orders, route lines, battles, and the Forces window.
import { Marker, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { money } from '../../shared/economy';
import {
  bestRoute, distanceKm, domainOf, legDays, STRIKERS, UNIT_ROLE, UNIT_SPECS, UNIT_TECH, UNIT_TYPES, type Domain, type Mission, type RouteNode, type UnitType, type UnitView,
} from '../../shared/military';
import type { Game } from './game';
import { seasonSlow } from '../../shared/seasons';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';
import { attr, tip } from './tooltip';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Filled silhouettes (24×24), drawn in the nation's contrast colour. */
export const ICON: Record<UnitType, string> = {
  infantry: '<circle cx="11" cy="4.2" r="2.4"/><path d="M8.2 7.6h5.6l1.3 6.4h-1.9l-.9 7.6h-2l-.4-5.4-.4 5.4h-2L7 14H5.9z"/><path d="M14.6 9.4l5.2-6 1 .9-5.2 6z"/>',
  mechanized: '<path d="M2.5 10.5h14l3.5 3.2v3H2.5z"/><path d="M8 7h5.5v3.5H8z"/><path d="M13.5 8h5v1.2h-5z"/><circle cx="5.5" cy="18" r="1.9"/><circle cx="10" cy="18" r="1.9"/><circle cx="14.5" cy="18" r="1.9"/><circle cx="19" cy="18" r="1.9"/>',
  armored: '<path d="M7.5 7.5h7.5l1.2 4H6.4z"/><path d="M15.5 8.6h7v1.5h-7z"/><path d="M3 11.5h18l-1.5 3H4.5z"/><rect x="2" y="14.5" width="20" height="5" rx="2.5"/>',
  destroyers: '<path d="M1 14h22l-3.5 4.5H4.5z"/><path d="M7.5 10h7v4h-7z"/><path d="M10.5 4.5h1.2v5.5h-1.2z"/><path d="M15.5 12.4h5v1.2h-5z"/><path d="M3 12.4h4v1.2H3z"/>',
  submarines: '<path d="M2 15.2C2 13.4 5 12 8 12h10c3 0 5 1.4 5 3.2s-2 3.2-5 3.2H8c-3 0-6-1.4-6-3.2z"/><path d="M10 8.5h4l1.2 3.5H9z"/><path d="M11.5 5.5h1v3h-1z"/>',
  carrier: '<path d="M1 11.5h22v2.2H1z"/><path d="M3 13.7h18l-2 4.8H5z"/><path d="M16 6.5h3.2v5H16z"/><path d="M17 4h1v2.5h-1z"/>',
  fighters: '<path d="M12 1.5l1.6 5.3 7.4 6.4v2.2l-7.3-2.2-.5 5.3 3 2.2v1.6L12 21l-4.2 1.3v-1.6l3-2.2-.5-5.3L3 15.4v-2.2l7.4-6.4z"/>',
  strike: '<path d="M12 1.5l1.6 4.3V10l9.4 3v2.4l-9.4-1.6v5l3.1 2v1.7L12 21.6l-4.7.9v-1.7l3.1-2v-5L1 15.4V13l9.4-3V5.8z"/>',
  marines: '<circle cx="9" cy="4.2" r="2.3"/><path d="M6.4 7.4h5.2l1.2 5.6h-1.8l-.8 5h-1.9l-.4-3.6-.4 3.6H5.6L4.9 13H3.6z"/><path d="M1 19c3-2 5 2 8 0s5 2 8 0 5 2 7 0v3H1z"/><path d="M14 4h2v6h4l-3 3-3-3z"/>',
  special_forces: '<circle cx="12" cy="4.5" r="2.4"/><path d="M8 8h8l1 6h-2l-.8 7.5h-2.4L11.5 16l-.3 5.5H8.8L8 14H6z"/><path d="M3 12l6-4 1 1-6 4zM21 12l-6-4-1 1 6 4z"/>',
  drones: '<path d="M10 10h4v4h-4z"/><path d="M5 5l5 5M19 5l-5 5M5 19l5-5M19 19l-5-5" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>',
  bombers: '<path d="M12 2l1.4 5V9l9.6 4v2l-9.6-2v4l3 2.5V21L12 20l-4.4 1v-1.5l3-2.5v-4L1 15v-2l9.6-4V7z"/><path d="M5 14h2v2H5zM17 14h2v2h-2z"/>',
};
const DOMAIN_NAMES: Record<Domain, string> = { land: 'LAND', sea: 'SEA', air: 'AIR' };
/** The forces window has a view per arm: its title, what its units are called, and how to use them. */
const VIEWS: Record<Domain, { title: string; units: string; none: string; where: string; empty: string }> = {
  land: { title: 'GROUND FORCES', units: 'div', none: 'Take command of a nation to raise and move armies.', where: 'ARMIES BY LOCATION', empty: 'No divisions yet: recruit some above.' },
  sea: { title: 'NAVAL OPS', units: 'ships', none: 'Take command of a nation to build fleets.', where: 'FLEETS BY LOCATION', empty: 'No fleets yet: recruit ships above. They put to sea from a coastal province.' },
  air: { title: 'AIR COMMAND', units: 'wings', none: 'Take command of a nation to raise an air force.', where: 'AIR WINGS BY BASE', empty: 'No air wings yet: recruit some above. Air bases let them fly 30% farther.' },
};

function circle(center: [number, number], km: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const dLat = (km / 111) * Math.sin(a);
    const dLon = ((km / 111) * Math.cos(a)) / Math.max(0.15, Math.cos((center[1] * Math.PI) / 180));
    pts.push([center[0] + dLon, Math.max(-85, Math.min(85, center[1] + dLat))]);
  }
  return pts;
}

export interface ForcesActions {
  move(units: number[], to: number): void;
  halt(units: number[]): void;
  mission(units: number[], mission: Mission | null): void;
  recruit(type: UnitType): void;
  peace(target: number): void;
  general(unit: number): void;
  warhead(): void;
  satellite(): void;
  goToProvince(id: number): void;
}

type Pos = [number, number];

/** The point a fraction t of the way from a to b along the shortest path over the globe. */
function greatCircle(a: Pos, b: Pos, t: number): Pos {
  const r = Math.PI / 180;
  const v = ([lon, lat]: Pos) => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
  const A = v(a), B = v(b);
  const d = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (d < 1e-6) return a;
  const s = Math.sin(d), ka = Math.sin((1 - t) * d) / s, kb = Math.sin(t * d) / s;
  const x = ka * A[0] + kb * B[0], y = ka * A[1] + kb * B[1], z = ka * A[2] + kb * B[2];
  return [Math.atan2(y, x) / r, Math.atan2(z, Math.hypot(x, y)) / r];
}

/**
 * Set a marker's own classes without touching the map library's (maplibregl-marker
 * and friends), which pin the element to its point. Overwriting className drops them,
 * and the marker then floats in page flow, away from its province.
 */
function setClasses(el: HTMLElement, classes: string) {
  const want = new Set(classes.split(' ').filter(Boolean));
  for (const c of [...el.classList]) if (!c.startsWith('maplibregl-') && !want.has(c)) el.classList.remove(c);
  for (const c of want) el.classList.add(c);
}

export class Forces {
  selected = new Set<number>();
  private markers = new Map<string, { marker: Marker; el: HTMLElement; units: UnitView[]; html?: string }>();
  private lastPanel = '';
  private battleMarkers = new Map<number, Marker>();
  private nodes: Map<number, RouteNode>;
  private panel: HTMLElement;
  private onSelect: () => void = () => {};
  private openStack: string | null = null;

  constructor(private map: MLMap, private game: Game, private pol: Political, root: HTMLElement, private actions: ForcesActions) {
    this.nodes = new Map([...pol.provinces.values()].map((p) => [p.id, p as unknown as RouteNode]));
    map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'routes', type: 'line', source: 'routes',
      paint: {
        'line-color': ['match', ['get', 'k'], 'range', '#5fd4ea', 'mission', '#ffb547', ['case', ['get', 'sel'], '#9be9f7', '#5fd4ea']],
        'line-width': ['match', ['get', 'k'], 'range', 1, ['case', ['get', 'sel'], 2.4, 1.2]],
        'line-opacity': ['match', ['get', 'k'], 'range', 0.6, 0.85],
        'line-dasharray': [2, 1.5],
      },
    });
    game.on((c) => {
      if (c.has('units') || c.has('war') || c.has('status')) this.render();
      if ((c.has('mine') || c.has('units') || c.has('war')) && !this.panel.hidden) this.renderPanel();
    });
    const loop = () => { this.animate(); window.setTimeout(() => requestAnimationFrame(loop), 100); };
    loop();

    this.panel = document.createElement('section');
    this.panel.className = 'panel econ-window forces-window';
    keepScrollOn(this.panel); // redraws keep your place in the list
    this.panel.setAttribute('aria-label', 'Ground forces');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
  }

  set onSelectionChange(fn: () => void) { this.onSelect = fn; }
  get isOpen() { return !this.panel.hidden; }
  /** Which arm the window shows. */
  view: Domain = 'land';
  /** Open the window on an arm, or close it if that arm is already showing. */
  toggle(view: Domain = 'land') {
    if (!this.panel.hidden && this.view === view) { this.panel.hidden = true; return; }
    this.view = view;
    this.panel.setAttribute('aria-label', VIEWS[view].title.toLowerCase());
    this.panel.hidden = false;
    this.lastPanel = '';
    this.renderPanel();
  }
  close() { this.panel.hidden = true; }

  // ---- markers --------------------------------------------------------------------
  private label(p: number): Pos {
    return this.pol.provinces.get(p)?.label ?? [0, 0];
  }

  private position(u: UnitView): Pos {
    const a = this.label(u.province);
    if (u.next === undefined || !u.legStart || !u.legEnd) return a;
    const b = this.label(u.next);
    const t = Math.min(1, Math.max(0, (this.game.gameNow().getTime() - u.legStart) / (u.legEnd - u.legStart)));
    return greatCircle(a, b, t);
  }

  private render() {
    const mine = this.game.mine?.id;
    const groups = new Map<string, UnitView[]>();
    for (const u of this.game.units) {
      // one stack per nation per province; units travelling the same leg together move as one
      const key = u.next === undefined ? `p${u.province}:${u.nation}` : `m${u.nation}:${u.province}:${u.next}:${Math.round((u.legEnd ?? 0) / 3_600_000)}`;
      groups.set(key, [...(groups.get(key) ?? []), u]);
    }
    for (const [key, m] of this.markers) {
      if (!groups.has(key)) { m.marker.remove(); this.markers.delete(key); }
    }
    for (const id of [...this.selected]) if (!this.game.units.some((u) => u.id === id && u.nation === mine)) this.selected.delete(id);
    for (const [key, units] of groups) {
      let m = this.markers.get(key);
      if (!m) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'unit-marker';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
          if (pick) this.pickType(key, pick.dataset.pick as UnitType);
          else this.clickMarker(key, (e as MouseEvent).shiftKey);
        });
        m = { marker: new Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(this.position(units[0])).addTo(this.map), el, units };
        this.markers.set(key, m);
      }
      m.units = units;
      const u0 = units[0];
      const nation = this.pol.nations.get(u0.nation);
      const side = u0.nation === mine ? 'own' : this.game.atWar(mine, u0.nation) ? 'enemy' : 'other';
      const counts = UNIT_TYPES.map((t) => [t, units.filter((u) => u.type === t).length] as const).filter(([, c]) => c > 0);
      const strength = Math.round(units.reduce((s, u) => s + u.strength, 0) / units.length);
      const sel = units.some((u) => this.selected.has(u.id));
      // the stack shows its strongest arm: tanks over troops, carriers over escorts
      const lead = [...counts].sort((a, b) => b[1] * UNIT_SPECS[b[0]].attack - a[1] * UNIT_SPECS[a[0]].attack)[0][0];
      const domains = new Set(units.map((u) => domainOf(u.type)));
      const shape = domains.size === 1 ? `d-${[...domains][0]}` : 'd-mixed';
      const cutOff = units.some((u) => u.supplied === false);
      const general = units.find((u) => u.general)?.general;
      setClasses(m.el, `unit-marker ${side} ${shape}${cutOff ? ' nosupply' : ''}${sel ? ' selected' : ''}${this.openStack === key ? ' open' : ''}${units.some((u) => u.status === 'fighting') ? ' fighting' : ''}`);
      m.el.style.setProperty('--nation', nation?.color ?? '#888');
      const summary = counts.map(([t, c]) => `${c} ${UNIT_SPECS[t].name.toLowerCase()}`).join(', ');
      m.el.setAttribute('aria-label', `${nation?.short ?? ''} forces: ${summary}; ${strength}% strength${general ? `; led by ${general.name} (skill ${general.skill})` : ''}${cutOff ? '; OUT OF SUPPLY' : ''}`);
      m.el.removeAttribute('title');
      m.el.dataset.tip = tip(`${nation?.name ?? ''} forces`, ...counts.map(([t, c]) => `${c} × ${UNIT_SPECS[t].name}`),
        [`Strength ${strength}%`, strength >= 60 ? 'good' : 'bad'], cutOff ? ['Out of supply: weaker, losing strength', 'bad'] : null,
        general ? [`Led by ${general.name} (skill ${general.skill})`, 'good'] : null, side === 'own' ? 'Click to select · right-click a province to move' : side === 'enemy' ? ['Enemy', 'bad'] : null);
      const extras = counts.filter(([t]) => t !== lead).slice(0, 3);
      const inner = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[lead]}</svg>`
        + (units.length > 1 ? `<b>${units.length}</b>` : '')
        + (extras.length ? `<span class="mini">${extras.map(([t]) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t]}</svg>`).join('')}</span>` : '')
        + (general ? `<span class="star" aria-hidden="true">${'★'.repeat(Math.min(3, general.skill))}</span>` : '')
        + `<i style="width:${strength}%"></i>`
        + (this.openStack === key && side === 'own' ? `<span class="stack-list" role="menu">${counts.map(([t, c]) => `<span role="menuitem" tabindex="0" data-pick="${t}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t]}</svg>${c} × ${UNIT_SPECS[t].name}</span>`).join('')}</span>` : '');
      if (m.html !== inner) { m.html = inner; m.el.innerHTML = inner; } // redraw only what changed
    }
    // several nations' stacks in one province (a battle, allies side by side): spread them
    // out around the province's point, ours first, so none hides another
    const byProvince = new Map<number, string[]>();
    for (const [key, units] of groups) {
      if (units[0].next !== undefined) continue;
      byProvince.set(units[0].province, [...(byProvince.get(units[0].province) ?? []), key]);
    }
    this.spread.clear();
    for (const keys of byProvince.values()) {
      keys.sort((x, y) => Number(groups.get(y)![0].nation === mine) - Number(groups.get(x)![0].nation === mine) || x.localeCompare(y));
      keys.forEach((key, i) => this.spread.set(key, (i - (keys.length - 1) / 2)));
    }
    this.applyOffsets();
    // battles
    const battles = new Set(this.game.war.battles);
    for (const [p, mk] of this.battleMarkers) if (!battles.has(p)) { mk.remove(); this.battleMarkers.delete(p); }
    for (const p of battles) {
      if (this.battleMarkers.has(p)) continue;
      const el = document.createElement('div');
      el.className = 'battle-ring';
      this.battleMarkers.set(p, new Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(this.label(p)).addTo(this.map));
    }
    this.renderRoutes();
  }

  /** Slot of each stack sharing a province: 0 alone, else -1, 0, 1... from left to right. */
  private spread = new Map<string, number>();
  private lift = 0;

  private applyOffsets() {
    for (const [key, m] of this.markers) m.marker.setOffset([(this.spread.get(key) ?? 0) * 42, -this.lift]);
  }

  /** Raise the counters this many pixels, so they float over the 3D models beneath them. */
  setLift(px: number) {
    px = Math.round(px);
    if (px === this.lift) return;
    this.lift = px;
    this.applyOffsets();
  }

  /** Every stack on the map now, where it is and where it is heading, for the 3D layer. */
  stacks(): { key: string; units: UnitView[]; at: Pos; toward?: Pos; slot: number; fighting: boolean }[] {
    const out = [];
    for (const [key, m] of this.markers) {
      const u = m.units[0];
      out.push({
        key, units: m.units, at: this.position(u), slot: this.spread.get(key) ?? 0,
        toward: u.next !== undefined ? this.label(u.next) : undefined,
        fighting: m.units.some((x) => x.status === 'fighting'),
      });
    }
    return out;
  }

  private animate() {
    for (const m of this.markers.values()) if (m.units[0].next !== undefined) m.marker.setLngLat(this.position(m.units[0]));
  }

  private renderRoutes() {
    const mine = this.game.mine?.id;
    const own = this.game.units.filter((u) => u.nation === mine);
    // keep each step within 180 degrees of the last, so a route over the date line takes the short way
    const unwrap = (pts: [number, number][]) => {
      const out: [number, number][] = [];
      for (const [lon, lat] of pts) {
        let x = lon;
        if (out.length) { const prev = out[out.length - 1][0]; while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360; }
        out.push([x, lat]);
      }
      return out;
    };
    const line = (k: string, sel: boolean, coordinates: [number, number][]) =>
      ({ type: 'Feature' as const, properties: { k, sel }, geometry: { type: 'LineString' as const, coordinates: unwrap(coordinates) } });
    const features = [
      ...own.filter((u) => u.next !== undefined).map((u) =>
        line('route', this.selected.has(u.id), [u.province, u.next!, ...(u.path ?? [])].map((p) => this.label(p)))),
      // air wings: a line to their mission, and the combat radius when selected
      ...own.filter((u) => u.mission && u.next === undefined).map((u) =>
        line('mission', this.selected.has(u.id), [this.label(u.province), this.label(u.mission!.target)])),
      ...own.filter((u) => this.selected.has(u.id) && UNIT_SPECS[u.type].range && domainOf(u.type) === 'air').map((u) =>
        line('range', true, circle(this.label(u.province), UNIT_SPECS[u.type].range!))),
    ];
    (this.map.getSource('routes') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  /** Select a stack as if its counter were clicked (a click on its 3D model). */
  clickStack(key: string, add = false) { this.clickMarker(key, add); }

  private clickMarker(key: string, add: boolean) {
    const m = this.markers.get(key);
    if (!m) return;
    const mine = this.game.mine?.id;
    const own = m.units.filter((u) => u.nation === mine);
    if (!own.length) { this.actions.goToProvince(m.units[0].province); return; }
    // clicking a selected stack again opens its list, to pick out one type
    const whole = own.every((u) => this.selected.has(u.id));
    this.openStack = whole && !add && this.openStack !== key && own.length > 1 ? key : null;
    if (!add) this.selected.clear();
    for (const u of own) this.selected.add(u.id);
    this.render();
    this.onSelect();
    if (!this.panel.hidden) this.renderPanel();
  }

  private pickType(key: string, type: UnitType) {
    const m = this.markers.get(key);
    if (!m) return;
    this.selected = new Set(m.units.filter((u) => u.nation === this.game.mine?.id && u.type === type).map((u) => u.id));
    this.openStack = null;
    this.render();
    this.onSelect();
    if (!this.panel.hidden) this.renderPanel();
  }

  /** Select these units of ours (the command card's Tab). */
  selectUnits(ids: number[]) {
    const me = this.game.mine?.id;
    this.selected = new Set(this.game.units.filter((u) => u.nation === me && ids.includes(u.id)).map((u) => u.id));
    this.openStack = null;
    this.render();
    this.onSelect();
    if (!this.panel.hidden) this.renderPanel();
  }

  /** Select your units standing in a province. */
  selectAt(province: number) {
    const me = this.game.mine?.id;
    this.selected = new Set(this.game.units.filter((u) => u.nation === me && u.province === province && u.next === undefined).map((u) => u.id));
    this.openStack = null;
    this.render();
    this.onSelect();
    if (!this.panel.hidden) this.renderPanel();
  }

  clearSelection() {
    this.openStack = null;
    if (!this.selected.size) return;
    this.selected.clear();
    this.render();
    this.onSelect();
  }

  /** Route preview for the selection: slowest unit's arrival, or null if unreachable. */
  preview(to: number): { days: number } | null {
    const mine = this.game.mine?.id;
    if (!mine || !this.selected.size) return null;
    // mirrors the server: fleets at sea; troops on allowed land, or at sea by transport; air rebases to our land
    const canEnter = (domain: Domain) => (p: number) => {
      const prov = this.pol.provinces.get(p);
      if (!prov) return false;
      if (domain === 'sea') return prov.kind === 'sea';
      if (prov.kind === 'sea') return true;
      const ctrl = this.game.war.occupied[p] ?? prov.nation;
      return prov.nation === mine || ctrl === mine || this.game.atWar(mine, ctrl) || this.game.atWar(mine, prov.nation);
    };
    let days = 0;
    for (const u of this.game.units.filter((x) => this.selected.has(x.id))) {
      const domain = domainOf(u.type);
      if (domain === 'air') {
        const target = this.pol.provinces.get(to);
        const ctrl = target ? this.game.war.occupied[to] ?? target.nation : undefined;
        if (!target || ctrl !== mine) return null;
        days = Math.max(days, distanceKm(this.label(u.province), target.label) / UNIT_SPECS[u.type].speed);
        continue;
      }
      const r = bestRoute(this.nodes, u.next ?? u.province, to, u.type, canEnter(domain));
      if (!r) return null;
      // winter roads: the same slowdown the server applies, leg by leg
      const now = this.game.gameNow().getTime();
      let total = 0, at = u.next ?? u.province;
      for (const q of r.path) {
        const a = this.pol.provinces.get(at), b = this.pol.provinces.get(q);
        if (a && b) total += legDays(a as never, b as never, u.type) * (domain === 'land' && b.kind === 'land' ? seasonSlow(now + total * 86_400_000, b.terrain, b.label[1]) : 1);
        at = q;
      }
      days = Math.max(days, total || r.days);
    }
    return { days };
  }

  moveSelectedTo(to: number) {
    if (this.selected.size) this.actions.move([...this.selected], to);
  }

  /**
   * Right-click: land and sea units move there; air wings fly a mission over it
   * (fighters patrol, strike wings support).
   */
  orderAt(to: number) {
    const sel = this.game.units.filter((u) => this.selected.has(u.id));
    const movers = sel.filter((u) => domainOf(u.type) !== 'air').map((u) => u.id);
    if (movers.length) this.actions.move(movers, to);
    const fighters = sel.filter((u) => u.type === 'fighters').map((u) => u.id);
    const strikes = sel.filter((u) => STRIKERS.includes(u.type)).map((u) => u.id);
    if (fighters.length) this.actions.mission(fighters, { kind: 'patrol', target: to });
    // strike wings: support a battle, or bomb enemy industry where there is no fighting
    const prov = this.pol.provinces.get(to);
    const ctrl = prov ? this.game.war.occupied[to] ?? prov.nation : undefined;
    const bomb = this.game.atWar(this.game.mine?.id, ctrl) && !this.game.war.battles.includes(to);
    if (strikes.length) this.actions.mission(strikes, { kind: bomb ? 'bomb' : 'support', target: to });
  }

  // ---- Forces window ---------------------------------------------------------------
  private onPanelClick(e: Event) {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-f]');
    if (!act) return;
    const f = act.dataset.f;
    if (f === 'close') { this.close(); document.dispatchEvent(new CustomEvent('forces-closed')); }
    else if (f === 'recruit') this.actions.recruit(act.dataset.type as UnitType);
    else if (f === 'peace') this.actions.peace(Number(act.dataset.target));
    else if (f === 'halt') this.actions.halt([...this.selected]);
    else if (f === 'standdown') this.actions.mission([...this.selected], null);
    else if (f === 'general') this.actions.general(Number(act.dataset.unit));
    else if (f === 'warhead') this.actions.warhead();
    else if (f === 'satellite') this.actions.satellite();
    else if (f === 'goto') {
      const p = Number(act.dataset.province);
      this.selected = new Set(this.game.units.filter((u) => u.nation === this.game.mine?.id && u.province === p && u.next === undefined).map((u) => u.id));
      this.render();
      this.onSelect();
      this.actions.goToProvince(p);
      this.renderPanel();
    }
  }

  renderPanel() {
    const mine = this.game.mine;
    const mil = mine?.mil;
    const view = VIEWS[this.view];
    const name = mine ? this.pol.nations.get(mine.id)?.name ?? '' : view.title.charAt(0) + view.title.slice(1).toLowerCase();
    if (!mine || !mil) {
      this.lastPanel = '';
      this.panel.innerHTML = `<div class="econ-head"><div><span class="label">${view.title}</span><h2>${esc(name)}</h2></div><button type="button" class="link" data-f="close">Close</button></div>
        <div class="econ-body"><p class="hint">${view.none}</p></div>`;
      return;
    }
    const units = this.game.units.filter((u) => u.nation === mine.id);
    const armUnits = units.filter((u) => domainOf(u.type) === this.view);
    const byProv = new Map<number, UnitView[]>();
    for (const u of armUnits) { const k = u.next ?? u.province; byProv.set(k, [...(byProv.get(k) ?? []), u]); }
    const wars = this.game.war.wars.filter((w) => w.a === mine.id || w.b === mine.id);
    const day = this.game.market?.day ?? 0;
    const sel = units.filter((u) => this.selected.has(u.id));
    const html = `
      <div class="econ-head"><div><span class="label">${view.title}</span><h2>${esc(name)}</h2></div><button type="button" class="link" data-f="close">Close</button></div>
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Forces</span><b>${units.length}</b><em>${(['land', 'sea', 'air'] as Domain[]).map((d) => `${units.filter((u) => domainOf(u.type) === d).length} ${d}`).join(' · ')}</em></div>
          <div><span>Military funds</span><b class="${mil.funds < 0 ? 'down' : ''}">${money(mil.funds)}</b><em>+${money(mil.income)}/yr · upkeep ${money(mil.upkeep)}/yr</em></div>
          <div><span>Reservists free</span><b>${(mil.manpower / 1e3).toFixed(0)}k</b><em>men available to recruit</em></div>
          <div><span>Wars</span><b class="${wars.length ? 'down' : ''}">${wars.length}</b><em>${this.game.mine?.econ ? `munitions ${this.game.mine.econ.munitions}%` : ''}</em></div>
        </div>
        ${sel.length ? `<section class="selection">
          <span class="label">SELECTED · ${sel.map((u) => UNIT_SPECS[u.type].name).filter((v, i, a) => a.indexOf(v) === i).join(', ')} (${sel.length})</span>
          <p class="hint">Right-click on the map (long-press on a touch screen): troops and ships move there (troops cross the sea by transport); fighters patrol over it and strike wings support battles there, within their combat radius (the ring). To rebase aircraft, use "Move selected here" on one of your provinces. One game day is about ten seconds.</p>
          ${(() => {
            const gens = sel.filter((u) => u.general);
            const candidate = sel.find((u) => domainOf(u.type) === 'land' && !u.general);
            const cut = sel.filter((u) => u.supplied === false).length;
            return `${gens.map((u) => `<p class="hint">★ ${esc(u.general!.name)} · skill ${u.general!.skill} of 5 · ${u.general!.xp} xp</p>`).join('')}
              ${cut ? `<p class="hint down">${cut} unit${cut > 1 ? 's are' : ' is'} out of supply: weaker in battle and losing strength each day. Reconnect to your territory, or capture a port.</p>` : ''}
              ${candidate && mil.generals < mil.maxGenerals ? `<button type="button" class="claim" data-f="general" data-unit="${candidate.id}">Appoint a general · $1bn (${mil.generals}/${mil.maxGenerals})</button>` : ''}`;
          })()}
          <div class="actions-row">
            <button type="button" class="claim" data-f="halt">Stop after the current leg</button>
            ${sel.some((u) => u.mission) ? '<button type="button" class="claim" data-f="standdown">Stand down air missions</button>' : ''}
          </div>
        </section>` : `<p class="hint">Click one of your unit markers on the map to select it (shift-click adds more), then right-click (or long-press) a province to move.</p>`}
        <div class="econ-cols">
          <section>
            <span class="label">RECRUIT</span>
            ${UNIT_TYPES.filter((t) => UNIT_SPECS[t].domain === this.view).map((t, i) => { const s = UNIT_SPECS[t]; return `
              ${i === 0 ? `<span class="label sub">${DOMAIN_NAMES[s.domain]}</span>` : ''}
              <div class="recruit" data-tip="${attr(tip(s.name, UNIT_ROLE[t] ?? null, [`Attack ${s.attack}, defense ${s.defense}`, 'good'], s.range ? `Combat radius ${s.range} km` : `Moves ${s.speed} km a day`, [`Costs ${money(s.cost)} and ${(s.men / 1e3).toFixed(0)}k reservists`, 'bad'], [`Upkeep ${money(s.upkeep)} a year`, 'bad'], `Ready in ${s.days} game days`))}">
                <div><b class="recruit-name"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t]}</svg>${s.name}</b>${UNIT_ROLE[t] ? `<span>${UNIT_ROLE[t]}</span>` : ''}<span class="mono">attack ${s.attack} · defense ${s.defense} · ${s.range ? `radius ${s.range} km` : `${s.speed} km/day`}</span>
                <span class="mono">${money(s.cost)} · ${s.days} days (~${Math.round((s.days * 10) / 60)} min) · ${(s.men / 1e3).toFixed(0)}k men · upkeep ${money(s.upkeep)}/yr</span></div>
                <button type="button" class="claim primary" data-f="recruit" data-type="${t}" ${mil.manpower < s.men || mil.queue.length >= 10 || (UNIT_TECH[t] && !mine.research?.done.includes(UNIT_TECH[t] as never)) ? 'disabled' : ''}>${UNIT_TECH[t] && !mine.research?.done.includes(UNIT_TECH[t] as never) ? 'Needs research' : 'Recruit'}</button>
              </div>`; }).join('')}
            ${this.view === 'air' && mine.research?.done.includes('orbital_recon') ? `<span class="label sub">SPACE</span>
              <div class="recruit"><div><b>Satellites in orbit: ${mil.satellites}</b><span class="mono">$10bn a launch · while you have one, you see every unit of nations you are at war with (not submarines)</span></div>
              <button type="button" class="claim" data-f="satellite" ${mil.funds < 10 ? 'disabled' : ''}>Launch</button></div>` : ''}
            ${this.view === 'air' && mine.research?.done.includes('nuclear') ? `<span class="label sub">STRATEGIC</span>
              <div class="recruit"><div><b>Nuclear warheads: ${mil.warheads}</b><span class="mono">$40bn each · strike from an enemy province's panel</span></div>
              <button type="button" class="claim danger" data-f="warhead" ${mil.funds < 40 ? 'disabled' : ''}>Build</button></div>` : ''}
            <span class="label">PRODUCTION QUEUE</span>
            <p class="hint">${mil.rally !== undefined ? `New land units march to ${esc(this.pol.provinces.get(mil.rally)?.name ?? 'the rally point')}.` : 'Set a rally point from one of your provinces to send new land units to the front.'}</p>
            ${mil.queue.length ? `<div class="bars">${mil.queue.map((q, i) => `<span>${i + 1}. ${UNIT_SPECS[q.type].name}</span><div class="bar"><i style="width:${Math.round(q.progress * 100)}%"></i></div><span class="mono">${Math.round(q.progress * 100)}%</span>`).join('')}</div>`
              : '<p class="hint">Nothing in production. New divisions appear at your capital.</p>'}
          </section>
          <section>
            <span class="label">WARS</span>
            ${wars.length ? wars.map((w) => {
              const foe = w.a === mine.id ? w.b : w.a;
              const n = this.pol.nations.get(foe);
              const offered = mil.peaceOffers.includes(foe);
              const theirs = Object.entries(this.game.war.occupied).filter(([p, o]) => o === foe && this.pol.provinces.get(Number(p))?.nation === mine.id).length;
              const ours = Object.entries(this.game.war.occupied).filter(([p, o]) => o === mine.id && this.pol.provinces.get(Number(p))?.nation === foe).length;
              return `<div class="war-row"><div><b>${esc(n?.name ?? String(foe))}</b><span class="mono">${day - w.since} days · we hold ${ours} of theirs, they hold ${theirs} of ours</span></div>
                <button type="button" class="claim${offered ? ' primary' : ''}" data-f="peace" data-target="${foe}">${offered ? 'Accept peace' : 'Offer peace'}</button></div>`;
            }).join('') : '<p class="hint">At peace. Declare war from a nation\'s panel: click its territory, then "Declare war".</p>'}
            <span class="label">${view.where}</span>
            ${byProv.size ? '' : `<p class="hint">${view.empty}</p>`}
            <div class="table-wrap"><table class="league"><tbody>
              ${[...byProv].map(([p, us]) => `<tr><th scope="row"><button type="button" class="link" data-f="goto" data-province="${p}">${esc(this.pol.provinces.get(p)?.name ?? String(p))}</button></th>
                <td>${us.length} ${view.units}</td><td>${Math.round(us.reduce((s, u) => s + u.strength, 0) / us.length)}%</td>
                <td>${us.some((u) => u.status === 'fighting') ? '<span class="down">fighting</span>' : us.some((u) => u.status === 'moving') ? 'moving' : 'holding'}</td></tr>`).join('')}
            </tbody></table></div>
          </section>
        </div>
      </div>`;
    if (html !== this.lastPanel) { this.lastPanel = html; this.panel.innerHTML = html; }
  }
}
