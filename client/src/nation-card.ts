// A small card about a nation, opened by clicking its name in any window: the
// figures you usually want (country, economy, military, diplomacy) with a
// button to zoom the map to it and one to open its diplomacy page.
import type { Game } from './game';
import type { Political } from './political';
import { DIPLO_CATS, diploColours, type DiploCat } from './diplo-map';
import { money } from '../../shared/economy';
import { domainOf } from '../../shared/military';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ALL = new Set<DiploCat>(DIPLO_CATS.map(([k]) => k));
const CAT = Object.fromEntries(DIPLO_CATS.map(([k, n, c]) => [k, [n, c]])) as Record<DiploCat, [string, string]>;
const people = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : `${Math.round(n / 1e3)}k`);

export class NationCard {
  private el: HTMLElement;
  private id: number | null = null;

  constructor(root: HTMLElement, private game: Game, private pol: Political,
    private act: { zoom: (id: number) => void; diplomacy: (id: number) => void }) {
    this.el = document.createElement('section');
    this.el.className = 'panel nation-card';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-nc]');
      if (!b || this.id === null) return;
      const id = this.id;
      if (b.dataset.nc === 'zoom') { this.close(); this.act.zoom(id); }
      else if (b.dataset.nc === 'diplo') { this.close(); this.act.diplomacy(id); }
      else this.close();
    });
    document.addEventListener('pointerdown', (e) => { if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close(); }, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.hidden) { e.stopPropagation(); this.close(); } }, true);
  }

  get isOpen() { return !this.el.hidden; }

  close() { this.el.hidden = true; this.id = null; }

  /** Open the card for a nation, next to a point on screen (the click). */
  show(id: number, x: number, y: number) {
    const n = this.pol.nations.get(id);
    if (!n) return;
    this.id = id;
    this.el.innerHTML = this.html(id);
    this.el.hidden = false;
    const w = this.el.offsetWidth, h = this.el.offsetHeight, m = 10;
    const left = Math.max(m, Math.min(innerWidth - w - m, x + 14));
    const top = Math.max(m, Math.min(innerHeight - h - m, y - 20));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.querySelector<HTMLElement>('[data-nc="zoom"]')?.focus({ preventScroll: true });
  }

  private html(id: number) {
    const g = this.game, pol = this.pol, n = pol.nations.get(id)!, pub = g.nations.get(id), e = g.economy.get(id);
    const me = g.mine?.id;
    const cap = pol.provinces.get(n.capital)?.name ?? '—';
    const govName = pub?.government ? pub.government[0].toUpperCase() + pub.government.slice(1) : '—';
    const who = pub?.controller === 'human' ? `Player: ${esc(pub.player ?? 'unknown')}${pub.online ? ' (online)' : ''}` : `AI${pub?.personality ? ` · ${esc(pub.personality)}` : ''}`;
    const units = g.units.filter((u) => u.nation === id);
    const dom = (d: string) => units.filter((u) => domainOf(u.type) === d).length;
    const cats = new Map<number, DiploCat>();
    if (me !== undefined) diploColours(g, pol, ALL, cats);
    const cat = cats.get(id);
    const opinion = me !== undefined && id !== me ? g.mine?.relations?.[id]?.total : undefined;
    const ties = g.war.treaties.filter((t) => t.a === id || t.b === id);
    const wars = g.war.wars.filter((w) => w.a === id || w.b === id).length;
    const allies = ties.filter((t) => t.kind === 'alliance').length;
    const row = (k: string, v: string, cls = '') => `<span>${k}</span><b class="${cls}">${v}</b>`;
    const sec = (t: string, body: string) => `<div class="nc-sec"><span class="label">${t}</span><div class="nc-kv">${body}</div></div>`;
    return `<header class="nc-head"><i class="nc-flag" style="background:${esc(n.color)}"></i><div><b>${esc(n.name)}</b><span class="muted">${who}</span></div>
        <button type="button" class="link nc-x" data-nc="close" aria-label="Close">×</button></header>
      ${sec('COUNTRY', row('Government', esc(govName)) + row('Capital', esc(cap)) + row('Provinces', String(n.provinces)) + row('Population', people(e?.pop ?? n.pop))
        + row('Approval', e ? `${Math.round(e.stability)}%` : '—', e && e.stability < 35 ? 'down' : ''))}
      ${sec('ECONOMY', row('GDP', e ? money(e.gdp) : '—') + row('Growth', e ? `${(e.growth * 100).toFixed(1)}%` : '—', e ? (e.growth >= 0 ? 'up' : 'down') : '')
        + row('Per person', e ? `$${Math.round(e.gdppc).toLocaleString('en-US')}` : '—') + (e && e.blackout > 0.02 ? row('Blackouts', `${Math.round(e.blackout * 100)}%`, 'down') : ''))}
      ${sec('MILITARY', row('Army (estimate)', pub?.army !== undefined ? `~${pub.army} div.` : `${dom('land')} seen`) + row('Navy · air seen', `${dom('sea')} · ${dom('air')}`)
        + row('Technologies', String(pub?.techs ?? '—')) + (pub?.nuclear ? row('Nuclear', 'armed', 'down') : '') + (pub?.satellites ? row('Satellites', String(pub.satellites)) : ''))}
      ${sec('DIPLOMACY', (id === me ? row('Relation', 'your nation') : row('With you', cat && cat !== 'opinion' ? `<i class="nc-dot" style="background:${CAT[cat][1]}"></i>${esc(CAT[cat][0])}` : 'no ties')
        + (opinion !== undefined ? row('Opinion of you', `${opinion > 0 ? '+' : ''}${opinion}`, opinion >= 0 ? 'up' : 'down') : ''))
        + row('Wars', String(wars), wars ? 'down' : '') + row('Allies · treaties', `${allies} · ${ties.length}`))}
      <div class="nc-actions"><button type="button" class="claim primary" data-nc="zoom">Zoom to</button>${id !== me ? '<button type="button" class="claim" data-nc="diplo">Diplomacy</button>' : ''}</div>`
      .replace(/\n\s+/g, ' ');
  }
}
