// The Market window: every good your nation makes and uses, electricity included,
// against the world market. Local market: your output, use, trade and stocks, with
// charts over time. World market: prices and the world's supply and demand.
// Built on the economy the server already runs; new goods appear here by themselves.
import { COMMODITIES, COMMODITY_INFO, money, type Commodity, type EconomyPrivate } from '../../shared/economy';
import type { Change, Game } from './game';
import { keepScrollOn } from './keep-scroll';
import { attr, tip } from './tooltip';
import type { Political } from './political';
import { SPECIALTIES, SPECIALTY_LIST, specialtyOf, specialtyWeight, type Specialty } from '../../shared/specialties';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`;

function qty(v: number, unit: string) {
  const a = Math.abs(v);
  const s = a >= 1e4 ? `${(a / 1e3).toFixed(0)}k` : a >= 100 ? a.toFixed(0) : a >= 1 ? a.toFixed(1) : a.toFixed(2);
  return `${v < 0 ? '−' : ''}${s} ${unit}`;
}

/** Price per familiar unit: $/bbl, $/t, $/1000 m³, $k/t. */
function priceLabel(c: Commodity, p: number) {
  const per = p * 1000;
  return c === 'oil' ? `$${per.toFixed(1)}/bbl` : c === 'gas' ? `$${per.toFixed(0)}/1000 m³` : c === 'rare_earths' ? `$${per.toFixed(1)}k/t` : c === 'timber' ? `$${per.toFixed(0)}/m³` : `$${per.toFixed(0)}/t`;
}

const COLORS = ['#d9b45a', '#6fa8dc', '#e06c5a', '#8fd17a', '#b58fd6', '#5fc9c0', '#e0a050'];

/**
 * A readable line chart: labelled value axis, week markers, a legend, and the
 * latest value on each line. Series share one axis.
 */
function lineChart(series: { name: string; values: number[]; color: string; dash?: boolean }[], fmt: (v: number) => string, label: string) {
  const n = Math.max(0, ...series.map((s) => s.values.length));
  if (n < 2) return `<div class="chart-empty">Charts add a point every game week (about 70 seconds at normal speed).</div>`;
  const W = 560, H = 190, L = 58, R = 12, T = 10, B = 22;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo > 0 && lo < hi * 0.35) lo = 0;
  if (hi - lo < 1e-9) { hi += Math.abs(hi) * 0.1 + 1; lo -= Math.abs(lo) * 0.1 + 1; }
  const pad = (hi - lo) * 0.08; hi += pad; if (lo !== 0) lo -= pad;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const grid = ticks.map((v) => `<path class="g" d="M${L} ${y(v).toFixed(1)}H${W - R}"/><text class="ax" x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(v))}</text>`).join('');
  const weeks = `<text class="ax" x="${L}" y="${H - 6}">${n - 1} week${n - 1 === 1 ? "" : "s"} ago</text><text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">now</text>`;
  const zero = lo < 0 && hi > 0 ? `<path class="z" d="M${L} ${y(0).toFixed(1)}H${W - R}"/>` : '';
  const lines = series.map((s) => {
    const off = n - s.values.length;
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i + off).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const last = s.values[s.values.length - 1];
    return `<path class="l" d="${d}" stroke="${s.color}"${s.dash ? ' stroke-dasharray="5 4"' : ''}/><circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="${s.color}"/>`;
  }).join('');
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b class="mono">${esc(fmt(s.values[s.values.length - 1]))}</b></span>`).join('');
  return `<figure class="market-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${zero}${weeks}${lines}</svg><figcaption class="chart-legend">${legend}</figcaption></figure>`;
}

type Tab = 'local' | 'world';
type Pick = Commodity | 'power';

export class MarketPanel {
  private el: HTMLElement;
  private tab: Tab = 'local';
  private pick: Pick = 'food';
  private html = '';

  constructor(root: HTMLElement, private game: Game, private pol?: Political) {
    this.el = document.createElement('section');
    this.el.className = 'panel econ-window market-window';
    keepScrollOn(this.el);
    this.el.setAttribute('aria-label', 'Market');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-mk]');
      if (!t) return;
      const a = t.dataset.mk;
      if (a === 'close') { this.close(); document.dispatchEvent(new CustomEvent('market-closed')); }
      else if (a === 'tab') { this.tab = t.dataset.tab as Tab; this.render(); }
      else if (a === 'pick') { this.pick = t.dataset.good as Pick; this.render(); }
    });
    game.on((c: Set<Change>) => { if (!this.el.hidden && (c.has('mine') || c.has('economy') || c.has('status'))) this.render(); });
  }

  get isOpen() { return !this.el.hidden; }
  toggle() { this.el.hidden = !this.el.hidden; if (!this.el.hidden) { this.html = ''; this.render(); } }
  close() { this.el.hidden = true; }
  /** Open on a given tab and good (from links in the manual or elsewhere). */
  show(tab: Tab, good?: Pick | 'spec') {
    this.tab = tab;
    if (good && good !== 'spec') this.pick = good;
    this.el.hidden = false; this.html = ''; this.render();
    if (good === 'spec') requestAnimationFrame(() => this.el.querySelector('#mkSpec')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  /** Your specialties, the luxuries trade partners share, and who holds the ones you lack. */
  private specialtiesHtml() {
    const sp = this.game.mine?.specialties;
    if (!sp) return '';
    const mineId = this.game.mine!.id;
    const holders = new Map<Specialty, Map<number, number>>();
    if (this.pol) for (const p of this.pol.provinces.values()) {
      if (!p.nation || p.nation === mineId) continue;
      const s = specialtyOf(p as never);
      if (!s) continue;
      const m = holders.get(s) ?? new Map<number, number>();
      m.set(p.nation, (m.get(p.nation) ?? 0) + 1);
      holders.set(s, m);
    }
    const who = (s: Specialty) => {
      const list = [...(holders.get(s) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      return list.map(([id]) => {
        const n = this.pol?.nations.get(id);
        return n ? `<a href="#" class="go" data-go="nation:${id}">${esc(n.name)}</a>` : '';
      }).filter(Boolean).join(', ') || 'nobody';
    };
    const card = (s: Specialty, state: 'own' | 'shared' | 'missing', count = 0) => {
      const info = SPECIALTIES[s];
      const strength = state === 'own' ? specialtyWeight(count) : state === 'shared' ? 0.5 : 0;
      const how = state === 'own' ? `${count} province${count === 1 ? '' : 's'} · ${Math.round(strength * 100)}% strength (each more adds less, up to 200%)`
        : state === 'shared' ? 'Through a trade partner · 50% strength'
        : info.luxury ? 'Win a province with it, or sign a trade agreement with a holder to share it' : 'Win a province with it';
      const t = tip(`${info.icon} ${info.name}`, state === 'missing' ? info.effect : [info.effect, 'good'], how);
      return `<div class="spec-card ${state}" data-tip="${attr(t)}"><span class="sp-ico">${info.icon}</span><div><b>${info.name}</b>
        <em>${state === 'own' ? `×${count}` : state === 'shared' ? 'shared' : ''}</em><span>${esc(info.effect)}</span>
        ${state === 'missing' ? `<span class="muted">Held by ${who(s)}</span>` : ''}</div></div>`;
    };
    const own = (Object.entries(sp.own) as [Specialty, number][]).sort((a, b) => b[1] - a[1]);
    const missing = SPECIALTY_LIST.filter((s) => !sp.own[s] && !sp.shared.includes(s));
    return `<span class="label" id="mkSpec">SPECIALTIES · what your land is known for</span>
      <div class="spec-grid">${own.map(([s, c]) => card(s, 'own', c)).join('') || '<p class="hint">None held.</p>'}</div>
      ${sp.shared.length ? `<span class="label">LUXURIES FROM TRADE PARTNERS</span><div class="spec-grid">${sp.shared.map((s) => card(s, 'shared')).join('')}</div>` : ''}
      <span class="label">NOT YET YOURS</span>
      <div class="spec-grid">${missing.map((s) => card(s, 'missing')).join('')}</div>
      <p class="hint">Each land province is known for one specialty, from its climate, latitude, height, coast and rivers; the province panel shows it. Luxuries (wine, spices, coffee, furs, gems) reach your trade partners at half strength, and theirs reach you.</p>`;
  }

  private render() {
    const e = this.game.mine?.econ;
    const head = `<div class="econ-head"><div><span class="label">MARKET</span><h2>${this.tab === 'local' ? 'Local market' : 'World market'}</h2></div>
      <div class="mk-tabs" role="tablist">
        <button type="button" role="tab" data-mk="tab" data-tab="local" aria-selected="${this.tab === 'local'}">Local market</button>
        <button type="button" role="tab" data-mk="tab" data-tab="world" aria-selected="${this.tab === 'world'}">World market</button>
      </div>
      <button type="button" class="link" data-mk="close">Close</button></div>`;
    const body = this.tab === 'local'
      ? (e ? this.localHtml(e) : '<p class="hint">Take command of a nation to see its own market. The world market is on the other tab.</p>')
      : this.worldHtml();
    const html = `${head}<div class="econ-body">${body}</div>`;
    if (html !== this.html) { this.html = html; this.el.innerHTML = html; }
  }

  // ---- local market ----------------------------------------------------------------
  private localHtml(e: EconomyPrivate) {
    const m = this.game.market;
    const en = e.energy;
    const cover = en.demand > 0 ? en.supply / en.demand : 1;
    const tradeValue = COMMODITIES.reduce((s, c) => s + e.goods[c].trade * (m?.prices[c] ?? COMMODITY_INFO[c].basePrice), 0);
    const rows = COMMODITIES.map((c) => {
      const g = e.goods[c], info = COMMODITY_INFO[c];
      const days = g.use > 0 ? Math.round((g.stock / g.use) * 365) : 0;
      const bal = g.prod - g.use;
      const price = m?.prices[c] ?? info.basePrice;
      const trade = Math.abs(g.trade) < 1e-6 ? '—' : `<span class="${g.trade > 0 ? 'up' : 'down'}">${g.trade > 0 ? 'exports' : 'imports'} ${qty(Math.abs(g.trade), info.unit)}</span>`;
      const tipText = tip(info.name, `Output ${qty(g.prod, info.unit)} a year, use ${qty(g.use, info.unit)}`,
        bal >= 0 ? [`Surplus ${qty(bal, info.unit)}: sold abroad`, 'good'] : [`Deficit ${qty(-bal, info.unit)}: bought abroad`, 'bad'],
        g.short > 0.01 ? [`${Math.round(g.short * 100)}% of need unmet: hurts growth and stability`, 'bad'] : null,
        `Stock lasts ${days} days · world price ${priceLabel(c, price)}`, 'Click to chart it');
      return `<tr class="${g.short > 0.01 ? 'short' : ''}${this.pick === c ? ' picked' : ''}" data-mk="pick" data-good="${c}" data-tip="${attr(tipText)}">
        <th scope="row">${info.name}${g.short > 0.01 ? ` <span class="pill">short ${Math.round(g.short * 100)}%</span>` : ''}</th>
        <td>${qty(g.prod, info.unit)}</td><td>${qty(g.use, info.unit)}</td><td class="${bal >= 0 ? 'up' : 'down'}">${bal >= 0 ? '+' : ''}${qty(bal, info.unit)}</td>
        <td>${trade}</td><td>${days} d</td><td class="mono">${priceLabel(c, price)}</td></tr>`;
    }).join('');
    const powerRow = `<tr class="${en.blackout > 0.005 ? 'short' : ''}${this.pick === 'power' ? ' picked' : ''}" data-mk="pick" data-good="power"
      data-tip="${attr(tip('Electricity', `Demand ${Math.round(en.demand)} units (1 per $bn of GDP)`, `Grid ${Math.round(en.grid)} + power stations ${Math.round(en.plants)}`, en.blackout > 0.005 ? [`Blackouts: ${Math.round(en.blackout * 100)}% unmet`, 'bad'] : ['Supply covers demand', 'good'], 'Power stations are built from a province panel', 'Click to chart it'))}">
      <th scope="row">Electricity${en.blackout > 0.005 ? ` <span class="pill">blackout ${Math.round(en.blackout * 100)}%</span>` : ''}</th>
      <td>${Math.round(en.supply)}</td><td>${Math.round(en.demand)}</td><td class="${cover >= 1 ? 'up' : 'down'}">${cover >= 1 ? '+' : ''}${Math.round(en.supply - en.demand)}</td>
      <td>—</td><td>—</td><td class="mono">—</td></tr>`;
    const hist = e.history ?? [];
    let chart: string;
    if (this.pick === 'power') {
      const pts = hist.filter((h) => h.e);
      chart = lineChart([
        { name: 'Demand', values: pts.map((h) => h.e![0]), color: COLORS[2] },
        { name: 'Supply', values: pts.map((h) => h.e![1]), color: COLORS[0] },
      ], (v) => `${Math.round(v)}`, 'Electricity demand and supply');
    } else {
      const c = this.pick, info = COMMODITY_INFO[c];
      const pts = hist.filter((h) => h.g?.[c]);
      chart = lineChart([
        { name: 'Output', values: pts.map((h) => h.g![c]![0]), color: COLORS[0] },
        { name: 'Use', values: pts.map((h) => h.g![c]![1]), color: COLORS[2] },
        { name: 'Net trade', values: pts.map((h) => h.g![c]![2]), color: COLORS[1], dash: true },
      ], (v) => qty(v, info.unit), `${info.name}: output, use and trade`);
    }
    const name = this.pick === 'power' ? 'Electricity' : COMMODITY_INFO[this.pick].name;
    return `
      <div class="econ-kpis">
        <div><span>Electricity</span><b class="${cover < 1 ? 'down' : ''}">${Math.round(cover * 100)}%</b><em>of demand met</em></div>
        <div><span>Trade balance</span><b class="${tradeValue >= 0 ? 'up' : 'down'}">${money(Math.abs(tradeValue))}</b><em>${tradeValue >= 0 ? 'earned from exports' : 'spent on imports'} a year</em></div>
        <div><span>Shortages</span><b class="${e.shortage > 0.02 ? 'down' : ''}">${Math.round(e.shortage * 100)}%</b><em>of needs unmet</em></div>
        <div><span>Fuel for forces</span><b class="${e.fuelDays < 60 ? 'down' : ''}">${e.fuelDays} days</b><em>forces burn ${en.militaryOil}bn bbl a year</em></div>
      </div>
      <span class="label">YOUR GOODS · PER YEAR · click a row to chart it</span>
      <div class="table-wrap"><table class="goods market-table">
        <thead><tr><th scope="col">Good</th><th scope="col">Output</th><th scope="col">Use</th><th scope="col">Balance</th><th scope="col">Trade</th><th scope="col">Stock</th><th scope="col">World price</th></tr></thead>
        <tbody>${rows}${powerRow}</tbody>
      </table></div>
      <span class="label">${esc(name.toUpperCase())} OVER TIME</span>
      ${chart}
      <p class="hint">Surpluses are sold and shortfalls bought on the world market every day, at world prices; embargoes and blockades cut that trade. Electricity is local: it cannot be traded, so build power stations (from a province panel) as demand grows.</p>
      ${this.specialtiesHtml()}`;
  }

  // ---- world market ----------------------------------------------------------------
  private worldHtml() {
    const m = this.game.market;
    if (!m) return '<p class="hint">Connect to a world to see its market.</p>';
    const pick: Commodity = this.pick === 'power' ? 'food' : this.pick;
    const last = m.history[m.history.length - 1];
    const cards = COMMODITIES.map((c) => {
      const info = COMMODITY_INFO[c];
      const rel = m.prices[c] / info.basePrice - 1;
      const s = last?.s?.[c], u = last?.u?.[c];
      const bal = s !== undefined && u !== undefined && u > 0 ? s / u - 1 : undefined;
      const tipText = tip(`${info.name}: ${priceLabel(c, m.prices[c])}`, rel > 0 ? [`${pct(rel)} above its 2026 price: dearer for buyers, better for sellers`, 'bad'] : [`${pct(rel)} against its 2026 price: cheaper for buyers`, 'good'],
        bal !== undefined ? (bal >= 0 ? [`World output ${Math.round(bal * 100)}% above use: prices tend to fall`, 'good'] : [`World output ${Math.round(-bal * 100)}% below use: prices tend to rise`, 'bad']) : null, 'Click to chart it');
      return `<button type="button" class="price${pick === c ? ' picked' : ''}" data-mk="pick" data-good="${c}" data-tip="${attr(tipText)}">
        <span>${info.name}</span><b class="mono">${priceLabel(c, m.prices[c])}</b>
        <em class="mono ${rel > 0.005 ? 'up-price' : rel < -0.005 ? 'down-price' : ''}">${pct(rel)} since 2026</em></button>`;
    }).join('');
    const info = COMMODITY_INFO[pick];
    const pts = m.history;
    const price = lineChart([{ name: `${info.name} price`, values: pts.map((h) => h.p[pick] * 1000), color: COLORS[0] }],
      (v) => priceLabel(pick, v / 1000), `${info.name} price`);
    const sd = pts.filter((h) => h.s?.[pick] !== undefined);
    const supply = lineChart([
      { name: 'World output', values: sd.map((h) => h.s![pick]!), color: COLORS[3] },
      { name: 'World use', values: sd.map((h) => h.u![pick]!), color: COLORS[2] },
    ], (v) => qty(v, info.unit), `${info.name}: world supply and demand`);
    const index = lineChart(COMMODITIES.map((c, i) => ({ name: COMMODITY_INFO[c].name, values: pts.map((h) => (h.p[c] / COMMODITY_INFO[c].basePrice) * 100), color: COLORS[i % COLORS.length] })),
      (v) => `${Math.round(v)}`, 'Price index of every good, 2026 = 100');
    return `
      <div class="market-grid">${cards}</div>
      <span class="label">${esc(info.name.toUpperCase())} · PRICE</span>${price}
      <span class="label">${esc(info.name.toUpperCase())} · WORLD SUPPLY AND DEMAND</span>${supply}
      <span class="label">ALL GOODS · PRICE INDEX (2026 = 100)</span>${index}
      <p class="hint">One world market for every nation, players and AI alike. Prices rise when the world uses more than it makes and fall when it makes more; wars, blockades, embargoes and world events move them.</p>`;
  }
}
