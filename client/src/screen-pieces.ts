// The working centrepiece of each Orbital screen. Each one draws from the game,
// and its clicks drive the window's own controls (so the rules stay in one place).
import type { Game } from './game';
import type { Political } from './political';
import { proxy, reveal, type Piece } from './screens';
import { BUDGET_KEYS, COMMODITIES, COMMODITY_INFO, money, type Budget } from '../../shared/economy';
import { UNIT_SPECS, UNIT_TYPES, type Domain, type UnitType } from '../../shared/military';
import { BRANCHES, BRANCH_NAMES, TECHS, TIER_COST, prerequisite } from '../../shared/research';
import { CHAMBER, blocsFor, chamberLegend, chamberSvg } from './chamber';
import { threatStackHtml } from './threat-stack';
import { MAX_SPY_OPS } from '../../shared/diplomacy';
import type { HoloGlobe } from './holo-globe';
import { priceLabel } from './market-panel';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const D = Math.PI / 180;
const pt = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a * D), cy + r * Math.sin(a * D)] as const;
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};

function base(cls: string) {
  const el = document.createElement('div');
  el.className = `piece ${cls}`;
  return el;
}

/** A row of glowing 3D columns on a glass plate (forces and rankings). */
function columns(items: { key: string; label: string; value: string; h: number; cls?: string; attrs?: string }[], cols: number) {
  const size = 52, gap = 22, rows = Math.ceil(items.length / cols);
  const w = cols * size + (cols - 1) * gap + 40, d = rows * size + (rows - 1) * gap + 40;
  return `<div class="col-scene"><div class="col-rig" style="width:${w}px;height:${d}px;margin:${-d / 2}px 0 0 ${-w / 2}px">
    ${items.map((it, i) => `<button type="button" class="col ${it.cls ?? ''}" style="left:${20 + (i % cols) * (size + gap)}px;top:${20 + Math.floor(i / cols) * (size + gap)}px" ${it.attrs ?? ''} data-key="${it.key}" aria-label="${esc(it.label)}: ${esc(it.value)}">
      <i class="col-foot"></i>${Array.from({ length: Math.floor(Math.max(4, it.h) / 7) }, (_, k) => `<i class="col-slice" style="transform:translateZ(${(k * 7).toFixed(0)}px)"></i>`).join('')}<b class="col-top" style="transform:translateZ(${Math.max(4, it.h).toFixed(0)}px)">${esc(it.value)}</b></button>`).join('')}
  </div></div>
  <div class="chips col-legend">${items.map((it) => `<button type="button" class="chip col-chip ${it.cls ?? ''}" data-key="${it.key}" ${it.attrs ?? ''}>${esc(it.label)} <b>${esc(it.value)}</b></button>`).join('')}</div>`;
}

// ---------------- Economy: the budget ring ----------------
export function economyPiece(game: Game): Piece {
  const el = base('econ-piece');
  let win: HTMLElement | undefined;
  let pick: keyof Budget = 'military';
  const COL: Record<keyof Budget, string> = { military: '#ff5caa', infrastructure: '#7cc4ff', welfare: '#6af0c0', research: '#b59cff' };
  const NAME: Record<keyof Budget, string> = { military: 'Military', infrastructure: 'Infrastructure', welfare: 'Welfare', research: 'Research' };
  const nudge = (sel: string, by: number, max: number) => {
    const input = win?.querySelector<HTMLInputElement>(sel);
    if (!input) return;
    input.value = String(Math.max(Number(input.min || 0), Math.min(max, Number(input.value) + by)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    draw();
  };
  el.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-ep]');
    if (!t || !win) return;
    const a = t.dataset.ep;
    if (a === 'pick') { pick = t.dataset.key as keyof Budget; draw(); }
    else if (a === 'more') nudge(`input[data-budget="${pick}"]`, 5, 70);
    else if (a === 'less') nudge(`input[data-budget="${pick}"]`, -5, 70);
    else if (a === 'taxup') nudge('#econTax', 1, 60);
    else if (a === 'taxdown') nudge('#econTax', -1, 60);
  });
  const draw = () => {
    const e = game.mine?.econ;
    if (!e) { el.innerHTML = '<p class="hint">Take command of a nation to run its economy.</p>'; return; }
    // read live slider values (they move before the server answers)
    const share = (k: keyof Budget) => Number(win?.querySelector<HTMLInputElement>(`input[data-budget="${k}"]`)?.value ?? e.budget[k]);
    const total = BUDGET_KEYS.reduce((s, k) => s + share(k), 0) || 1;
    let a = -90;
    const segs = BUDGET_KEYS.map((k) => {
      const span = (share(k) / total) * 360;
      const a0 = a + 1.5, a1 = a + Math.max(2, span) - 1.5;
      a += span;
      return `<path d="${arc(200, 200, 150, a0, a1)}" class="seg${k === pick ? ' on' : ''}" stroke="${COL[k]}" data-ep="pick" data-key="${k}"><title>${NAME[k]} ${Math.round((share(k) / total) * 100)}%</title></path>`;
    }).join('');
    const tax = Number(win?.querySelector<HTMLInputElement>('#econTax')?.value ?? game.mine?.tax ?? 0);
    const bal = e.revenue - e.spending;
    el.innerHTML = `<svg viewBox="0 0 400 400" class="ring" role="img" aria-label="Budget ring: click a part to choose it, then change its share">
        <circle cx="200" cy="200" r="150" class="track"></circle>${segs}
        <path d="${arc(200, 200, 118, -90, -90 + Math.max(1, tax) * 6)}" class="tax"></path><circle cx="200" cy="200" r="118" class="track thin"></circle>
        <text x="200" y="168" class="k">TREASURY</text>
        <text x="200" y="204" class="v${e.treasury < 0 ? ' bad' : ''}">${money(e.treasury)}</text>
        <text x="200" y="230" class="s ${bal < 0 ? 'bad' : 'good'}">${bal < 0 ? '−' : '+'}${money(Math.abs(bal))} a year</text>
        <text x="200" y="258" class="k">TAX ${tax}%</text>
      </svg>
      <div class="piece-bar">
        <div class="chips">${BUDGET_KEYS.map((k) => `<button type="button" class="chip${k === pick ? ' on' : ''}" data-ep="pick" data-key="${k}"><i style="background:${COL[k]}"></i>${NAME[k]} <b>${Math.round((share(k) / total) * 100)}%</b></button>`).join('')}</div>
        <div class="steps"><span>${NAME[pick]}</span><button type="button" class="claim" data-ep="less" aria-label="Less ${NAME[pick]}">−</button><button type="button" class="claim" data-ep="more" aria-label="More ${NAME[pick]}">+</button>
          <span>Tax</span><button type="button" class="claim" data-ep="taxdown" aria-label="Lower tax">−</button><button type="button" class="claim" data-ep="taxup" aria-label="Raise tax">+</button></div>
      </div>`;
  };
  return { el, caption: 'Pick a part of the budget, then change its share. The inner arc is your tax rate.', update(w) { win = w; draw(); } };
}

// ---------------- Market: a ring of stock tickers ----------------
/** A stock-style area chart: line, shaded area, a dashed line at the first value, a dot on the last. */
function spark(values: number[], w: number, h: number, tone: 'up' | 'down', big = false) {
  if (values.length < 2) values = [values[0] ?? 0, values[0] ?? 0];
  const lo0 = Math.min(...values), hi0 = Math.max(...values), mid = (lo0 + hi0) / 2, span = Math.max(hi0 - lo0, Math.abs(mid) * 0.04) || 1, lo = mid - span / 2;
  const pad = big ? 10 : 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(values.length - 1).toFixed(1)} ${h}L${x(0).toFixed(1)} ${h}Z`;
  const grid = big ? [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" class="sg"></line>`).join('') : '';
  const last = values[values.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" class="spark ${tone}" preserveAspectRatio="none" aria-hidden="true">${grid}
    <line x1="0" x2="${w}" y1="${y(values[0]).toFixed(1)}" y2="${y(values[0]).toFixed(1)}" class="open"></line>
    <path d="${area}" class="fill"></path><path d="${line}" class="ln"></path>
    <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="${big ? 4 : 2.5}" class="dot"></circle></svg>`;
}

export function marketPiece(game: Game): Piece {
  const el = base('market-piece');
  let win: HTMLElement | undefined;
  el.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-good]');
    if (t && win) proxy(win, `[data-mk="pick"][data-good="${t.dataset.good}"]`);
  });
  return {
    el, caption: 'Green: you make enough or export. Red: you are short or importing. Lines are world prices, week by week; click a ticker to chart it in the middle.',
    update(w) {
      win = w;
      const e = game.mine?.econ, m = game.market;
      const picked = w.querySelector<HTMLElement>('.picked[data-good]')?.dataset.good ?? 'food';
      type Tick = { key: string; name: string; price: string; change: number; series: number[]; tone: 'up' | 'down'; trade: string };
      const ticks: Tick[] = COMMODITIES.map((c) => {
        const series = (m?.history ?? []).slice(-26).map((h) => h.p[c]).filter((v) => v !== undefined);
        if (m) series.push(m.prices[c]);
        const prev = series.length > 1 ? series[series.length - 2] : series[0] ?? 0;
        const now = series[series.length - 1] ?? 0;
        const g = e?.goods[c];
        const short = g ? g.trade < 0 || g.short > 0.005 : false;
        return {
          key: c, name: COMMODITY_INFO[c].name, price: m ? priceLabel(c, m.prices[c]) : '—', change: prev ? (now - prev) / prev : 0, series,
          tone: short ? 'down' : 'up', trade: g ? (g.trade < 0 ? `imports ${Math.round((-g.trade / Math.max(g.use, 1e-9)) * 100)}% of use` : g.trade > 0 ? `exports ${Math.round((g.trade / Math.max(g.prod, 1e-9)) * 100)}% of output` : 'self-sufficient') : '',
        };
      });
      if (e) {
        const hist = (e.history ?? []).filter((h) => h.e).slice(-26).map((h) => h.e![1] / Math.max(h.e![0], 1e-9));
        hist.push(e.energy.supply / Math.max(e.energy.demand, 1e-9));
        const prev = hist.length > 1 ? hist[hist.length - 2] : hist[0];
        ticks.push({ key: 'power', name: 'Electricity', price: `${Math.round(hist[hist.length - 1] * 100)}%`, change: prev ? hist[hist.length - 1] / prev - 1 : 0, series: hist,
          tone: e.energy.supply >= e.energy.demand ? 'up' : 'down', trade: e.energy.supply >= e.energy.demand ? 'supply covers demand' : 'blackouts' });
      }
      const n = ticks.length;
      const cards = ticks.map((t, i) => {
        const a = -90 + (i / n) * 360;
        const cx = Math.cos(a * D), cy = Math.sin(a * D);
        const ch = `${t.change >= 0 ? '▲' : '▼'} ${Math.abs(t.change * 100).toFixed(1)}%`;
        return `<button type="button" class="tick ${t.tone}${t.key === picked ? ' on' : ''}" data-good="${t.key}" style="left:calc(50% + ${cx.toFixed(4)} * (50% - var(--tk-in)));top:calc(50% + ${cy.toFixed(4)} * (50% - var(--tk-in)))" aria-label="${esc(t.name)} ${esc(t.price)}, ${esc(t.trade)}">
          <span class="tk-head"><b>${esc(t.name)}</b><em class="${t.change >= 0 ? 'chg-up' : 'chg-down'}">${ch}</em></span>
          ${spark(t.series, 120, 34, t.tone)}<span class="tk-price mono">${esc(t.price)}</span></button>`;
      }).join('');
      const p = ticks.find((t) => t.key === picked) ?? ticks[0];
      el.innerHTML = `<div class="mk-ring">
          <i class="mk-orbit" aria-hidden="true"></i>
          ${cards}
          <div class="mk-core ${p.tone}"><span class="k2">${esc(p.name.toUpperCase())}</span><b class="mono">${esc(p.price)}</b>
            <em class="${p.change >= 0 ? 'chg-up' : 'chg-down'}">${p.change >= 0 ? '▲' : '▼'} ${Math.abs(p.change * 100).toFixed(2)}% this week</em>
            ${spark(p.series, 220, 92, p.tone, true)}<span class="mono tk-trade">${esc(p.trade)}</span></div>
        </div>`;
    },
  };
}

// ---------------- Forces: the order of battle ----------------
export function forcesPiece(game: Game, view: () => Domain): Piece {
  const el = base('forces-piece');
  let win: HTMLElement | undefined;
  el.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('.col, .col-chip');
    if (t && win) proxy(win, `[data-f="recruit"][data-type="${t.dataset.key}"]`);
  });
  return {
    el, caption: 'Each column is one type of formation (+ those in training). Click a column or its name to recruit one more.',
    update(w) {
      win = w;
      const me = game.mine?.id;
      const mil = game.mine?.mil;
      const types = UNIT_TYPES.filter((t) => UNIT_SPECS[t].domain === view());
      const own = game.units.filter((u) => u.nation === me);
      const count = (t: UnitType) => own.filter((u) => u.type === t).length;
      const queued = (t: UnitType) => (mil?.queue ?? []).filter((q) => q.type === t).length;
      const max = Math.max(1, ...types.map((t) => count(t) + queued(t)));
      const can = (t: UnitType) => !!w.querySelector(`[data-f="recruit"][data-type="${t}"]:not(:disabled)`);
      el.innerHTML = columns(types.map((t) => ({
        key: t, label: UNIT_SPECS[t].name.replace(/ (division|group|wing|fleet)$/i, ''),
        value: `${count(t)}${queued(t) ? `+${queued(t)}` : ''}`,
        h: ((count(t) + queued(t)) / max) * 120, cls: can(t) ? '' : 'locked',
      })), Math.min(4, types.length)) + `<div class="piece-bar"><span class="mono">${own.filter((u) => UNIT_SPECS[u.type].domain === view()).length} formations · ${(mil?.queue ?? []).length} in training</span></div>`;
    },
  };
}

// ---------------- Diplomacy: the live globe ----------------
export function diplomacyPiece(globe: HoloGlobe, focused: () => number | null): Piece {
  const el = base('globe-piece');
  return {
    el,
    update() { globe.mount(el); globe.lookAt(focused() ?? undefined); },
  };
}

// ---------------- Espionage: the threat stack ----------------
export function espionagePiece(game: Game, pol: Political): Piece {
  const el = base('spy-piece');
  return {
    el, caption: 'Networks abroad, operations under way, and the threat at home.',
    update() {
      const mine = game.mine;
      if (!mine) { el.innerHTML = ''; return; }
      const spy = mine.spy ?? { nets: {}, building: [], counter: 0, foreign: 0 };
      const nets = Object.entries(spy.nets).map(([k, v]) => [Number(k), v] as [number, number]);
      for (const b of spy.building) if (!nets.some(([k]) => k === b)) nets.push([b, 0]);
      nets.sort((a, b) => b[1] - a[1]);
      el.innerHTML = threatStackHtml({ nets, building: spy.building, ops: mine.spyOps ?? 0, maxOps: MAX_SPY_OPS, counter: spy.counter, foreign: spy.foreign, name: (id) => pol.nations.get(id)?.name ?? `Nation ${id}` });
    },
  };
}

// ---------------- Politics: the chamber ----------------
export function politicsPiece(game: Game, pol: Political): Piece {
  const el = base('chamber-piece');
  let win: HTMLElement | undefined;
  el.addEventListener('click', (e) => {
    if (!win) return;
    if ((e.target as Element).closest('[data-pp="campaign"]')) proxy(win, '[data-pl="campaign"]');
    else reveal(win, '.parties, .party-row');
  });
  return {
    el, caption: 'Your chamber, one light per seat. Click it for the parties.',
    update(w) {
      win = w;
      const me = game.mine?.id;
      const pub = me !== undefined ? game.nations.get(me) : undefined;
      const n = me !== undefined ? pol.nations.get(me) : undefined;
      if (!pub?.government || !n) { el.innerHTML = '<p class="hint">Take command of a nation to lead its politics.</p>'; return; }
      const blocs = blocsFor(pub.government, pub.parties, n.color ?? '#8a8f96');
      const camp = w.querySelector<HTMLButtonElement>('[data-pl="campaign"]');
      el.innerHTML = `<div class="chamber-big">${chamberSvg(pub.government, blocs, '#7cc4ff')}</div>
        <div class="piece-bar"><b class="gov-name">${esc(CHAMBER[pub.government].name)}</b>${chamberLegend(pub.government, blocs)}
        ${camp ? `<button type="button" class="claim${camp.disabled ? '' : ' primary'}" data-pp="campaign" ${camp.disabled ? 'disabled' : ''}>Campaign</button>` : ''}</div>`;
    },
  };
}

// ---------------- R&D: the research orbit ----------------
export function researchPiece(game: Game): Piece {
  const el = base('research-piece');
  let win: HTMLElement | undefined;
  let pick: string | undefined;
  el.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-rt], [data-ra]');
    if (!t || !win) return;
    if (t.dataset.rt) { pick = t.dataset.rt; this_update(); return; }
    if (t.dataset.ra === 'now') proxy(win, `[data-r="tech"][data-tech="${pick}"]`);
    if (t.dataset.ra === 'queue') proxy(win, `[data-r="queue"][data-tech="${pick}"]`);
    if (t.dataset.ra === 'show') reveal(win, `[data-tech="${pick}"]`);
  });
  let this_update = () => {};
  return {
    el, caption: 'Rings are tiers, quarters are branches. Pick a technology to research it now or queue it.',
    update(w) {
      win = w;
      this_update = () => this.update(w);
      const r = game.mine?.research;
      if (!r) { el.innerHTML = '<p class="hint">Take command of a nation to direct its research.</p>'; return; }
      const done = new Set<string>(r.done), queue: string[] = r.queue ?? [];
      const tiers = Math.max(...TECHS.map((t) => t.tier));
      const radius = (tier: number) => 70 + (tier - 1) * (115 / Math.max(1, tiers - 1));
      const pos = new Map<string, readonly [number, number]>();
      BRANCHES.forEach((b, bi) => {
        for (let tier = 1; tier <= tiers; tier++) {
          const ts = TECHS.filter((t) => t.branch === b && t.tier === tier);
          ts.forEach((t, i) => { pos.set(t.id, pt(200, 200, radius(tier), -135 + bi * 90 + ((i + 1) / (ts.length + 1) - 0.5) * 70)); });
        }
      });
      const state = (id: string) => {
        if (done.has(id)) return 'done';
        if ((r.current as string | undefined) === id) return 'current';
        if (queue.includes(id)) return 'queued';
        const t = TECHS.find((x) => x.id === id)!, pre = prerequisite(t);
        return !pre || done.has(pre.id) ? 'open' : 'locked';
      };
      const links = TECHS.map((t) => { const p = prerequisite(t); if (!p) return ''; const [a, b] = [pos.get(p.id)!, pos.get(t.id)!]; return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" class="lk ${done.has(p.id) ? 'lit' : ''}"></line>`; }).join('');
      const nodes = TECHS.map((t) => {
        const [x, y] = pos.get(t.id)!, s = state(t.id);
        const q = queue.indexOf(t.id);
        return `<g class="tn ${s}${pick === t.id ? ' on' : ''}" data-rt="${t.id}" role="button" tabindex="0" aria-label="${esc(t.name)}: ${s}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${pick === t.id ? 11 : 8}"></circle>${q >= 0 ? `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" class="qn">${q + 1}</text>` : ''}<title>${esc(t.name)}</title></g>`;
      }).join('');
      const sectors = BRANCHES.map((b, bi) => { const [x, y] = pt(200, 200, 198, -135 + bi * 90); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="br">${esc(BRANCH_NAMES[b].toUpperCase())}</text>`; }).join('');
      const cur = r.current ? TECHS.find((t) => t.id === r.current) : undefined;
      const prog = cur ? Math.min(1, r.progress / TIER_COST[cur.tier as keyof typeof TIER_COST]) : 0;
      const sel = pick ? TECHS.find((t) => t.id === pick) : undefined;
      const ss = sel ? state(sel.id) : '';
      el.innerHTML = `<svg viewBox="-10 -10 420 420" class="orbit" role="img" aria-label="Research orbit">
          ${Array.from({ length: tiers }, (_, i) => `<circle cx="200" cy="200" r="${radius(i + 1)}" class="track thin"></circle>`).join('')}
          <line x1="200" y1="0" x2="200" y2="400" class="axis"></line><line x1="0" y1="200" x2="400" y2="200" class="axis"></line>
          ${links}${nodes}${sectors}
          <circle cx="200" cy="200" r="50" class="core"></circle>
          ${cur ? `<path d="${arc(200, 200, 50, -90, -90 + Math.max(1, prog * 359.9))}" class="prog"></path>` : ''}
          <text x="200" y="196" class="k tiny">${cur ? 'RESEARCHING' : 'IDLE'}</text><text x="200" y="216" class="v small">${cur ? `${Math.round(prog * 100)}%` : '—'}</text>
        </svg>
        <div class="piece-bar">${sel ? `<b>${esc(sel.name)}</b><span class="mono">${esc(sel.text)}</span>
          ${ss === 'done' ? '<span class="pill ok">researched</span>' : ss === 'current' ? '<span class="pill ok">researching</span>' : `<button type="button" class="claim primary" data-ra="now">Research now</button><button type="button" class="claim" data-ra="queue">Queue</button>`}
          <button type="button" class="link" data-ra="show">Details</button>` : `<span class="mono">${cur ? esc(cur.name) : 'Nothing under research'} · ${done.size} of ${TECHS.length} done · ${queue.length} queued</span>`}</div>`;
    },
  };
}

// ---------------- Rankings: the skyline ----------------
export function rankingsPiece(game: Game, pol: Political): Piece {
  const el = base('rank-piece');
  return {
    el, caption: 'The ten largest economies, your nation lit. Click one to open Diplomacy with it.',
    update() {
      const me = game.mine?.id;
      const list = [...game.economy.values()].filter((e) => pol.nations.has(e.id) && !game.nations.get(e.id)?.annexedBy).sort((a, b) => b.gdp - a.gdp);
      const top = list.slice(0, 10);
      const myRank = list.findIndex((e) => e.id === me);
      if (me !== undefined && myRank >= 10) top[9] = list[myRank];
      const max = Math.max(1, ...top.map((e) => e.gdp));
      el.innerHTML = columns(top.map((e) => ({
        key: String(e.id), label: `${list.indexOf(e) + 1}. ${pol.nations.get(e.id)?.short ?? pol.nations.get(e.id)?.name ?? ''}`,
        value: money(e.gdp), h: (e.gdp / max) * 140, cls: e.id === me ? 'mine' : '', attrs: e.id === me ? '' : `data-go="diplo:${e.id}"`,
      })), 5) + `<div class="piece-bar"><span class="mono">${me !== undefined && myRank >= 0 ? `You are #${myRank + 1} of ${list.length} by GDP` : `${list.length} nations`}</span></div>`;
    },
  };
}

// ---------------- Records: the timeline ----------------
export function recordsPiece(game: Game, pol: Political): Piece {
  const el = base('records-piece');
  return {
    el, caption: 'The latest from around the world. Click an entry to open that nation.',
    update() {
      const ev = game.events.slice(-9).reverse();
      const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      el.innerHTML = ev.length ? `<ol class="timeline">${ev.map((e) => `<li class="tl-${e.kind}">
          <button type="button" ${e.nation !== undefined && pol.nations.has(e.nation) ? `data-go="diplo:${e.nation}"` : 'disabled'}>
          <time class="mono">${date(e.at)}</time><span>${esc(e.text)}</span></button></li>`).join('')}</ol>`
        : '<p class="hint">Nothing has happened yet. Events appear here as the world moves.</p>';
    },
  };
}
