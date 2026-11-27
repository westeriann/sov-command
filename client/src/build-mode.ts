// Build mode, started from the Eco lens: the lens steps aside, you click your
// provinces on the map, and a small menu by each click offers what can be built
// there. Back (or Esc) leaves build mode and returns to the Eco lens.
import { buildInfo, buildTipLines } from './build-info';
import type { Game } from './game';
import type { Political, Province } from './political';
import { BUILDINGS, BUILDING_TYPES, type BuildingType } from '../../shared/buildings';
import { attr, effectLines, tip } from './tooltip';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class BuildMode {
  active = false;
  private bar: HTMLElement;
  private menu: HTMLElement;
  private province: Province | null = null;

  constructor(root: HTMLElement, private game: Game, private pol: Political,
    private act: { build: (province: number, b: BuildingType) => void; back: () => void; roads: () => void }) {
    this.bar = document.createElement('div');
    this.bar.className = 'panel mode-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = `<span class="tag mono">BUILD</span><span class="mode-hint">Click one of your provinces to build there</span>
      <button type="button" class="claim" data-bm="roads">Roads…</button><button type="button" class="claim primary" data-bm="back">Back to Eco</button>`;
    this.menu = document.createElement('section');
    this.menu.className = 'panel build-menu';
    this.menu.hidden = true;
    root.append(this.bar, this.menu);
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bm]')?.dataset.bm;
      if (b === 'back') this.stop(true);
      else if (b === 'roads') { this.stop(false); this.act.roads(); }
    });
    this.menu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bm-build]');
      if (b && this.province && !(b as HTMLButtonElement).disabled) {
        this.act.build(this.province.id, b.dataset.bmBuild as BuildingType);
        this.menu.hidden = true;
      } else if ((e.target as HTMLElement).closest('[data-bm-close]')) this.menu.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.key !== 'Escape') return;
      e.stopPropagation();
      if (!this.menu.hidden) this.menu.hidden = true; else this.stop(true);
    }, true);
    game.on((c) => { if (this.active && this.province && !this.menu.hidden && (c.has('war') || c.has('economy') || c.has('mine'))) this.renderMenu(); });
  }

  start() {
    this.active = true;
    this.bar.hidden = false;
    document.body.classList.add('build-mode');
  }

  stop(backToLens: boolean) {
    if (!this.active) return;
    this.active = false;
    this.bar.hidden = true;
    this.menu.hidden = true;
    this.province = null;
    document.body.classList.remove('build-mode');
    if (backToLens) this.act.back();
  }

  /** A map click while building: open the menu for that province. True if handled. */
  click(p: Province | null, x: number, y: number) {
    if (!this.active) return false;
    const me = this.game.mine?.id;
    if (!p || p.kind !== 'land' || p.nation !== me || (this.game.war.occupied[p.id] ?? p.nation) !== me) {
      this.province = null;
      this.menu.innerHTML = `<p class="hint">${p?.kind === 'land' ? `${esc(p.name)} is not yours to build in.` : 'Pick one of your own provinces.'}</p>`;
    } else {
      this.province = p;
      this.renderMenu();
    }
    this.menu.hidden = false;
    const w = this.menu.offsetWidth, h = this.menu.offsetHeight, m = 10;
    this.menu.style.left = `${Math.max(m, Math.min(innerWidth - w - m, x + 16))}px`;
    this.menu.style.top = `${Math.max(64, Math.min(innerHeight - h - 70, y - h / 2))}px`;
    return true;
  }

  private renderMenu() {
    const p = this.province;
    if (!p) return;
    const g = this.game, list = g.war.buildings[p.id] ?? [];
    const coastal = p.adj.some((q) => this.pol.provinces.get(q)?.kind === 'sea');
    const treasury = g.mine?.econ?.treasury ?? 0;
    // producers only where there is something to produce
    const options = BUILDING_TYPES.filter((t) => (!BUILDINGS[t].coastal || coastal) && (!BUILDINGS[t].needs || ((p.res as Record<string, number> | undefined)?.[BUILDINGS[t].needs!] ?? 0) > 0));
    this.menu.innerHTML = `<header class="row-between"><span class="label">BUILD IN ${esc(p.name.toUpperCase())}</span><button type="button" class="link" data-bm-close aria-label="Close">×</button></header>
      <div class="bm-list">${options.map((t) => {
        const have = list.find((b) => b.type === t);
        const b = BUILDINGS[t];
        const info = buildInfo(t, p, g);
        const why = have ? (have.progress >= 1 ? 'Built' : `Building ${Math.round(have.progress * 100)}%`) : info.blocked ? info.blocked : treasury < b.cost + info.buy ? 'Not enough in the treasury' : '';
        return `<button type="button" class="bm-item" data-bm-build="${t}" ${why ? 'disabled' : ''} data-tip="${attr(tip(b.name, ...effectLines(b.text), ...buildTipLines(t, p, g)))}">
          <b>${esc(b.name)}</b><span class="mono">${why || `$${b.cost}bn · ${b.days} days${info.output ? ` · ${info.output.replace(' a year', '/yr')}` : ''}`}</span></button>`;
      }).join('')}</div>`.replace(/\n\s+/g, ' ');
  }
}
