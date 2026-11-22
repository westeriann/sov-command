// The command card: when you select your own units, a panel above the forces
// bar shows what you have selected and every order you can give it, each with
// its own key. Q arms an order: the next left-click on the map is where it goes.
import type { Map as MLMap } from 'maplibre-gl';
import { domainOf, UNIT_SPECS, UNIT_TYPES, type UnitType, type UnitView } from '../../shared/military';
import { ICON, type Forces } from './forces';
import type { Game } from './game';
import type { Political } from './political';
import { attr, tip } from './tooltip';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface CardActions {
  halt(units: number[]): void;
  standDown(units: number[]): void;
  general(unit: number): void;
  toast(text: string): void;
}

interface Order { key: string; code: string; label: string; tip: string; run: () => void; show: boolean; on?: boolean }

export class UnitCard {
  private el: HTMLElement;
  /** True while an order waits for a click on the map (Q). */
  arming = false;
  private cycle = 0;

  constructor(root: HTMLElement, private map: MLMap, private game: Game, private pol: Political, private forces: Forces, private actions: CardActions) {
    this.el = document.createElement('section');
    this.el.className = 'panel unit-card';
    this.el.setAttribute('aria-label', 'Orders for the selected units');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-order]');
      if (b) this.orders().find((o) => o.code === b.dataset.order)?.run();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    game.on((c) => { if (c.has('units') || c.has('mine')) this.render(); });
  }

  private selection(): UnitView[] {
    return this.game.units.filter((u) => this.forces.selected.has(u.id) && u.nation === this.game.mine?.id);
  }

  private orders(): Order[] {
    const sel = this.selection();
    const ids = sel.map((u) => u.id);
    const air = sel.filter((u) => domainOf(u.type) === 'air');
    const movers = sel.filter((u) => domainOf(u.type) !== 'air');
    const mil = this.game.mine?.mil;
    const candidate = sel.find((u) => domainOf(u.type) === 'land' && !u.general);
    return [
      {
        key: 'Q', code: 'order', on: this.arming, show: true,
        label: movers.length && air.length ? 'Order' : air.length ? 'Fly mission' : 'Move / attack',
        tip: tip('Give an order (Q)', 'Then left-click a province on the map', movers.length ? 'Troops march or sail there; at war, they attack it' : null, air.length ? 'Fighters patrol over it; strike wings support a battle or bomb industry there' : null, 'Right-click on the map does the same at once'),
        run: () => this.arm(!this.arming),
      },
      {
        key: 'H', code: 'halt', show: sel.some((u) => u.next !== undefined), label: 'Halt',
        tip: tip('Halt (H)', 'Stop after reaching the next province'),
        run: () => { this.actions.halt(ids); this.actions.toast(`${ids.length} unit${ids.length > 1 ? 's' : ''} will halt after this leg`); },
      },
      {
        key: 'T', code: 'track', show: true, label: 'Go to',
        tip: tip('Go to (T)', 'Move the camera to the selected units'),
        run: () => this.track(sel),
      },
      {
        key: 'L', code: 'general', show: !!candidate && !!mil && mil.generals < mil.maxGenerals, label: 'Appoint general',
        tip: tip('Appoint a general (L)', ['Units led by a general fight harder and gain skill in battle', 'good'], ['Costs $1bn', 'bad'], mil ? `${mil.generals} of ${mil.maxGenerals} generals in service` : null),
        run: () => { if (candidate) this.actions.general(candidate.id); },
      },
      {
        key: 'U', code: 'standdown', show: air.some((u) => u.mission), label: 'Stand down',
        tip: tip('Stand down (U)', 'Air wings end their missions and stay at base'),
        run: () => this.actions.standDown(air.map((u) => u.id)),
      },
      {
        key: 'Tab', code: 'next', show: true, label: 'Next stack',
        tip: tip('Next stack (Tab)', 'Select your next army, fleet or air wing; Shift+Tab goes back'),
        run: () => this.next(1),
      },
    ];
  }

  private arm(on: boolean) {
    this.arming = on && this.selection().length > 0;
    this.map.getCanvas().style.cursor = this.arming ? 'crosshair' : '';
    document.body.classList.toggle('arming', this.arming);
    this.render();
  }

  /** A left-click on the map while an order is armed: send it there. Returns true if used. */
  mapClick(province: { id: number; name: string } | null) {
    if (!this.arming) return false;
    this.arm(false);
    if (!province) return true;
    const n = this.selection().length;
    const r = this.forces.preview(province.id);
    this.forces.orderAt(province.id);
    this.actions.toast(r ? `${n} unit${n > 1 ? 's' : ''} ordered to ${province.name} · about ${Math.max(1, Math.round(r.days))} days` : `Orders sent: ${province.name}`);
    return true;
  }

  private track(sel: UnitView[]) {
    const pts = sel.map((u) => this.pol.provinces.get(u.next ?? u.province)?.label).filter((p): p is [number, number] => !!p);
    if (!pts.length) return;
    const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length, lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), 4.2), duration: 900 });
  }

  /** Select the next (or previous) of our stacks, and look at it. */
  private next(step: number) {
    const mine = this.game.mine?.id;
    const stacks = this.forces.stacks().filter((s) => s.units[0].nation === mine).sort((a, b) => a.key.localeCompare(b.key));
    if (!stacks.length) return;
    this.cycle = (this.cycle + step + stacks.length) % stacks.length;
    const s = stacks[this.cycle];
    this.forces.selectUnits(s.units.map((u) => u.id));
    this.track(s.units);
  }

  private onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t?.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea')) return;
    if (e.key === 'Tab' && this.game.mine) { e.preventDefault(); this.next(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape' && this.arming) { e.stopImmediatePropagation(); this.arm(false); return; }
    if (this.el.hidden) return;
    const o = this.orders().find((x) => x.show && x.key.toLowerCase() === e.key.toLowerCase() && x.key !== 'Tab');
    if (o) { e.preventDefault(); e.stopImmediatePropagation(); o.run(); }
  }

  private html = '';
  render() {
    const sel = this.selection();
    if (!sel.length) {
      if (this.arming) this.arm(false);
      this.el.hidden = true;
      this.html = '';
      return;
    }
    this.el.hidden = false;
    const counts = UNIT_TYPES.map((t) => [t, sel.filter((u) => u.type === t).length] as [UnitType, number]).filter(([, c]) => c);
    const strength = Math.round(sel.reduce((s, u) => s + u.strength, 0) / sel.length);
    const moving = sel.filter((u) => u.next !== undefined);
    const fighting = sel.some((u) => u.status === 'fighting');
    const cut = sel.filter((u) => u.supplied === false).length;
    const places = [...new Set(sel.map((u) => u.province))].map((p) => this.pol.provinces.get(p)?.name ?? '?');
    const dest = moving.length ? this.pol.provinces.get(moving[0].path?.at(-1) ?? moving[0].next!)?.name : undefined;
    const general = sel.find((u) => u.general)?.general;
    const status = fighting ? '<span class="bad">In battle</span>' : moving.length ? `Moving${dest ? ` to ${esc(dest)}` : ''}` : `Holding ${esc(places.slice(0, 2).join(', '))}${places.length > 2 ? ` +${places.length - 2}` : ''}`;
    const html = `
      <div class="uc-head">
        <div class="uc-types">${counts.map(([t, c]) => `<span data-tip="${attr(tip(UNIT_SPECS[t].name, `Attack ${UNIT_SPECS[t].attack}, defense ${UNIT_SPECS[t].defense}`))}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t]}</svg>${c}</span>`).join('')}</div>
        <div class="uc-info"><b>${sel.length} unit${sel.length > 1 ? 's' : ''} selected</b><span>${status}${general ? ` · ★ ${esc(general.name)}` : ''}${cut ? ` · <span class="bad">${cut} out of supply</span>` : ''}</span></div>
        <div class="uc-str" data-tip="${attr(tip('Strength', [`${strength}% on average`, strength >= 60 ? 'good' : 'bad'], 'Units recover at home, in supply'))}"><div class="bar"><i style="width:${strength}%"></i></div><span class="mono">${strength}%</span></div>
      </div>
      <div class="uc-orders">${this.orders().filter((o) => o.show).map((o) => `<button type="button" class="claim${o.on ? ' primary' : ''}" data-order="${o.code}" data-tip="${attr(o.tip)}"><kbd>${o.key}</kbd>${o.label}</button>`).join('')}</div>
      ${this.arming ? '<p class="uc-hint">Click a province on the map · Esc to cancel</p>' : ''}`;
    if (html !== this.html) { this.html = html; this.el.innerHTML = html; }
  }
}
