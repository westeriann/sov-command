// The Diplomacy window: proposals waiting for an answer, treaties in force, and peace terms.
import {
  CONTRACT_YEARS, ENVOY_COST, ENVOY_DAYS, MAX_BLOC, MAX_CONTRACTS, MAX_ENVOYS, PACTS, PACT_INFO, RESOLUTION_TEXT, TRADE_DEAL_GROWTH, VOTE_DAYS, dealText, opinionWord,
  type Deal, type DealKind, type Pact, type ResolutionKind,
} from '../../shared/diplomacy';
import { COMMODITIES, COMMODITY_INFO, type Commodity } from '../../shared/economy';
import { attr, tip } from './tooltip';
import { GOVERNMENT_INFO } from '../../shared/research';
import { CHAMBER, blocsFor, chamberLegend, chamberSvg } from './chamber';
import type { Order } from '../../shared/protocol';
import type { Game } from './game';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';

export interface DiplomacyActions {
  propose(target: number, deal: Deal): void;
  answer(from: number, deal: DealKind, accept: boolean): void;
  cancel(target: number, pact: Pact): void;
  goToNation(id: number): void;
  order(o: Order): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class DiplomacyPanel {
  private panel: HTMLElement;
  private focused: number | null = null; // the nation whose page is open
  private tab: 'overview' | 'nations' = 'overview';

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: DiplomacyActions) {
    this.panel = document.createElement('section');
    this.panel.className = 'panel econ-window diplo-window';
    keepScrollOn(this.panel); // redraws keep your place in the list
    this.panel.setAttribute('aria-label', 'Diplomacy');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    // a sensible amount for the chosen good: a tenth of what we use in a year
    this.panel.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.id !== 'ctGood') return;
      const use = this.game.mine?.econ?.goods[t.value as Commodity]?.use ?? 0;
      const amt = this.panel.querySelector<HTMLInputElement>('#ctAmount');
      if (amt && use > 0) amt.value = (use * 0.1).toFixed(2);
    });
    game.on((c) => {
      if (!(c.has('mine') || c.has('war') || c.has('nations')) || !this.isOpen) return;
      if (document.activeElement?.matches('input, select') && this.panel.contains(document.activeElement)) return; // don't wipe what is being typed
      this.render();
    });
  }

  get isOpen() { return !this.panel.hidden; }
  toggle() { this.panel.hidden = !this.panel.hidden; if (this.isOpen) this.render(); }
  /** Open on one nation's page: what they think of us, and everything we can do with them. */
  focus(id: number) {
    if (!this.pol.nations.has(id) || id === this.game.mine?.id) { this.focused = null; this.tab = 'nations'; }
    else this.focused = id;
    this.panel.hidden = false; this.render();
    this.panel.scrollTop = 0;
  }
  close() { this.panel.hidden = true; }

  private onClick(e: Event) {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
    if (!act) return;
    const d = act.dataset.d, id = Number(act.dataset.nation);
    if (d === 'close') { this.close(); document.dispatchEvent(new CustomEvent('diplomacy-closed')); }
    else if (d === 'accept' || d === 'decline') this.actions.answer(id, act.dataset.kind as DealKind, d === 'accept');
    else if (d === 'cancel') this.actions.cancel(id, act.dataset.pact as Pact);
    else if (d === 'white' || d === 'cede' || d === 'puppet') this.actions.propose(id, { kind: 'peace', terms: d });
    else if (d === 'bloc-create') {
      const name = (this.panel.querySelector('#blocName') as HTMLInputElement | null)?.value ?? '';
      this.actions.order({ kind: 'bloc_create', name });
    } else if (d === 'bloc-leave') this.actions.order({ kind: 'bloc_leave' });
    else if (d === 'vote') this.actions.order({ kind: 'vote', id: Number(act.dataset.id), yes: act.dataset.yes === '1' });
    else if (d === 'release') this.actions.order({ kind: 'release', target: id });
    else if (d === 'table') {
      const kind = (this.panel.querySelector('#resKind') as HTMLSelectElement).value as ResolutionKind;
      const target = Number((this.panel.querySelector('#resTarget') as HTMLSelectElement).value);
      const t2 = (this.panel.querySelector('#resTarget2') as HTMLSelectElement).value;
      this.actions.order({ kind: 'resolution', resolution: kind, target, target2: t2 ? Number(t2) : undefined });
    }
    else if (d === 'goto') this.actions.goToNation(id);
    else if (d === 'page') this.focus(id);
    else if (d === 'back') { this.focused = null; this.render(); }
    else if (d === 'tab') { this.tab = act.dataset.tab as 'overview' | 'nations'; this.focused = null; this.render(); }
    else if (d === 'pact') this.actions.propose(id, { kind: act.dataset.pact as Pact } as Deal);
    else if (d === 'endpact') {
      if (act.dataset.confirm === '1') this.actions.cancel(id, act.dataset.pact as Pact);
      else { act.dataset.confirm = '1'; act.textContent = 'Confirm: end it'; }
    }
    else if (d === 'contract') {
      const v = (sel: string) => (this.panel.querySelector(sel) as HTMLInputElement | HTMLSelectElement).value;
      this.actions.propose(id, { kind: 'contract', good: v('#ctGood') as Commodity, amount: Number(v('#ctAmount')), years: Number(v('#ctYears')), sell: v('#ctDir') === 'sell' });
    }
    else if (d === 'gift') this.actions.propose(id, { kind: 'gift', amount: Number((this.panel.querySelector('#giftAmount') as HTMLInputElement).value) });
    else if (d === 'tribute') this.actions.propose(id, { kind: 'demand', tribute: Number((this.panel.querySelector('#tribAmount') as HTMLInputElement).value) });
    else if (d === 'demandprov') this.actions.propose(id, { kind: 'demand', province: Number((this.panel.querySelector('#demProv') as HTMLSelectElement).value) });
    else if (d === 'envoy') this.actions.order({ kind: 'envoy', target: id });
    else if (d === 'denounce') {
      if (act.dataset.confirm === '1') this.actions.order({ kind: 'denounce', target: id });
      else { act.dataset.confirm = '1'; act.textContent = 'Confirm: denounce'; }
    }
    else if (d === 'embargo') this.actions.order({ kind: 'embargo', target: id, on: act.dataset.on === '1' });
    else if (d === 'endcontract') this.actions.order({ kind: 'end_contract', id: Number(act.dataset.id) });
    else if (d === 'war') {
      if (act.dataset.confirm === '1') this.actions.order({ kind: 'war', target: id });
      else { act.dataset.confirm = '1'; act.textContent = 'Confirm: declare war'; }
    }
  }

  /** What they think of us, as a coloured figure with its reasons in a tooltip. */
  private opinionHtml(id: number) {
    const o = this.game.mine?.relations?.[id];
    if (!o) return '<span class="muted">—</span>';
    const t = tip(`${opinionWord(o.total)} (${o.total > 0 ? '+' : ''}${o.total})`, ...o.parts.map(([why, v]) => [`${why} ${v > 0 ? '+' : ''}${v}`, v >= 0 ? 'good' : 'bad'] as [string, 'good' | 'bad']));
    return `<span class="opinion ${o.total >= 10 ? 'up' : o.total <= -10 ? 'down' : ''}" data-tip="${attr(t)}">${opinionWord(o.total)} <b class="mono">${o.total > 0 ? '+' : ''}${o.total}</b></span>`;
  }

  /** Every nation, by what it thinks of us. */
  private nationsHtml() {
    const g = this.game, me = g.mine!.id;
    const list = [...this.pol.nations.values()].filter((n) => n.id !== me && !g.nations.get(n.id)?.annexedBy)
      .map((n) => ({ n, o: g.mine?.relations?.[n.id]?.total ?? 0 })).sort((a, b) => b.o - a.o);
    const w = g.war;
    const ties = (id: number) => PACTS.filter((k) => w.treaties.some((t) => t.kind === k && ((t.a === me && t.b === id) || (t.b === me && t.a === id)))).map((k) => PACT_INFO[k].name.split(' ').map((x) => x[0]).join('').toUpperCase());
    return `<span class="label">NATIONS · by what they think of us · click one for its page</span>
      <div class="nation-list">${list.map(({ n, o }) => `<button type="button" class="nation-row" data-d="page" data-nation="${n.id}">
        <span class="nm">${esc(n.name)}</span><span class="rel-bar"><i class="${o >= 0 ? 'pos' : 'neg'}" style="${o >= 0 ? 'left:50%' : `left:${50 + o / 2}%`};width:${Math.abs(o) / 2}%"></i></span>
        ${this.opinionHtml(n.id)}<span class="mono ties">${ties(n.id).join(' ') || ''}${w.wars.some((x) => (x.a === me && x.b === n.id) || (x.b === me && x.a === n.id)) ? ' <r>WAR</r>' : ''}</span></button>`).join('')}</div>`;
  }

  /** One nation's page: relations, treaties, and every deal on offer. */
  private pageHtml(id: number) {
    const g = this.game, mine = g.mine!, me = mine.id, w = g.war, n = this.pol.nations.get(id)!;
    const pub = g.nations.get(id);
    const atWar = w.wars.some((x) => (x.a === me && x.b === id) || (x.b === me && x.a === id));
    const has = (k: Pact) => k === 'guarantee' ? w.treaties.some((t) => t.kind === k && t.a === me && t.b === id) : w.treaties.some((t) => t.kind === k && ((t.a === me && t.b === id) || (t.b === me && t.a === id)));
    const count = (k: Pact) => k === 'guarantee' ? w.treaties.filter((t) => t.kind === k && t.a === me).length : w.treaties.filter((t) => t.kind === k && (t.a === me || t.b === me)).length;
    const sent = (k: DealKind) => (mine.diplo?.outgoing ?? []).some((p) => p.to === id && p.deal.kind === k);
    const theyGuarantee = w.treaties.some((t) => t.kind === 'guarantee' && t.a === id && t.b === me);
    const pacts = PACTS.map((k) => {
      const info = PACT_INFO[k], on = has(k);
      const t = tip(info.name, [info.text, 'good'], `Up to ${info.max}; you have ${count(k)}`, `+${info.opinion} to their opinion of you`);
      return `<div class="war-row" data-tip="${attr(t)}"><div><b>${info.name}</b><span class="mono">${on ? 'in force' : sent(k) ? 'proposed · awaiting their answer' : esc(info.text)}</span></div>
        ${on ? `<button type="button" class="claim danger" data-d="endpact" data-nation="${id}" data-pact="${k}">End</button>`
          : `<button type="button" class="claim" data-d="pact" data-nation="${id}" data-pact="${k}" ${atWar || sent(k) || count(k) >= info.max ? 'disabled' : ''}>${k === 'guarantee' ? 'Guarantee them' : 'Propose'}</button>`}</div>`;
    }).join('');
    const price = (c: Commodity) => (g.market?.prices[c] ?? COMMODITY_INFO[c].basePrice);
    const myUse = mine.econ?.goods ? Object.fromEntries(COMMODITIES.map((c) => [c, mine.econ!.goods[c].use])) as Record<Commodity, number> : null;
    const contracts = (mine.contracts ?? []).filter((c) => c.seller === id || c.buyer === id);
    const myEnvoy = (mine.envoys ?? []).find((v) => v.target === id);
    const envoys = (mine.envoys ?? []).length;
    const border = [...this.pol.provinces.values()].filter((p) => p.nation === id && p.kind === 'land' && p.id !== n.capital && p.adj.some((q) => this.pol.provinces.get(q)?.nation === me));
    const gdp = g.economy.get(id)?.gdp ?? 0;
    const embargo = w.embargoes.some((e) => e.from === me && e.to === id);
    const claim = mine.politics?.claims.includes(id);
    return `<div class="row-between"><button type="button" class="link" data-d="back">‹ All diplomacy</button><button type="button" class="link" data-d="goto" data-nation="${id}">Show on the map</button></div>
      <div class="econ-kpis">
        <div><span>${esc(n.name)}</span><b>${this.opinionHtml(id)}</b><em>their opinion of you · hover for why</em></div>
        <div><span>Government</span><b>${pub?.government ? GOVERNMENT_INFO[pub.government].name : '—'}</b><em>${pub?.controller === 'human' ? `led by ${esc(pub.player ?? 'a player')}` : 'AI'}</em></div>
        <div><span>Standing</span><b class="${atWar ? 'down' : ''}">${atWar ? 'At war' : 'At peace'}</b><em>${claim ? 'you hold a claim on them' : theyGuarantee ? 'they guarantee your independence' : '&nbsp;'}</em></div>
        <div><span>GDP</span><b>$${Math.round(gdp).toLocaleString('en-US')}bn</b><em>army ~${pub?.army ?? 0} divisions</em></div>
      </div>
      <div class="econ-cols"><section>
        ${pub?.government ? `<span class="label">THEIR ${CHAMBER[pub.government].name.toUpperCase()}</span>
          <div class="chamber-wrap small">${chamberSvg(pub.government, blocsFor(pub.government, pub.parties, n.color ?? '#8a8f96'), '#f0d48a')}${chamberLegend(pub.government, blocsFor(pub.government, pub.parties, n.color ?? '#8a8f96'))}</div>` : ''}
        <span class="label">TREATIES</span>${pacts}
        <p class="hint">AI governments answer at once, mostly by their opinion of you. Raise it with gifts, envoys, treaties and shared enemies; a Diplomacy focus helps everywhere.</p>
      </section><section>
        <span class="label">SUPPLY CONTRACT · ${contracts.length ? `${contracts.length} with them` : `you have ${(mine.contracts ?? []).length} of ${MAX_CONTRACTS}`}</span>
        ${contracts.map((c) => `<div class="war-row"><div><b>${c.seller === me ? 'You sell' : 'You buy'} ${COMMODITY_INFO[c.good].name.toLowerCase()}</b><span class="mono">${c.amount.toFixed(2)} ${COMMODITY_INFO[c.good].unit} a year, worth $${(c.price * c.amount).toFixed(2)}bn a year · until day ${c.until}</span></div>
          <button type="button" class="claim danger" data-d="endcontract" data-id="${c.id}">Break</button></div>`).join('')}
        <div class="deal-form">
          <select id="ctDir" aria-label="Buy or sell"><option value="buy">Buy from them</option><option value="sell">Sell to them</option></select>
          <select id="ctGood" aria-label="Good">${COMMODITIES.map((c) => `<option value="${c}">${COMMODITY_INFO[c].name}</option>`).join('')}</select>
          <input id="ctAmount" type="number" min="0.01" step="0.01" value="${myUse ? (myUse[COMMODITIES[0]] * 0.1).toFixed(2) : '1'}" aria-label="Amount a year" title="Amount a year, in the good's unit (see the Market)">
          <select id="ctYears" aria-label="Length">${CONTRACT_YEARS.map((y) => `<option value="${y}">${y} year${y > 1 ? 's' : ''}</option>`).join('')}</select>
          <button type="button" class="claim" data-d="contract" data-nation="${id}" ${atWar ? 'disabled' : ''}>Propose contract</button>
        </div>
        <p class="hint">Delivered daily from the seller's stock at today's world price (oil now $${(price('oil') * 1000).toFixed(1)}/bbl), outside the market: embargoes and blockades do not stop it. Amounts are a year's worth, in the units of the <a href="#" class="go" data-go="market:local">Market</a>; 10% of your yearly use is a good start.</p>
        <span class="label">GIFTS AND ENVOYS</span>
        <div class="deal-form"><input id="giftAmount" type="number" min="0.1" step="0.1" value="${Math.max(0.5, Math.round(gdp * 0.002 * 10) / 10)}" aria-label="Gift in $bn"><button type="button" class="claim" data-d="gift" data-nation="${id}" ${atWar ? 'disabled' : ''}>Send gift ($bn)</button></div>
        <div class="actions-row">${myEnvoy ? `<span class="mono">Your envoy is there until day ${myEnvoy.until}</span>` : `<button type="button" class="claim" data-d="envoy" data-nation="${id}" ${atWar || envoys >= MAX_ENVOYS ? 'disabled' : ''} data-tip="${attr(tip('Send an envoy', `$${ENVOY_COST}bn; works on them for ${ENVOY_DAYS} days`, ['+10 opinion while there, and up to +22 remembered', 'good'], `${envoys} of ${MAX_ENVOYS} envoys abroad`))}">Send envoy · $${ENVOY_COST}bn</button>`}</div>
        <span class="label">PRESSURE</span>
        <div class="deal-form"><input id="tribAmount" type="number" min="0.1" step="0.1" value="${Math.max(0.1, Math.round(gdp * 0.01 * 10) / 10)}" aria-label="Tribute in $bn"><button type="button" class="claim" data-d="tribute" data-nation="${id}" ${atWar ? 'disabled' : ''}>Demand tribute ($bn)</button></div>
        ${border.length ? `<div class="deal-form"><select id="demProv" aria-label="Province">${border.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button type="button" class="claim" data-d="demandprov" data-nation="${id}" ${atWar ? 'disabled' : ''}>Demand province</button></div>` : ''}
        <p class="hint">A demand they refuse gives you a <a href="#" class="go" data-go="politics:claims">claim</a>: a justified war. Either way they resent being threatened.</p>
        <div class="actions-row">
          <button type="button" class="claim" data-d="denounce" data-nation="${id}" data-tip="${attr(tip('Denounce', ['−30 to their opinion; their allies sour too', 'bad'], ['Their enemies like you more; +5 political capital at home', 'good']))}">Denounce</button>
          <button type="button" class="claim" data-d="embargo" data-nation="${id}" data-on="${embargo ? 0 : 1}">${embargo ? 'Lift embargo' : 'Embargo'}</button>
          ${atWar ? `<a href="#" class="claim primary go-btn" data-go="peacecon:${id}">Peace conference…</a>` : `<a href="#" class="claim danger go-btn" data-go="war:${id}">Declare war…</a>`}
        </div>
      </section></div>`;
  }

  private name(id: number) {
    return `<button type="button" class="link" data-d="page" data-nation="${id}">${esc(this.pol.nations.get(id)?.name ?? `Nation ${id}`)}</button>`;
  }

  render() {
    const mine = this.game.mine;
    const head = `<div class="econ-head"><div><span class="label">DIPLOMACY</span><h2>${esc(mine ? this.pol.nations.get(mine.id)?.name ?? '' : 'Diplomacy')}</h2></div><button type="button" class="link" data-d="close">Close</button></div>`;
    if (!mine) {
      this.panel.innerHTML = `${head}<div class="econ-body"><p class="hint">Take command of a nation to make treaties.</p></div>`;
      return;
    }
    const me = mine.id, w = this.game.war;
    const partners = (kind: Pact) => w.treaties.filter((t) => t.kind === kind && (t.a === me || t.b === me)).map((t) => (t.a === me ? t.b : t.a));
    const allies = partners('alliance'), trade = partners('trade');
    const wars = w.wars.filter((x) => x.a === me || x.b === me).map((x) => (x.a === me ? x.b : x.a));
    const incoming = mine.diplo?.incoming ?? [], outgoing = mine.diplo?.outgoing ?? [];
    const held = (by: number, of: number) => Object.entries(w.occupied).filter(([p, o]) => o === by && this.pol.provinces.get(Number(p))?.nation === of).length;
    const sent = (to: number, kind: DealKind) => outgoing.some((p) => p.to === to && p.deal.kind === kind);

    const tabs = `<div class="mk-tabs" role="tablist">
      <button type="button" role="tab" data-d="tab" data-tab="overview" aria-selected="${this.tab === 'overview' && this.focused === null}">Overview</button>
      <button type="button" role="tab" data-d="tab" data-tab="nations" aria-selected="${this.tab === 'nations' || this.focused !== null}">Nations</button></div>`;
    if (this.focused !== null && this.pol.nations.has(this.focused)) {
      this.panel.innerHTML = `${head}${tabs}<div class="econ-body">${this.pageHtml(this.focused)}</div>`;
      return;
    }
    if (this.tab === 'nations') { this.panel.innerHTML = `${head}${tabs}<div class="econ-body">${this.nationsHtml()}</div>`; return; }
    const others = PACTS.filter((k) => k !== 'alliance' && k !== 'trade').flatMap((k) => w.treaties.filter((t) => t.kind === k && (t.a === me || t.b === me)).map((t) => [k, t.a === me ? t.b : t.a, t.a === me] as const));
    this.panel.innerHTML = `${head}${tabs}
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Alliances</span><b>${allies.length} / ${PACT_INFO.alliance.max}</b><em>allies defend you and may cross your land</em></div>
          <div><span>Trade agreements</span><b>${trade.length} / ${PACT_INFO.trade.max}</b><em>+${(trade.length * TRADE_DEAL_GROWTH * 100).toFixed(2)}% growth a year</em></div>
          <div><span>Wars</span><b class="${wars.length ? 'down' : ''}">${wars.length}</b><em>${wars.length ? 'make peace below' : 'at peace'}</em></div>
          <div><span>Awaiting you</span><b class="${incoming.length ? 'up' : ''}">${incoming.length}</b><em>${outgoing.length} of yours pending</em></div>
        </div>
        <div class="econ-cols">
          <section>
            <span class="label">PROPOSALS TO YOU</span>
            ${incoming.length ? incoming.map((p) => `<div class="war-row"><div><b>${this.name(p.from)}</b><span class="mono">offers ${dealText(p.deal)}${p.deal.kind === 'peace' && p.deal.terms === 'cede' ? ` · you would lose ${held(p.from, me)} province${held(p.from, me) === 1 ? '' : 's'}` : ''}</span></div>
              <div class="actions-row"><button type="button" class="claim primary" data-d="accept" data-nation="${p.from}" data-kind="${p.deal.kind}">Accept</button>
              <button type="button" class="claim" data-d="decline" data-nation="${p.from}" data-kind="${p.deal.kind}">Decline</button></div></div>`).join('')
              : '<p class="hint">Nothing waiting. Proposals lapse after 30 game days (5 minutes).</p>'}
            ${outgoing.length ? `<span class="label">YOUR PROPOSALS</span>${outgoing.map((p) => `<div class="war-row"><div><b>${this.name(p.to)}</b><span class="mono">${dealText(p.deal)} · awaiting their answer</span></div></div>`).join('')}` : ''}
            <span class="label">WARS</span>
            ${wars.length ? wars.map((foe) => {
              const ours = held(me, foe), theirs = held(foe, me);
              return `<div class="war-row"><div><b>${this.name(foe)}</b><span class="mono">we hold ${ours} of theirs, they hold ${theirs} of ours</span></div>
                <div class="actions-row"><a href="#" class="claim primary go-btn" data-go="peacecon:${foe}">Peace conference… (score ${(mine.warScores?.[foe] ?? 0) > 0 ? '+' : ''}${mine.warScores?.[foe] ?? 0})</a>
                <button type="button" class="claim" data-d="white" data-nation="${foe}" ${sent(foe, 'peace') ? 'disabled' : ''}>White peace</button></div></div>`;
            }).join('') : '<p class="hint">No wars.</p>'}
          </section>
          <section>
            <span class="label">TREATIES</span>
            ${allies.length + trade.length + others.length ? [...allies.map((id) => ['alliance', id, true] as const), ...trade.map((id) => ['trade', id, true] as const), ...others].map(([kind, id, ours]) => `
              <div class="war-row"><div><b>${this.name(id)}</b><span class="mono">${kind === 'guarantee' ? (ours ? 'you guarantee them' : 'they guarantee you') : PACT_INFO[kind].name.toLowerCase()} · ${this.opinionHtml(id)}</span></div>
              <button type="button" class="claim danger" data-d="cancel" data-nation="${id}" data-pact="${kind}">End</button></div>`).join('')
              : '<p class="hint">No treaties yet.</p>'}
            ${(mine.contracts ?? []).length ? `<span class="label">SUPPLY CONTRACTS</span>${mine.contracts!.map((c) => `<div class="war-row"><div><b>${this.name(c.seller === me ? c.buyer : c.seller)}</b><span class="mono">${c.seller === me ? 'you sell' : 'you buy'} ${COMMODITY_INFO[c.good].name.toLowerCase()}, ${c.amount.toFixed(2)} ${COMMODITY_INFO[c.good].unit} a year</span></div>
              <button type="button" class="claim danger" data-d="endcontract" data-id="${c.id}">Break</button></div>`).join('')}` : ''}
            ${(mine.envoys ?? []).length ? `<span class="label">ENVOYS ABROAD</span>${mine.envoys!.map((v) => `<div class="war-row"><div><b>${this.name(v.target)}</b><span class="mono">until day ${v.until}</span></div></div>`).join('')}` : ''}
            ${this.vassalsHtml(me)}
            <p class="hint">Open a nation's page from the <button type="button" class="link" data-d="tab" data-tab="nations">Nations</button> tab (or click its name on the map) for every treaty, contract, gift, envoy and demand. AI governments answer at once, mostly by their opinion of you; a Diplomacy focus makes them friendlier. Allies are defensive: if someone attacks you, your allies join the war. Peace that cedes land hands over the provinces the winner holds, with their people and output; a nation that loses all its land is annexed.</p>
          </section>
        </div>
        <div class="econ-cols">
          <section>${this.blocHtml(me)}</section>
          <section>${this.councilHtml(me)}</section>
        </div>
        <span class="label">INTELLIGENCE REPORTS</span>
        ${(mine.reports ?? []).length ? `<ul class="reports">${mine.reports!.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : `<p class="hint">No reports yet. Launch spy operations from another nation's panel ($2bn each, ${mine.spyOps ?? 0} of 3 under way).</p>`}
      </div>`;
  }

  private nationName(id: number) {
    return esc(this.pol.nations.get(id)?.name ?? `Nation ${id}`);
  }

  private vassalsHtml(me: number) {
    const v = this.game.war.vassals;
    const mine = Object.entries(v).filter(([, o]) => o === me).map(([x]) => Number(x));
    const lord = v[me];
    if (!mine.length && lord === undefined) return '';
    return `<span class="label">VASSALS</span>
      ${lord !== undefined ? `<p class="hint">You are a vassal of ${this.name(lord)}: you pay 2% of GDP a year in tribute and cannot start wars, except a war of independence against them.</p>` : ''}
      ${mine.map((x) => `<div class="war-row"><div><b>${this.name(x)}</b><span class="mono">vassal · pays tribute · fights your wars</span></div>
        <button type="button" class="claim" data-d="release" data-nation="${x}">Release</button></div>`).join('')}`;
  }

  private blocHtml(me: number) {
    const bloc = this.game.war.blocs.find((b) => b.members.includes(me));
    if (!bloc) {
      return `<span class="label">BLOC</span>
        <p class="hint">A bloc is a named coalition of up to ${MAX_BLOC} nations: an attack on one is an attack on all, and members cross each other's land. Found one and invite nations from their panels.</p>
        <div class="actions-row"><input id="blocName" class="text-input" maxlength="32" placeholder="Name your bloc" aria-label="Bloc name">
        <button type="button" class="claim primary" data-d="bloc-create">Found bloc</button></div>
        ${this.game.war.blocs.length ? `<p class="hint">Existing blocs: ${this.game.war.blocs.map((b) => `${esc(b.name)} (${b.members.length})`).join(', ')}</p>` : ''}`;
    }
    return `<span class="label">BLOC · ${esc(bloc.name).toUpperCase()}</span>
      ${bloc.members.map((m) => `<div class="war-row"><div><b>${this.name(m)}</b><span class="mono">${m === bloc.leader ? 'leader' : 'member'}</span></div></div>`).join('')}
      <div class="actions-row"><button type="button" class="claim danger" data-d="bloc-leave">Leave ${esc(bloc.name)}</button></div>
      ${bloc.leader === me ? '<p class="hint">As leader, invite nations from their panel on the map.</p>' : ''}`;
  }

  private councilHtml(me: number) {
    const g = this.game, day = g.market?.day ?? 0;
    const nations = [...this.pol.nations.values()].filter((n) => !g.nations.get(n.id)?.annexedBy).sort((a, b) => a.name.localeCompare(b.name));
    const options = nations.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('');
    const rows = g.war.council.slice().reverse().map((r) => {
      const voted = r.yes.includes(me) ? 'yes' : r.no.includes(me) ? 'no' : '';
      return `<div class="war-row"><div><b>${esc(RESOLUTION_TEXT[r.kind])} the ${this.nationName(r.target)}${r.target2 !== undefined ? ` and the ${this.nationName(r.target2)}` : ''}</b>
        <span class="mono">tabled by the ${this.nationName(r.by)} · ${r.yes.length} yes, ${r.no.length} no · ${r.result ? r.result.toUpperCase() : `${Math.max(0, VOTE_DAYS - (day - r.day))} days left`}</span></div>
        ${r.result ? '' : `<div class="actions-row"><button type="button" class="claim${voted === 'yes' ? ' primary' : ''}" data-d="vote" data-id="${r.id}" data-yes="1">Yes</button>
        <button type="button" class="claim${voted === 'no' ? ' primary' : ''}" data-d="vote" data-id="${r.id}" data-yes="0">No</button></div>`}</div>`;
    }).join('');
    return `<span class="label">WORLD COUNCIL</span>
      ${rows || '<p class="hint">No resolutions before the council.</p>'}
      <div class="council-form">
        <select id="resKind" aria-label="Resolution">${(['condemn', 'sanction', 'ceasefire'] as ResolutionKind[]).map((k) => `<option value="${k}">${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
        <select id="resTarget" aria-label="Nation">${options}</select>
        <select id="resTarget2" aria-label="Second nation (ceasefire)"><option value="">(second nation, for a ceasefire)</option>${options}</select>
        <button type="button" class="claim" data-d="table">Table resolution</button>
      </div>
      <p class="hint">Passes with more yes than no votes and at least a quarter of all nations voting yes. AI governments vote at once; players have ${VOTE_DAYS} game days.</p>`;
  }
}
