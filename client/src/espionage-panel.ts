import { threatStackHtml } from './threat-stack';
// The Espionage window: agent networks abroad, counter-intelligence at home,
// covert missions (each needs a network of a certain strength), and reports.
import { COUNTER_INTEL_COST, MAX_NETWORKS, MAX_SPY_OPS, NETWORK_COST, NETWORK_GROWTH, SPY_COST, SPY_MISSIONS, type SpyMission } from '../../shared/diplomacy';
import type { Order } from '../../shared/protocol';
import type { Change, Game } from './game';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';
import { attr, tip } from './tooltip';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LEVELS = ['None', 'Basic', 'Active', 'Total'];

export class EspionagePanel {
  private el: HTMLElement;
  private html = '';

  constructor(root: HTMLElement, private game: Game, private pol: Political, private order: (o: Order) => void) {
    this.el = document.createElement('section');
    this.el.className = 'panel econ-window spy-window';
    keepScrollOn(this.el);
    this.el.setAttribute('aria-label', 'Espionage');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
      if (!t) return;
      const a = t.dataset.s, id = Number(t.dataset.nation);
      if (a === 'close') { this.close(); document.dispatchEvent(new CustomEvent('espionage-closed')); }
      else if (a === 'build') this.order({ kind: 'network', target: id, build: true });
      else if (a === 'stop') this.order({ kind: 'network', target: id, build: false });
      else if (a === 'new') { const v = Number((this.el.querySelector('#spyNew') as HTMLSelectElement).value); if (v) this.order({ kind: 'network', target: v, build: true }); }
      else if (a === 'counter') this.order({ kind: 'counter_intel', level: Number(t.dataset.level) });
      else if (a === 'mission') this.order({ kind: 'spy', target: id, mission: t.dataset.mission as SpyMission });
    });
    game.on((c: Set<Change>) => { if (this.isOpen && (c.has('mine') || c.has('status'))) this.render(); });
  }

  get isOpen() { return !this.el.hidden; }
  toggle() { this.el.hidden = !this.el.hidden; if (this.isOpen) { this.html = ''; this.render(); } }
  close() { this.el.hidden = true; }

  private render() {
    const mine = this.game.mine;
    const head = `<div class="econ-head"><div><span class="label">ESPIONAGE</span><h2>${esc(mine ? this.pol.nations.get(mine.id)?.name ?? '' : 'Espionage')}</h2></div><button type="button" class="link" data-s="close">Close</button></div>`;
    if (!mine) { this.set(`${head}<div class="econ-body"><p class="hint">Take command of a nation to run its intelligence service.</p></div>`); return; }
    const spy = mine.spy ?? { nets: {}, building: [], counter: 0, foreign: 0 };
    const funds = mine.mil?.funds ?? 0, ops = mine.spyOps ?? 0;
    const digital = !!mine.research?.done.includes('digital_state');
    const nets = Object.entries(spy.nets).map(([k, v]) => [Number(k), v] as [number, number]);
    for (const b of spy.building) if (!nets.some(([k]) => k === b)) nets.push([b, 0]);
    nets.sort((a, b) => b[1] - a[1]);
    const name = (id: number) => esc(this.pol.nations.get(id)?.name ?? `Nation ${id}`);
    const rows = nets.map(([id, v]) => {
      const building = spy.building.includes(id);
      const missions = (Object.keys(SPY_MISSIONS) as SpyMission[]).map((m) => {
        const M = SPY_MISSIONS[m], lacks = v < M.need || (m.startsWith('cyber') && !digital);
        const t = tip(M.name, M.text, `Needs a network of ${M.need}${m.startsWith('cyber') ? ' and Digital government research' : ''}`, [`Costs $${SPY_COST}bn of military funds; takes 5 days`, 'bad'], 'Stronger networks succeed more often; their counter-intelligence catches more agents');
        return `<button type="button" class="claim${lacks ? '' : ' primary'}" data-s="mission" data-nation="${id}" data-mission="${m}" data-tip="${attr(t)}" ${lacks || ops >= MAX_SPY_OPS || funds < SPY_COST ? 'disabled' : ''}>${M.name}</button>`;
      }).join('');
      return `<div class="spy-row"><div class="spy-head"><b><a href="#" class="go" data-go="diplo:${id}">${name(id)}</a></b>
        <div class="bar" role="img" aria-label="Network ${Math.round(v)} of 100"><i style="width:${v}%"></i></div><span class="mono">${Math.round(v)}</span>
        ${building ? `<button type="button" class="claim" data-s="stop" data-nation="${id}">Stop recruiting</button>` : `<button type="button" class="claim" data-s="build" data-nation="${id}" ${spy.building.length >= MAX_NETWORKS ? 'disabled' : ''}>Recruit agents</button>`}</div>
        <div class="spy-missions">${missions}</div></div>`;
    }).join('');
    const others = [...this.pol.nations.values()].filter((n) => n.id !== mine.id && !this.game.nations.get(n.id)?.annexedBy && !nets.some(([k]) => k === n.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const counterTip = (l: number) => tip(`Counter-intelligence: ${LEVELS[l]}`, l ? [`Foreign networks here lose ${(l * 0.25).toFixed(2)} a day; more of their agents are caught`, 'good'] : 'Foreign agents work freely', l ? [`Costs ${(COUNTER_INTEL_COST * l * 100).toFixed(2)}% of GDP a year`, 'bad'] : null);
    this.set(`${head}<div class="econ-body">
      <div class="econ-kpis">
        <div><span>Networks abroad</span><b>${nets.length}</b><em>${spy.building.length} of ${MAX_NETWORKS} recruiting</em></div>
        <div><span>Operations under way</span><b>${ops} / ${MAX_SPY_OPS}</b><em>$${SPY_COST}bn each from military funds</em></div>
        <div data-tip="${attr(tip('Foreign agents here', 'The strongest foreign network inside your nation', 'Counter-intelligence wears it down'))}"><span>Foreign agents here</span><b class="${spy.foreign > 40 ? 'down' : ''}">${spy.foreign}</b><em>strongest foreign network</em></div>
        <div><span>Military funds</span><b>$${funds.toFixed(1)}bn</b><em>recruiting costs $${NETWORK_COST}bn a day per network</em></div>
      </div>
      ${threatStackHtml({ nets, building: spy.building, ops, maxOps: MAX_SPY_OPS, counter: spy.counter, foreign: spy.foreign, name: (id) => this.pol.nations.get(id)?.name ?? `Nation ${id}` })}
      <span class="label">COUNTER-INTELLIGENCE</span>
      <div class="actions-row">${LEVELS.map((l, i) => `<button type="button" class="claim${spy.counter === i ? ' primary' : ''}" data-s="counter" data-level="${i}" data-tip="${attr(counterTip(i))}">${l}</button>`).join('')}</div>
      <span class="label">AGENT NETWORKS · recruiting adds ${NETWORK_GROWTH} a day; idle networks fade slowly</span>
      ${rows || '<p class="hint">No networks yet. Start one below: reconnaissance needs 10, stealing technology 30, rigging their politics 55, backing a coup 70.</p>'}
      <div class="deal-form"><select id="spyNew" aria-label="Nation">${others.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select>
        <button type="button" class="claim primary" data-s="new" ${spy.building.length >= MAX_NETWORKS ? 'disabled' : ''}>Start a network</button></div>
      <span class="label">REPORTS</span>
      ${(mine.reports ?? []).length ? `<ul class="reports">${mine.reports!.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="hint">No reports yet.</p>'}
    </div>`);
  }

  private set(html: string) { if (html !== this.html) { this.html = html; this.el.innerHTML = html; } }
}
