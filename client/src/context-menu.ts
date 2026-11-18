// Right-click (or long-press) on the map with nothing selected: a menu of what
// you can do with that place, so you don't have to hunt through the panels.
import type { Game } from './game';
import type { Political, Province } from './political';

export interface MenuActions {
  inspect(p: Province): void;
  openModule(id: 'economy' | 'army' | 'diplomacy' | 'research' | 'rankings'): void;
  build(p: Province): void; // inspect, then scroll to the building list
  rally(p: Province): void;
  selectUnits(p: Province): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class ContextMenu {
  private el: HTMLElement;
  private province: Province | null = null;

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: MenuActions) {
    this.el = document.createElement('div');
    this.el.className = 'panel context-menu';
    this.el.setAttribute('role', 'menu');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-cm]')?.dataset.cm;
      const p = this.province;
      if (!a || !p) return;
      this.close();
      if (a === 'inspect') this.actions.inspect(p);
      else if (a === 'build') this.actions.build(p);
      else if (a === 'rally') this.actions.rally(p);
      else if (a === 'units') this.actions.selectUnits(p);
      else this.actions.openModule(a as never);
    });
    document.addEventListener('pointerdown', (e) => { if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  close() { this.el.hidden = true; }

  open(p: Province, x: number, y: number) {
    this.province = p;
    const g = this.game, me = g.mine?.id;
    const ctrl = g.war.occupied[p.id] ?? p.nation;
    const nation = p.nation ? this.pol.nations.get(p.nation) : undefined;
    const mineHere = !!me && p.kind === 'land' && p.nation === me && ctrl === me;
    const myUnits = !!me && g.units.some((u) => u.nation === me && u.province === p.id);
    const item = (cm: string, label: string) => `<button type="button" role="menuitem" data-cm="${cm}">${label}</button>`;
    const items = [
      item('inspect', p.kind === 'sea' ? 'Inspect sea zone' : 'Inspect province'),
      myUnits ? item('units', 'Select my units here') : '',
      mineHere ? item('build', 'Build here…') : '',
      mineHere ? item('rally', g.mine?.mil?.rally === p.id ? 'Clear rally point' : 'Set rally point here') : '',
      me ? '<hr>' : '',
      me ? item('army', 'Forces and recruiting') : '',
      me ? item('economy', 'Economy and construction') : '',
      me && nation && nation.id !== me ? item('diplomacy', `Diplomacy (${esc(nation.short)})`) : me ? item('diplomacy', 'Diplomacy') : '',
      me ? item('research', 'Research and government') : '',
      item('rankings', 'Rankings'),
    ].filter(Boolean).join('');
    this.el.innerHTML = `<div class="cm-head"><b>${esc(p.name)}</b><span>${nation ? esc(nation.name) : p.kind === 'sea' ? 'Open sea' : 'Unclaimed'}</span></div>${items}`;
    this.el.hidden = false;
    // keep it on screen
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    this.el.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    (this.el.querySelector('button') as HTMLElement | null)?.focus();
  }
}
