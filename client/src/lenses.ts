// Lenses: compact quick views that open from the bottom bar. Military shows
// wars, forces, production and supply at a glance; Eco shows the books,
// shortages, power and construction. Both give advice: what is needed now
// and what to build next, with links straight to where to act.
import { COMMODITIES, COMMODITY_INFO, money } from '../../shared/economy';
import { UNIT_SPECS, domainOf, type UnitType } from '../../shared/military';
import { LIMITS, type Order } from '../../shared/protocol';
import { TECHS } from '../../shared/research';
import type { Change, Game } from './game';
import type { Political } from './political';
import { attr, tip } from './tooltip';
import { ProvinceList } from './province-list';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
type Lens = 'military' | 'eco';
type Advice = [level: 'bad' | 'warn' | 'good', text: string, go?: string, how?: string];

export class Lenses {
  private el: HTMLElement;
  private open: Lens | null = null;
  private html = '';
  private ecoTab: 'overview' | 'provinces' = 'overview';
  private plist: ProvinceList;

  constructor(root: HTMLElement, private game: Game, private pol: Political, private order: (o: Order) => void,
    private tools: { build?: () => void; roads?: () => void; go?: (province: number) => void; buildAt?: (province: number) => void } = {}) {
    this.el = document.createElement('section');
    this.el.className = 'panel lens';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.plist = new ProvinceList(game, pol, { go: (id) => this.tools.go?.(id), build: (id) => this.tools.buildAt?.(id) }, true);
    this.plist.wire(this.el);
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lens]');
      if (b) { this.toggle(b.dataset.lens as Lens); return; }
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-ln]');
      if (!a || !this.el.contains(a)) return;
      const k = a.dataset.ln;
      const e2 = this.game.mine?.econ;
      if (k === 'close') this.toggle(this.open!);
      else if (k === 'ecotab') { this.ecoTab = a.dataset.tab as 'overview' | 'provinces'; this.render(); }
      else if (k === 'buildmode' || k === 'roads') { this.toggle(this.open!); (k === 'roads' ? this.tools.roads : this.tools.build)?.(); }
      else if (k === 'recruit') this.order({ kind: 'recruit', unit: a.dataset.unit as UnitType });
      else if (k === 'tax' && e2) this.order({ kind: 'policy', policy: { tax: Math.max(LIMITS.taxMin, Math.min(LIMITS.taxMax, (this.game.mine!.tax ?? 25) + Number(a.dataset.d))) } });
    });
    game.on((c: Set<Change>) => { if (this.open === 'eco' && this.ecoTab === 'provinces' && this.game.mine && (this.plist.busy(this.el) || this.plist.refresh(this.el))) return; if (this.open && (c.has('mine') || c.has('units') || c.has('war') || c.has('economy'))) queueMicrotask(() => this.render()); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) { this.toggle(this.open); } });
  }

  /** Open a lens (no-op if it is already open). */
  show(l: Lens) { if (this.open !== l) this.toggle(l); }

  toggle(l: Lens) {
    this.open = this.open === l ? null : l;
    this.el.hidden = !this.open;
    document.body.classList.toggle('lens-open', !!this.open);
    document.querySelectorAll<HTMLElement>('[data-lens]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lens === this.open)));
    this.html = '';
    if (this.open) this.render();
  }

  private render() {
    const mine = this.game.mine;
    const ecoTabs = this.open === 'eco' && mine ? `<div class="mk-tabs" role="tablist"><button type="button" role="tab" data-ln="ecotab" data-tab="overview" aria-selected="${this.ecoTab === 'overview'}">Overview</button><button type="button" role="tab" data-ln="ecotab" data-tab="provinces" aria-selected="${this.ecoTab === 'provinces'}">Provinces</button></div>` : '';
    const body = !mine ? '<p class="hint">Take command of a nation first.</p>' : this.open === 'military' ? this.military() : ecoTabs + (this.ecoTab === 'provinces' ? this.plist.html() : this.eco());
    // the forces count moves from above the lens buttons to the top of the open lens
    const forces = document.getElementById('forcesSummary')?.textContent ?? '';
    const html = `<div class="row-between"><span class="label">LENS · ${this.open === 'military' ? 'MILITARY' : 'ECONOMY'}</span><button type="button" class="link" data-ln="close">Close</button></div>${mine && forces ? `<p class="lens-forces mono"><span class="tag">FORCES</span> ${esc(forces)}</p>` : ''}${body}`;
    if (html !== this.html) { this.html = html; this.el.innerHTML = html; }
  }

  private adviceHtml(list: Advice[]) {
    if (!list.length) return '<p class="hint up">Nothing urgent. Well run, commander.</p>';
    return `<ul class="advice">${list.map(([lvl, text, go, how]) => `<li class="${lvl}"${how ? ` data-tip="${attr(tip(text, how))}"` : ''}>${go ? `<a href="#" class="go" data-go="${go}">${esc(text)}</a>` : esc(text)}</li>`).join('')}</ul>`;
  }

  // ---- military ----------------------------------------------------------------------
  private military() {
    const g = this.game, mine = g.mine!, me = mine.id, mil = mine.mil, e = mine.econ!;
    const units = g.units.filter((u) => u.nation === me);
    const by = (d: 'land' | 'sea' | 'air') => units.filter((u) => domainOf(u.type) === d);
    const fighting = units.filter((u) => u.status === 'fighting').length, cut = units.filter((u) => u.supplied === false).length;
    const wars = g.war.wars.filter((w) => w.a === me || w.b === me);
    const warRows = wars.map((w) => {
      const foe = w.a === me ? w.b : w.a, s = mine.warScores?.[foe] ?? 0, truce = g.truce(me, foe);
      return `<div class="lens-row"><b>${esc(this.pol.nations.get(foe)?.name ?? '?')}</b><span class="mono ${s >= 0 ? 'up' : 'down'}">score ${s > 0 ? '+' : ''}${s}</span>${truce ? `<span class="pill ok">truce</span>` : ''}<a href="#" class="go" data-go="peacecon:${foe}">peace…</a></div>`;
    }).join('') || '<p class="hint">At peace.</p>';
    const q = mil?.queue ?? [];
    const quick = (['infantry', 'armored', 'fighter', 'destroyer'] as UnitType[]).filter((t) => UNIT_SPECS[t]).map((t) =>
      `<button type="button" class="claim" data-ln="recruit" data-unit="${t}" data-tip="${attr(tip(UNIT_SPECS[t].name, `$${UNIT_SPECS[t].cost}bn, ${Math.round(UNIT_SPECS[t].cost * 10)} equipment, ${(UNIT_SPECS[t].men / 1000).toFixed(0)}k men`, `Ready in ${UNIT_SPECS[t].days} days`))}">+ ${esc(UNIT_SPECS[t].name.replace(/ division| wing| group/i, ''))}</button>`).join('');
    // advice: what is needed and what to build next
    const adv: Advice[] = [];
    if (cut) adv.push(['bad', `${cut} unit${cut > 1 ? 's' : ''} out of supply: build a supply depot near the front`, 'module:army', 'Supply reaches 3 provinces beyond your land from a capital, port or depot']);
    if ((mil?.equipment ?? 0) < (mil?.equipmentNeed ?? 0) * 5 && q.length) adv.push(['bad', `Equipment for only ${Math.floor((mil?.equipment ?? 0) / Math.max(0.1, mil?.equipmentNeed ?? 1))} days of production`, 'econ:b-military', 'Raise the military budget or build factories; factories need metals and power']);
    if (wars.length && !q.length) adv.push(['warn', 'At war with nothing in production: recruit', 'module:army']);
    if (e.fuelDays < 30) adv.push(['bad', `Fuel for ${e.fuelDays} days: forces fight weaker without oil`, 'market:local:oil', 'Buy oil, sign a supply contract for it, or win land with oil']);
    if (e.munitions < 40) adv.push(['warn', `Munitions at ${e.munitions}%`, 'econ:b-military']);
    if ((mil?.manpower ?? 0) < 30_000) adv.push(['warn', 'Few reservists left: conscription or a military focus brings more', 'politics:laws']);
    for (const w of wars) { const foe = w.a === me ? w.b : w.a; if ((mine.warScores?.[foe] ?? 0) < -30 && !g.truce(me, foe)) { adv.push(['bad', `Losing to the ${this.pol.nations.get(foe)?.short ?? '?'}: consider a truce`, `diplo:${foe}`]); break; } }
    if (!wars.length && by('air').length === 0 && e.gdp > 300) adv.push(['warn', 'No air force: fighters protect your armies and cities', 'module:air']);
    if (mil && mil.generals < Math.min(mil.maxGenerals, Math.ceil(by('land').length / 6))) adv.push(['warn', 'Armies without generals: appoint one (L on a selected stack)', 'module:army']);
    return `<div class="lens-kpis">
        <div><span>Land</span><b>${by('land').length}</b></div><div><span>Naval</span><b>${by('sea').length}</b></div><div><span>Air</span><b>${by('air').length}</b></div>
        <div><span>In battle</span><b class="${fighting ? 'down' : ''}">${fighting}</b></div><div><span>Equipment</span><b>${mil?.equipment ?? 0}</b><em>+${mil?.equipmentRate ?? 0}/day</em></div><div><span>Manpower</span><b>${Math.round((mil?.manpower ?? 0) / 1000)}k</b></div>
      </div>
      <span class="label">WARS</span>${warRows}
      <span class="label">PRODUCTION · ${q.length} queued${q[0] ? ` · next: ${esc(UNIT_SPECS[q[0].type].name)} ${Math.round(q[0].progress * 100)}%` : ''}</span>
      <div class="actions-row">${quick}</div>
      <div class="actions-row"><a href="#" class="go" data-go="module:army">Army</a> · <a href="#" class="go" data-go="module:navy">Navy</a> · <a href="#" class="go" data-go="module:air">Air force</a> · <a href="#" class="go" data-go="module:espionage">Espionage</a></div>
      <span class="label">ADVICE</span>${this.adviceHtml(adv)}`;
  }

  // ---- economy -----------------------------------------------------------------------
  private eco() {
    const g = this.game, mine = g.mine!, e = mine.econ!;
    const bal = e.revenue - e.spending;
    const cover = e.energy.demand > 0 ? e.energy.supply / e.energy.demand : 1;
    const building = Object.entries(g.war.buildings).filter(([p]) => this.pol.provinces.get(Number(p))?.nation === mine.id).flatMap(([, l]) => l).filter((b) => b.progress < 1).length;
    const short = COMMODITIES.filter((c) => e.goods[c].short > 0.01);
    const adv: Advice[] = [];
    const capital = this.pol.nations.get(mine.id)?.capital;
    if (cover < 1.02) adv.push([cover < 0.99 ? 'bad' : 'warn', cover < 0.99 ? `Blackouts: ${Math.round((1 - cover) * 100)}% of demand unmet. Build a power station` : 'Electricity nearly maxed out: build a power station soon', `build:${capital}`, 'Gas and coal stations need fuel; nuclear, wind and solar do not. Lithium makes wind and solar stronger']);
    for (const c of short) adv.push(['bad', `Short of ${COMMODITY_INFO[c].name.toLowerCase()} (${Math.round(e.goods[c].short * 100)}% unmet)`, `market:local:${c}`, 'Trade agreements cheapen imports; a supply contract guarantees delivery; a mine raises output']);
    if (e.treasury < 0) adv.push(['warn', `In debt: ${money(-e.treasury)} at ${((mine.rate ?? 0.04) * 100).toFixed(1)}% a year`, 'econ:econTax', 'Raise taxes, pass Austerity, or cut spending']);
    if (bal < 0 && e.treasury > 0) adv.push(['warn', `Running a deficit of ${money(-bal)} a year`, 'econ:econTax']);
    if (e.stability < 45) adv.push(['bad', `Stability ${Math.round(e.stability)}: more welfare, or address the nation`, 'politics:', 'Below 25, coups and revolutions become possible']);
    if (!mine.research?.current) adv.push(['warn', 'Nothing being researched', 'module:research']);
    else if (!(mine.research.queue ?? []).length) adv.push(['warn', `Research queue empty after ${TECHS.find((t) => t.id === mine.research!.current)?.name ?? ''}`, 'module:research']);
    if (building === 0 && e.treasury > e.gdp * 0.02) adv.push(['good', 'Money to spare and nothing under construction: build a factory for growth and equipment', `build:${capital}`]);
    if (e.infra < 0.9) adv.push(['warn', `Infrastructure at ${Math.round(e.infra * 100)}% of need: raise its budget share`, 'econ:b-infrastructure']);
    return `<div class="lens-kpis">
        <div><span>Treasury</span><b class="${e.treasury < 0 ? 'down' : ''}">${e.treasury < 0 ? '−' : ''}${money(Math.abs(e.treasury))}</b><em class="${bal >= 0 ? 'up' : 'down'}">${bal >= 0 ? '+' : '−'}${money(Math.abs(bal))}/yr</em></div>
        <div><span>GDP</span><b>${money(e.gdp)}</b><em class="${e.growth >= 0 ? 'up' : 'down'}">${(e.growth * 100).toFixed(1)}% a year</em></div>
        <div><span>Tax</span><b>${mine.tax}%</b><em><button type="button" class="link" data-ln="tax" data-d="-1">−1</button> <button type="button" class="link" data-ln="tax" data-d="1">+1</button></em></div>
        <div><span>Stability</span><b>${Math.round(e.stability)}%</b></div>
        <div><span>Electricity</span><b class="${cover < 0.99 ? 'down' : ''}">${Math.round(Math.min(1, cover) * 100)}%</b></div>
        <div><span>Building</span><b>${building}</b><em>projects</em></div>
      </div>
      <span class="label">BUDGET</span>
      <div class="lens-budget">${(['military', 'infrastructure', 'welfare', 'research'] as const).map((k) => `<a href="#" class="go" data-go="econ:b-${k}"><span>${k}</span><b>${e.budget[k]}%</b></a>`).join('')}</div>
      <div class="actions-row lens-tools"><button type="button" class="claim primary" data-ln="buildmode" data-tip="${attr(tip('Build', 'Pick provinces on the map and choose what to build in each', 'Back returns you to this lens'))}">Build…</button><button type="button" class="claim" data-ln="roads" data-tip="${attr(tip('Roads', 'Drag a road across your provinces: troops and supplies move faster along it', 'Snaps to province centres and cities'))}">Roads…</button></div>
      <div class="actions-row"><a href="#" class="go" data-go="build:${capital}">Build at the capital</a> · <a href="#" class="go" data-go="module:economy">Economy</a> · <a href="#" class="go" data-go="module:market">Market</a> · <a href="#" class="go" data-go="module:politics">Politics</a></div>
      <span class="label">ADVICE</span>${this.adviceHtml(adv)}`;
  }
}
