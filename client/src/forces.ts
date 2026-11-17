// Land forces on the client: unit markers that glide between provinces in game
// time, selection and move orders, route lines, battles, and the Forces window.
import { Marker, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { money } from '../../shared/economy';
import {
  distanceKm, domainOf, findRoute, UNIT_SPECS, UNIT_TYPES, type Domain, type Mission, type RouteNode, type UnitType, type UnitView,
} from '../../shared/military';
import type { Game } from './game';
import type { Political } from './political';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const SYMBOL: Record<UnitType, string> = {
  infantry: '<path d="M1 1L23 15M23 1L1 15"/>',
  armored: '<ellipse cx="12" cy="8" rx="7" ry="4"/>',
  mechanized: '<path d="M1 1L23 15M23 1L1 15"/><ellipse cx="12" cy="8" rx="7" ry="4"/>',
  destroyers: '<path d="M2 9h20l-3 5H5zM9 9V5h6v4"/>',
  submarines: '<ellipse cx="12" cy="11" rx="10" ry="3"/><path d="M10 8V5h4v3"/>',
  carrier: '<path d="M1 9h22l-3 5H4z"/><path d="M3 8h18" stroke-width="2.4"/><path d="M16 8V4h3v4"/>',
  fighters: '<path d="M12 1l10 13H2z"/>',
  strike: '<path d="M12 1l10 13H2z"/><path d="M7 10h10" stroke-width="2.4"/>',
};
const DOMAIN_NAMES: Record<Domain, string> = { land: 'LAND', sea: 'SEA', air: 'AIR' };

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
  goToProvince(id: number): void;
}

type Pos = [number, number];

export class Forces {
  selected = new Set<number>();
  private markers = new Map<string, { marker: Marker; el: HTMLElement; units: UnitView[] }>();
  private battleMarkers = new Map<number, Marker>();
  private nodes: Map<number, RouteNode>;
  private panel: HTMLElement;
  private onSelect: () => void = () => {};

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
    this.panel.setAttribute('aria-label', 'Ground forces');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
  }

  set onSelectionChange(fn: () => void) { this.onSelect = fn; }
  get isOpen() { return !this.panel.hidden; }
  toggle() { this.panel.hidden = !this.panel.hidden; if (!this.panel.hidden) this.renderPanel(); }
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
    let dl = b[0] - a[0];
    if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
    return [a[0] + dl * t, a[1] + (b[1] - a[1]) * t];
  }

  private render() {
    const mine = this.game.mine?.id;
    const groups = new Map<string, UnitView[]>();
    for (const u of this.game.units) {
      const key = u.next === undefined ? `p${u.province}:${u.nation}:${domainOf(u.type)}` : `u${u.id}`;
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
        el.addEventListener('click', (e) => { e.stopPropagation(); this.clickMarker(key, (e as MouseEvent).shiftKey); });
        m = { marker: new Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(this.position(units[0])).addTo(this.map), el, units };
        this.markers.set(key, m);
      }
      m.units = units;
      const u0 = units[0];
      const nation = this.pol.nations.get(u0.nation);
      const side = u0.nation === mine ? 'own' : this.game.atWar(mine, u0.nation) ? 'enemy' : 'other';
      const types = UNIT_TYPES.filter((t) => units.some((u) => u.type === t));
      const strength = Math.round(units.reduce((s, u) => s + u.strength, 0) / units.length);
      const sel = units.some((u) => this.selected.has(u.id));
      m.el.className = `unit-marker ${side} d-${domainOf(u0.type)}${sel ? ' selected' : ''}${units.some((u) => u.status === 'fighting') ? ' fighting' : ''}`;
      m.el.style.setProperty('--nation', nation?.color ?? '#888');
      m.el.setAttribute('aria-label', `${units.length} ${nation?.short ?? ''} ${UNIT_SPECS[u0.type].name.toLowerCase()}${units.length > 1 ? ' group' : ''}, ${strength}% strength`);
      const symbol = types.length === 1 ? types[0] : types.find((t) => t === 'carrier' || t === 'armored') ?? types[0];
      m.el.innerHTML = `<svg viewBox="0 0 24 16" aria-hidden="true">${SYMBOL[symbol]}</svg>${units.length > 1 ? `<b>${units.length}</b>` : ''}<i style="width:${strength}%"></i>`;
    }
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

  private animate() {
    for (const m of this.markers.values()) if (m.units[0].next !== undefined) m.marker.setLngLat(this.position(m.units[0]));
  }

  private renderRoutes() {
    const mine = this.game.mine?.id;
    const own = this.game.units.filter((u) => u.nation === mine);
    const line = (k: string, sel: boolean, coordinates: [number, number][]) =>
      ({ type: 'Feature' as const, properties: { k, sel }, geometry: { type: 'LineString' as const, coordinates } });
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

  private clickMarker(key: string, add: boolean) {
    const m = this.markers.get(key);
    if (!m) return;
    const mine = this.game.mine?.id;
    const own = m.units.filter((u) => u.nation === mine);
    if (!own.length) { this.actions.goToProvince(m.units[0].province); return; }
    if (!add) this.selected.clear();
    for (const u of own) this.selected.add(u.id);
    this.render();
    this.onSelect();
    if (!this.panel.hidden) this.renderPanel();
  }

  clearSelection() {
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
      const r = findRoute(this.nodes, u.next ?? u.province, to, u.type, canEnter(domain));
      if (!r) return null;
      days = Math.max(days, r.days);
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
    const strikes = sel.filter((u) => u.type === 'strike').map((u) => u.id);
    if (fighters.length) this.actions.mission(fighters, { kind: 'patrol', target: to });
    if (strikes.length) this.actions.mission(strikes, { kind: 'support', target: to });
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
    const name = mine ? this.pol.nations.get(mine.id)?.name ?? '' : 'Ground forces';
    if (!mine || !mil) {
      this.panel.innerHTML = `<div class="econ-head"><div><span class="label">GROUND FORCES</span><h2>${esc(name)}</h2></div><button type="button" class="link" data-f="close">Close</button></div>
        <div class="econ-body"><p class="hint">Take command of a nation to raise and move armies.</p></div>`;
      return;
    }
    const units = this.game.units.filter((u) => u.nation === mine.id);
    const byProv = new Map<number, UnitView[]>();
    for (const u of units) { const k = u.next ?? u.province; byProv.set(k, [...(byProv.get(k) ?? []), u]); }
    const wars = this.game.war.wars.filter((w) => w.a === mine.id || w.b === mine.id);
    const day = this.game.market?.day ?? 0;
    const sel = units.filter((u) => this.selected.has(u.id));
    this.panel.innerHTML = `
      <div class="econ-head"><div><span class="label">GROUND FORCES</span><h2>${esc(name)}</h2></div><button type="button" class="link" data-f="close">Close</button></div>
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Forces</span><b>${units.length}</b><em>${(['land', 'sea', 'air'] as Domain[]).map((d) => `${units.filter((u) => domainOf(u.type) === d).length} ${d}`).join(' · ')}</em></div>
          <div><span>Military funds</span><b class="${mil.funds < 0 ? 'down' : ''}">${money(mil.funds)}</b><em>+${money(mil.income)}/yr · upkeep ${money(mil.upkeep)}/yr</em></div>
          <div><span>Reservists free</span><b>${(mil.manpower / 1e3).toFixed(0)}k</b><em>men available to recruit</em></div>
          <div><span>Wars</span><b class="${wars.length ? 'down' : ''}">${wars.length}</b><em>${this.game.mine?.econ ? `munitions ${this.game.mine.econ.munitions}%` : ''}</em></div>
        </div>
        ${sel.length ? `<section class="selection">
          <span class="label">SELECTED · ${sel.map((u) => UNIT_SPECS[u.type].name).filter((v, i, a) => a.indexOf(v) === i).join(', ')} (${sel.length})</span>
          <p class="hint">Right-click on the map: troops and ships move there (troops cross the sea by transport); fighters patrol over it and strike wings support battles there, within their combat radius (the ring). To rebase aircraft, use "Move selected here" on one of your provinces. One game day is about ten seconds.</p>
          <div class="actions-row">
            <button type="button" class="claim" data-f="halt">Stop after the current leg</button>
            ${sel.some((u) => u.mission) ? '<button type="button" class="claim" data-f="standdown">Stand down air missions</button>' : ''}
          </div>
        </section>` : `<p class="hint">Click one of your unit markers on the map to select it (shift-click adds more), then right-click a province to move.</p>`}
        <div class="econ-cols">
          <section>
            <span class="label">RECRUIT</span>
            ${UNIT_TYPES.map((t, i) => { const s = UNIT_SPECS[t]; return `
              ${i === 0 || UNIT_SPECS[UNIT_TYPES[i - 1]].domain !== s.domain ? `<span class="label sub">${DOMAIN_NAMES[s.domain]}</span>` : ''}
              <div class="recruit">
                <div><b>${s.name}</b><span class="mono">attack ${s.attack} · defense ${s.defense} · ${s.range ? `radius ${s.range} km` : `${s.speed} km/day`}</span>
                <span class="mono">${money(s.cost)} · ${s.days} days (~${Math.round((s.days * 10) / 60)} min) · ${(s.men / 1e3).toFixed(0)}k men · upkeep ${money(s.upkeep)}/yr</span></div>
                <button type="button" class="claim primary" data-f="recruit" data-type="${t}" ${mil.manpower < s.men || mil.queue.length >= 10 ? 'disabled' : ''}>Recruit</button>
              </div>`; }).join('')}
            <span class="label">PRODUCTION QUEUE</span>
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
            <span class="label">ARMIES BY LOCATION</span>
            <div class="table-wrap"><table class="league"><tbody>
              ${[...byProv].map(([p, us]) => `<tr><th scope="row"><button type="button" class="link" data-f="goto" data-province="${p}">${esc(this.pol.provinces.get(p)?.name ?? String(p))}</button></th>
                <td>${us.length} div</td><td>${Math.round(us.reduce((s, u) => s + u.strength, 0) / us.length)}%</td>
                <td>${us.some((u) => u.status === 'fighting') ? '<span class="down">fighting</span>' : us.some((u) => u.status === 'moving') ? 'moving' : 'holding'}</td></tr>`).join('')}
            </tbody></table></div>
          </section>
        </div>
      </div>`;
  }
}
