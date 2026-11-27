// Right-click a good in the market: a little menu to trade it with another
// nation, once (one shipment now, at the world price) or on a schedule (a
// supply contract over 1, 2 or 5 years). Your trade partners are listed first.
import { routeBetween } from './trade-fee';
import { attr, tip } from './tooltip';
import { COMMODITY_INFO, type Commodity } from '../../shared/economy';
import { CONTRACT_YEARS, type Deal } from '../../shared/diplomacy';
import type { Game } from './game';
import type { Political } from './political';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class TradeMenu {
  private el: HTMLElement;
  private good: Commodity = 'food';
  private sell = true;
  private amount = 0;
  private years = CONTRACT_YEARS[1];
  private sent = new Set<string>();

  constructor(root: HTMLElement, private game: Game, private pol: Political, private propose: (to: number, deal: Deal) => void) {
    this.el = document.createElement('div');
    this.el.className = 'trade-menu panel';
    this.el.hidden = true;
    this.el.setAttribute('role', 'menu');
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'tmAmount') { this.amount = Math.max(0, Number(t.value) || 0); this.updateValue(); }
    });
    document.addEventListener('pointerdown', (e) => { if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close(); }, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.hidden) { e.stopImmediatePropagation(); this.close(); } }, true);
  }

  /** Open for a good, at the pointer. */
  open(good: Commodity, x: number, y: number) {
    const e = this.game.mine?.econ;
    if (!e) return;
    this.good = good;
    const g = e.goods[good];
    // sell what you have spare, buy what you are short of
    this.sell = g.prod >= g.use;
    this.amount = this.suggested();
    this.sent.clear();
    this.render();
    this.el.hidden = false;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${Math.min(x, innerWidth - w - 8)}px`;
    this.el.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  }

  close() { this.el.hidden = true; }

  /** A tenth of a year's output (selling) or use (buying), rounded. */
  private suggested() {
    const g = this.game.mine!.econ!.goods[this.good];
    const v = Math.max(1, (this.sell ? Math.min(g.prod, g.stock + g.prod * 0.1) : g.use) * 0.1);
    const mag = 10 ** Math.floor(Math.log10(v));
    return Math.round(v / mag) * mag;
  }

  private price() { return this.game.market?.prices[this.good] ?? COMMODITY_INFO[this.good].basePrice; }

  private updateValue() {
    const out = this.el.querySelector('#tmValue');
    if (out) out.textContent = `$${(this.amount * this.price()).toFixed(2)}bn once · $${(this.amount * this.price()).toFixed(2)}bn a year on contract`;
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tm]');
    if (!t) return;
    const a = t.dataset.tm;
    if (a === 'side') { this.sell = t.dataset.v === 'sell'; this.amount = this.suggested(); this.render(); return; }
    if (a === 'years') { this.years = Number(t.dataset.v); this.render(); return; }
    if (a === 'close') { this.close(); return; }
    const to = Number(t.dataset.n);
    if (!(this.amount > 0) || !Number.isFinite(to)) return;
    const deal: Deal = a === 'once'
      ? { kind: 'sale', good: this.good, amount: this.amount, sell: this.sell }
      : { kind: 'contract', good: this.good, amount: this.amount, years: this.years, sell: this.sell };
    this.propose(to, deal);
    this.sent.add(`${a}:${to}`);
    t.textContent = 'Offered';
    (t as HTMLButtonElement).disabled = true;
  }

  private render() {
    const mine = this.game.mine;
    if (!mine?.econ) return;
    const info = COMMODITY_INFO[this.good], g = mine.econ.goods[this.good];
    const me = mine.id;
    const live = [...this.game.nations.values()].filter((n) => n.id !== me && !n.annexedBy && this.pol.nations.has(n.id));
    const partner = (id: number) => this.game.treaty('trade', me, id);
    const atWar = (id: number) => this.game.war.wars.some((w) => (w.a === me && w.b === id) || (w.b === me && w.a === id));
    const gdp = (id: number) => this.game.economy.get(id)?.gdp ?? 0;
    const partners = live.filter((n) => partner(n.id)).sort((a, b) => gdp(b.id) - gdp(a.id));
    const others = live.filter((n) => !partner(n.id) && !atWar(n.id)).sort((a, b) => gdp(b.id) - gdp(a.id)).slice(0, 30);
    // how the goods would travel, and what caravans over foreign land add to the price
    const via = (id: number) => {
      const r = routeBetween(this.game, this.pol, me, id);
      if (!r) return '<span class="tm-fee muted" title="No way to get goods there now">no route</span>';
      const sea = r.path.some((q) => this.pol.provinces.get(q)?.kind === 'sea');
      if (!r.fee) return `<span class="tm-fee muted" data-tip="${attr(tip(sea ? 'By sea' : 'Overland', r.canals.length ? `Through ${r.canals.length} canal${r.canals.length > 1 ? 's' : ''}` : sea ? 'No caravans needed' : 'Over your own land and theirs', ['No fee', 'good']))}">${sea ? 'by sea' : 'overland'}</span>`;
      const extra = this.amount * this.price() * r.fee;
      return `<span class="tm-fee" data-tip="${attr(tip(`Caravan fee +${(r.fee * 100).toFixed(1)}%`, `${r.caravan.length} foreign province${r.caravan.length > 1 ? 's' : ''} crossed by caravan${sea ? ', the rest by sea' : ''}`, [`The buyer pays $${extra.toFixed(2)}bn more on this amount${this.sell ? ' (they pay it)' : ' (you pay it)'}`, this.sell ? 'good' : 'bad'], 'A canal in one of those provinces would let ships through instead'))}">caravan +${(r.fee * 100).toFixed(1)}%</span>`;
    };
    const row = (id: number) => `<li><span>${esc(this.pol.nations.get(id)!.name)} ${via(id)}</span>
      <button type="button" class="claim" data-tm="once" data-n="${id}" ${this.sent.has(`once:${id}`) ? 'disabled' : ''}>${this.sent.has(`once:${id}`) ? 'Offered' : 'Once'}</button>
      <button type="button" class="claim" data-tm="contract" data-n="${id}" ${this.sent.has(`contract:${id}`) ? 'disabled' : ''}>${this.sent.has(`contract:${id}`) ? 'Offered' : `${this.years}-yr contract`}</button></li>`;
    this.el.innerHTML = `<div class="row-between"><span class="label">TRADE ${esc(info.name.toUpperCase())}</span><button type="button" class="link" data-tm="close">Close</button></div>
      <p class="hint">World price $${this.price().toLocaleString('en-US', { maximumFractionDigits: 2 })}bn per ${esc(info.unit)} · you hold ${Math.floor(g.stock).toLocaleString('en-US')} ${esc(info.unit)}</p>
      <div class="tm-seg"><button type="button" class="chip${this.sell ? ' on' : ''}" data-tm="side" data-v="sell">Sell</button><button type="button" class="chip${this.sell ? '' : ' on'}" data-tm="side" data-v="buy">Buy</button>
        <label class="tm-amount"><input id="tmAmount" type="number" min="0" step="any" value="${this.amount}" aria-label="Amount"> ${esc(info.unit)}</label></div>
      <p class="mono tm-value" id="tmValue"></p>
      <div class="tm-seg"><span class="muted">Contract length</span>${CONTRACT_YEARS.map((y) => `<button type="button" class="chip${y === this.years ? ' on' : ''}" data-tm="years" data-v="${y}">${y} yr</button>`).join('')}</div>
      <div class="tm-list">
        ${partners.length ? `<span class="label">TRADE PARTNERS</span><ul>${partners.map((n) => row(n.id)).join('')}</ul>` : ''}
        <span class="label">${partners.length ? 'OTHER NATIONS' : 'NATIONS'} · largest economies</span><ul>${others.map((n) => row(n.id)).join('')}</ul>
      </div>
      <p class="hint">Once: one shipment now, at the world price. Contract: the same amount every year, delivered daily at today's price. Goods go by sea where they can; over foreign land they go by caravan, and the buyer pays a fee on top (1.5% a province) unless a canal lets ships through. They answer by what they need and what they think of you.</p>`;
    this.updateValue();
  }
}
