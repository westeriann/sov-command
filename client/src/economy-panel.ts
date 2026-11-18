// The Economy window: your national accounts, budget, goods and the world market.
import {
  BUDGET_KEYS, COMMODITIES, COMMODITY_INFO, money, normalizeBudget,
  type Budget, type Commodity, type EconomyPrivate, type HistoryPoint,
} from '../../shared/economy';
import { LIMITS } from '../../shared/protocol';
import type { Change, Game } from './game';
import type { Political } from './political';

export interface EconomyActions {
  budget(b: Partial<Budget>): void;
  tax(t: number): void;
  goToNation(id: number): void;
  borders(open: boolean): void;
}

const BUDGET_NAMES: Record<keyof Budget, [string, string]> = {
  military: ['Military', 'Funds forces, munitions and reservists (stage 4)'],
  infrastructure: ['Infrastructure', 'Raises output and growth over time'],
  welfare: ['Welfare', 'Raises stability and population growth'],
  research: ['Research', 'Banks research points and adds growth'],
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`;

function people(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} m`;
  return `${Math.round(n / 1e3)} k`;
}

function qty(v: number, unit: string) {
  const a = Math.abs(v);
  const s = a >= 1e4 ? `${(a / 1e3).toFixed(0)}k` : a >= 100 ? a.toFixed(0) : a >= 1 ? a.toFixed(1) : a.toFixed(2);
  return `${v < 0 ? '−' : ''}${s} ${unit}`;
}

/** Small area chart: faint grid, filled area, emphasised last point. Colours come from CSS tokens. */
function spark(values: number[], cls: string, label: string) {
  if (values.length < 2) return `<div class="spark-empty">Charts add a point every game week (about 70 seconds).</div>`;
  const w = 220, h = 46, pad = 3;
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const zero = lo < 0 && hi > 0 ? `<path class="zero" d="M${pad} ${y(0).toFixed(1)}H${w - pad}"/>` : '';
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <path class="grid" d="M${pad} ${h / 2}H${w - pad}"/>${zero}
    <path class="area" d="${line} L${x(values.length - 1).toFixed(1)} ${h - pad} L${pad} ${h - pad}Z"/>
    <path class="line" d="${line}"/>
    <circle class="dot" cx="${x(values.length - 1).toFixed(1)}" cy="${y(values[values.length - 1]).toFixed(1)}" r="2.6"/>
  </svg>`;
}

export class EconomyPanel {
  private el: HTMLElement;
  private budgetTimer = 0;
  private taxTimer = 0;
  private editing = false;
  private draft: Budget | null = null;

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: EconomyActions) {
    this.el = document.createElement('section');
    this.el.className = 'panel econ-window';
    this.el.setAttribute('aria-label', 'Economy');
    this.el.hidden = true;
    root.appendChild(this.el);
    game.on((c: Set<Change>) => {
      if (!this.el.hidden && (c.has('economy') || c.has('mine') || c.has('status'))) this.render();
    });
    this.el.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).matches('input[type=range]')) this.editing = true; });
    window.addEventListener('pointerup', () => { if (this.editing) { this.editing = false; } });
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-econ="close"]')) this.close();
      const b = t.closest<HTMLElement>('[data-borders]');
      if (b) { this.actions.borders(b.dataset.borders === 'open'); return; }
      const go = t.closest<HTMLElement>('[data-goto]');
      if (go) this.actions.goToNation(Number(go.dataset.goto));
    });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  toggle() {
    if (this.el.hidden) this.open();
    else this.close();
  }

  open() {
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.el.hidden = true;
    document.dispatchEvent(new CustomEvent('economy-closed'));
  }

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    const econ = this.game.mine?.econ;
    if (!econ) return;
    if (t.dataset.budget) {
      const key = t.dataset.budget as keyof Budget;
      this.draft = normalizeBudget({ [key]: Number(t.value) }, this.draft ?? econ.budget);
      // keep the slider being dragged where the player put it; show the rebalanced shares
      for (const k of BUDGET_KEYS) {
        const input = this.el.querySelector<HTMLInputElement>(`input[data-budget="${k}"]`)!;
        if (k !== key) input.value = String(this.draft[k]);
        this.el.querySelector<HTMLElement>(`[data-budget-out="${k}"]`)!.textContent = this.shareText(econ, this.draft[k]);
      }
      clearTimeout(this.budgetTimer);
      this.budgetTimer = window.setTimeout(() => {
        if (this.draft) this.actions.budget(this.draft);
        this.draft = null;
      }, 400);
    } else if (t.id === 'econTax') {
      this.el.querySelector<HTMLOutputElement>('#econTaxOut')!.value = `${t.value}%`;
      clearTimeout(this.taxTimer);
      this.taxTimer = window.setTimeout(() => this.actions.tax(Number(t.value)), 400);
    }
  }

  private shareText(e: EconomyPrivate, share: number) {
    return `${share}% · ${money((e.spending * 0.9 * share) / 100)}/yr`;
  }

  render() {
    if (this.editing) return; // never yank a slider out from under the player
    const mine = this.game.mine;
    const e = mine?.econ;
    this.el.innerHTML = `
      <div class="econ-head">
        <div><span class="label">ECONOMY</span><h2>${mine ? esc(this.pol.nations.get(mine.id)?.name ?? '') : 'World economy'}</h2></div>
        <button type="button" class="link" data-econ="close">Close</button>
      </div>
      <div class="econ-body">
        ${e && mine ? this.nationHtml(e, mine.tax) : `<p class="hint">${this.game.status === 'online' ? 'Take command of a nation to manage its budget, taxes and trade. The world market and the largest economies are below.' : 'Sign in to see live economic data.'}</p>`}
        ${this.marketHtml()}
        ${this.leagueHtml()}
      </div>`;
  }

  /** Electricity and the goods industry and armies depend on. */
  private energyHtml(e: EconomyPrivate) {
    const en = e.energy;
    if (!en) return '';
    const cover = en.demand > 0 ? en.supply / en.demand : 1;
    const warn = (c: keyof EconomyPrivate['goods'], what: string) => e.goods[c].short > 0.02 ? `<li class="down">${what} (${Math.round(e.goods[c].short * 100)}% short)</li>` : '';
    const problems = [
      en.blackout > 0.005 ? `<li class="down">Blackouts: ${Math.round(en.blackout * 100)}% of demand unmet — growth and stability suffer, factories stall. Build power stations.</li>` : '',
      warn('oil', 'Oil shortage: your forces fight weaker'),
      warn('metals', 'Metal shortage: units and munitions build slower, factories stall'),
      warn('rare_earths', 'Rare-earth shortage: research slows'),
      warn('coal', 'Coal shortage: coal power stations falter'),
      warn('gas', 'Gas shortage: gas power stations falter'),
    ].filter(Boolean).join('');
    return `<section class="energy">
      <span class="label">ELECTRICITY AND SUPPLY CHAINS</span>
      <div class="energy-bar" role="img" aria-label="Electricity supply ${Math.round(cover * 100)}% of demand">
        <i style="width:${Math.min(100, (en.grid / Math.max(1, en.demand)) * 100 / Math.max(1, cover))}%" class="grid"></i><i style="width:${Math.min(100, (en.plants / Math.max(1, en.demand)) * 100 / Math.max(1, cover))}%" class="plants"></i>
      </div>
      <p class="hint">Supply ${Math.round(cover * 100)}% of demand · national grid ${Math.round((en.grid / Math.max(1, en.demand)) * 100)}% · power stations ${Math.round((en.plants / Math.max(1, en.demand)) * 100)}%. Demand grows with the economy; the grid alone grows more slowly (faster with infrastructure spending). Armed forces burn ${en.militaryOil}bn barrels of oil a year.</p>
      ${problems ? `<ul class="supply-warnings">${problems}</ul>` : '<p class="hint up">All supply chains running.</p>'}
    </section>
    ${this.migrationHtml(e)}`;
  }

  /** Refugees: who takes them in is a choice with costs now and gains later. */
  private migrationHtml(e: EconomyPrivate) {
    const open = this.game.mine?.openBorders !== false;
    const m = e.migration ?? { refugeesIn: 0, refugeesOut: 0 };
    const people = (x: number) => x >= 1e6 ? `${(x / 1e6).toFixed(1)} m` : `${Math.round(x / 1e3)}k`;
    return `<section class="energy">
      <span class="label">BORDERS AND REFUGEES</span>
      <p class="hint">Last year: ${people(m.refugeesIn)} refugees arrived, ${people(m.refugeesOut)} fled abroad. War and occupation drive people to neighbours with open borders. Taking them in costs money and some stability now; they join the workforce and add to growth.</p>
      <div class="seg" role="group" aria-label="Border policy">
        <button type="button" data-borders="open" aria-pressed="${open}">Open borders</button>
        <button type="button" data-borders="closed" aria-pressed="${!open}">Closed borders</button>
      </div>
    </section>`;
  }

  private nationHtml(e: EconomyPrivate, tax: number) {
    const hist = e.history;
    const series = (k: keyof HistoryPoint) => hist.map((h) => h[k] as number);
    const balance = e.revenue - e.spending;
    return `
      <div class="econ-kpis">
        <div><span>GDP</span><b>${money(e.gdp)}</b><em class="${e.growth >= 0 ? 'up' : 'down'}">${pct(e.growth)} a year</em></div>
        <div><span>Per person</span><b>$${e.gdppc.toLocaleString('en-US')}</b><em>${people(e.pop)} people</em></div>
        <div><span>Treasury</span><b class="${e.treasury < 0 ? 'down' : ''}">${money(e.treasury)}</b><em class="${balance >= 0 ? 'up' : 'down'}">${balance >= 0 ? 'surplus' : 'deficit'} ${money(Math.abs(balance))}/yr</em></div>
        <div><span>Stability</span><b class="${e.stability < 40 ? 'down' : ''}">${e.stability.toFixed(0)}%</b><em>${e.shortage > 0.02 ? `<span class="down">shortages ${(e.shortage * 100).toFixed(0)}%</span>` : 'no shortages'}</em></div>
      </div>
      ${this.energyHtml(e)}
      <div class="econ-charts">
        <figure><figcaption>GDP</figcaption>${spark(series('gdp'), 'c-gdp', 'GDP, weekly, last five game years')}</figure>
        <figure><figcaption>Treasury</figcaption>${spark(series('treasury'), 'c-treasury', 'Treasury, weekly, last five game years')}</figure>
        <figure><figcaption>Stability</figcaption>${spark(series('stability'), 'c-stability', 'Stability, weekly, last five game years')}</figure>
      </div>

      <div class="econ-cols">
        <section>
          <span class="label">TAXES AND SPENDING</span>
          <div class="slider">
            <label for="econTax"><span>TAX RATE · revenue ${money(e.revenue)}/yr</span><output id="econTaxOut">${tax}%</output></label>
            <input id="econTax" type="range" min="${LIMITS.taxMin}" max="${LIMITS.taxMax}" value="${tax}">
          </div>
          <p class="hint">Government spends ${money(e.spending)} a year (24% of GDP). Taxes above that pay down debt; below it, borrow. Taxes over 25% slow growth and cost stability.</p>
          ${BUDGET_KEYS.map((k) => `
            <div class="slider budget">
              <label for="b-${k}" title="${BUDGET_NAMES[k][1]}"><span>${BUDGET_NAMES[k][0].toUpperCase()}</span><output data-budget-out="${k}">${this.shareText(e, e.budget[k])}</output></label>
              <input id="b-${k}" type="range" min="0" max="70" value="${e.budget[k]}" data-budget="${k}">
            </div>`).join('')}
          <div class="kv mono">
            <span>Infrastructure</span><span>${(e.infra * 100).toFixed(0)}% of need</span>
            <span>Research banked</span><span>${Math.round(e.research).toLocaleString('en-US')} pts</span>
            <span>Defence budget</span><span>${money(e.defence)}/yr</span>
            <span>Munitions</span><span>${e.munitions}% of reserve</span>
            <span>Reservists</span><span>${people(e.reservists)}</span>
          </div>
        </section>
        <section>
          <span class="label">GOODS · PER YEAR</span>
          <div class="table-wrap"><table class="goods">
            <thead><tr><th scope="col">Good</th><th scope="col">Output</th><th scope="col">Use</th><th scope="col">Trade</th><th scope="col">Stock</th></tr></thead>
            <tbody>${COMMODITIES.map((c) => this.goodRow(c, e)).join('')}</tbody>
          </table></div>
          <p class="hint">Surpluses are sold and shortfalls bought on the world market each day. Unmet need causes shortages, which hurt growth and stability.</p>
        </section>
      </div>`;
  }

  private goodRow(c: Commodity, e: EconomyPrivate) {
    const g = e.goods[c], u = COMMODITY_INFO[c].unit;
    const days = g.use > 0 ? Math.round((g.stock / g.use) * 365) : 0;
    const trade = Math.abs(g.trade) < 1e-6 ? '—' : `<span class="${g.trade > 0 ? 'up' : 'down'}">${g.trade > 0 ? 'exports' : 'imports'} ${qty(Math.abs(g.trade), u)}</span>`;
    return `<tr${g.short > 0.01 ? ' class="short"' : ''}>
      <th scope="row">${COMMODITY_INFO[c].name}${g.short > 0.01 ? ` <span class="pill">short ${(g.short * 100).toFixed(0)}%</span>` : ''}</th>
      <td>${qty(g.prod, u)}</td><td>${qty(g.use, u)}</td><td>${trade}</td><td>${days} days</td></tr>`;
  }

  /** What is happening to everyone: the current global event and the climate. */
  private worldHtml() {
    const w = this.game.world;
    if (!w) return '';
    const day = this.game.market?.day ?? 0;
    return `<div class="world-state">
      ${w.event ? `<p class="down"><b>${esc(w.event.text)}</b> ${Math.max(0, w.event.until - day)} days left.</p>` : ''}
      <p class="hint">Climate: ${w.warming.toFixed(2)} °C warmer than in 2026, driven by the coal and gas the world burns.${w.warming > 0.15 ? ' Low-lying coasts are losing people to the sea; farmland is moving toward the poles.' : ' Above 0.15 °C, low coasts start to flood.'}</p>
    </div>`;
  }

  private marketHtml() {
    const m = this.game.market;
    if (!m) return '';
    return `
      <section class="market">
        <span class="label">WORLD MARKET · DAY ${m.day}</span>
        ${this.worldHtml()}
        <div class="market-grid">
          ${COMMODITIES.map((c) => {
            const info = COMMODITY_INFO[c];
            const rel = m.prices[c] / info.basePrice - 1;
            // prices are $bn per stock unit (Mt, Mbbl, bcm, kt); ×1000 gives $/t, $/bbl, $/1000 m³ and $k/t
            const per = m.prices[c] * 1000;
            const label = c === 'oil' ? `$${per.toFixed(1)}/bbl` : c === 'gas' ? `$${per.toFixed(0)}/1000 m³` : c === 'rare_earths' ? `$${per.toFixed(1)}k/t` : `$${per.toFixed(0)}/t`;
            return `<div class="price">
              <span>${info.name}</span><b class="mono">${label}</b>
              <em class="mono ${rel > 0.005 ? 'up-price' : rel < -0.005 ? 'down-price' : ''}">${pct(rel)} since day 0</em>
              ${spark(m.history.map((h) => h.p[c]), 'c-price', `${info.name} price`)}
            </div>`;
          }).join('')}
        </div>
      </section>`;
  }

  private leagueHtml() {
    const rows = [...this.game.economy.values()].sort((a, b) => b.gdp - a.gdp).slice(0, 10);
    if (!rows.length) return '';
    const mine = this.game.mine?.id;
    return `
      <section>
        <span class="label">LARGEST ECONOMIES</span>
        <div class="table-wrap"><table class="league">
          <thead><tr><th scope="col">#</th><th scope="col">Nation</th><th scope="col">GDP</th><th scope="col">Growth</th><th scope="col">Per person</th><th scope="col">Led by</th></tr></thead>
          <tbody>${rows.map((r, i) => {
            const n = this.pol.nations.get(r.id);
            const live = this.game.nations.get(r.id);
            return `<tr${r.id === mine ? ' class="you"' : ''}>
              <td>${i + 1}</td>
              <th scope="row"><button type="button" class="link" data-goto="${r.id}"><i style="background:${n?.color}"></i>${esc(n?.short ?? String(r.id))}</button></th>
              <td>${money(r.gdp)}</td><td class="${r.growth >= 0 ? 'up' : 'down'}">${pct(r.growth)}</td>
              <td>$${r.gdppc.toLocaleString('en-US')}</td><td>${live?.controller === 'human' ? esc(live.player ?? 'player') : 'AI'}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>`;
  }
}
