// The Politics window: political capital, the legislature (parliament, council,
// or rule by decree), laws in force and on offer, what parliament or the elites
// demand, and claims on other nations.
import { DECREE_DISCOUNT, HIGH_TAX, HIGH_TAX_SUPPORT, LAWS, LAW_IDS, LEGISLATURE_TEXT, MAX_CAPITAL, WAR_SUPPORT, lawVote, type LawId } from '../../shared/politics';
import { FACTIONS, FACTION_INFO } from '../../shared/society';
import { GOVERNMENT_INFO } from '../../shared/research';
import type { Order } from '../../shared/protocol';
import type { Change, Game } from './game';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';
import { attr, effectLines, tip } from './tooltip';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LEG_NAME = { parliament: 'Parliament', council: 'Council of experts', decree: 'Rule by decree', junta: 'Military junta' } as const;
const BY_NAME = { parliament: 'Parliament', military: 'The military', business: 'Business', public: 'The public' } as const;

export class PoliticsPanel {
  private el: HTMLElement;
  private html = '';
  private highlight = '';

  constructor(root: HTMLElement, private game: Game, private pol: Political, private order: (o: Order) => void) {
    this.el = document.createElement('section');
    this.el.className = 'panel econ-window politics-window';
    keepScrollOn(this.el);
    this.el.setAttribute('aria-label', 'Politics');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-pl]');
      if (!t) return;
      const a = t.dataset.pl;
      if (a === 'close') { this.close(); document.dispatchEvent(new CustomEvent('politics-closed')); }
      else if (a === 'law') this.order({ kind: 'law', law: t.dataset.law as LawId, enact: t.dataset.enact === '1' });
      else if (a === 'refuse') {
        if (t.dataset.confirm === '1') this.order({ kind: 'dismiss_demand' });
        else { t.dataset.confirm = '1'; t.textContent = 'Confirm: refuse'; }
      }
    });
    game.on((c: Set<Change>) => { if (this.isOpen && (c.has('mine') || c.has('status'))) this.render(); });
  }

  get isOpen() { return !this.el.hidden; }
  toggle() { this.el.hidden = !this.el.hidden; if (this.isOpen) { this.html = ''; this.render(); } }
  close() { this.el.hidden = true; }
  /** Open on a section: 'laws', 'demand', 'claims'. */
  focus(section: string) {
    this.highlight = section;
    this.el.hidden = false; this.html = ''; this.render();
    requestAnimationFrame(() => this.el.querySelector(`#pol-${section}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  private render() {
    const mine = this.game.mine, p = mine?.politics;
    const head = `<div class="econ-head"><div><span class="label">POLITICS</span><h2>${esc(mine ? this.pol.nations.get(mine.id)?.name ?? '' : 'Politics')}</h2></div><button type="button" class="link" data-pl="close">Close</button></div>`;
    if (!mine || !p) { this.set(`${head}<div class="econ-body"><p class="hint">Take command of a nation to govern it.</p></div>`); return; }
    const gov = mine.government ? GOVERNMENT_INFO[mine.government].name : '—';
    const vote = (p.legislature === 'parliament' || p.legislature === 'council') && !p.emergencyUntil;
    const factions = mine.society?.factions ?? { military: 50, business: 50, public: 50 };
    const support = p.support ?? 50;
    const supportTip = tip(p.legislature === 'council' ? 'Council support' : 'Parliament support',
      p.legislature === 'council' ? 'Follows business, stability and growth' : 'Follows the public, business, the military and stability',
      'Rises when you meet its demands; falls when you ignore them',
      [`Laws pass at 50% of votes; wars of choice need ${WAR_SUPPORT}% support (25% with a claim)`, 'good'],
      `Taxes above ${HIGH_TAX}% need ${HIGH_TAX_SUPPORT}% support`);
    const kpis = `<div class="econ-kpis">
      <div data-tip="${attr(tip('Political capital', 'Spent on passing and repealing laws', [`+${p.gain.toFixed(2)} a day from stability and legitimacy`, 'good'], 'A Diplomacy focus and a government that suits the people earn more', `Holds at most ${MAX_CAPITAL}`))}"><span>Political capital</span><b>${Math.floor(p.capital)}</b><em>+${(p.gain * 30).toFixed(0)} a month · max ${MAX_CAPITAL}</em></div>
      <div><span>Government</span><b>${esc(gov)}</b><em>${LEG_NAME[p.legislature]}${p.emergencyUntil ? ' · emergency powers' : ''}</em></div>
      ${vote || p.legislature === 'parliament' || p.legislature === 'council' ? `<div data-tip="${attr(supportTip)}"><span>${p.legislature === 'council' ? 'Council' : 'Parliament'} support</span><b class="${support < WAR_SUPPORT ? 'down' : support >= 60 ? 'up' : ''}">${support}%</b><em>${support >= HIGH_TAX_SUPPORT ? 'backs you' : support >= WAR_SUPPORT ? 'wary' : 'hostile'}</em></div>`
        : `<div><span>Decrees</span><b>${Math.round((1 - DECREE_DISCOUNT) * 100)}% cheaper</b><em>but laws the public dislikes cost stability</em></div>`}
      <div><span>Laws in force</span><b>${p.laws.length}</b><em>of ${LAW_IDS.length}</em></div>
    </div>`;
    const bar = (v: number) => `<div class="bar" role="img" aria-label="${Math.round(v)} of 100"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
    const groups = `<span class="label">WHO HOLDS POWER</span>
      <div class="bars">${FACTIONS.map((f) => `<span data-tip="${attr(tip(FACTION_INFO[f].name, `Wants ${FACTION_INFO[f].wants}`, [`Content (75+): ${FACTION_INFO[f].happy}`, 'good'], [`Angry (below 25): ${FACTION_INFO[f].angry}`, 'bad']))}">${FACTION_INFO[f].name}</span>${bar(factions[f])}<span class="mono">${Math.round(factions[f])}</span>`).join('')}</div>
      <p class="hint">${esc(LEGISLATURE_TEXT[p.legislature])} Laws move these groups' mood for as long as they are in force. <a href="#" class="go" data-go="module:research">Reform the government</a> in R&amp;D.</p>`;
    const d = p.demand, day = this.game.market?.day ?? 0;
    const demand = `<span class="label" id="pol-demand">${d ? `${BY_NAME[d.by].toUpperCase()} DEMANDS` : 'DEMANDS'}</span>
      ${d ? `<div class="demand-card${this.highlight === 'demand' ? ' glow' : ''}"><b>${esc(d.text)}</b>
        <span class="mono">${Math.max(0, d.until - day)} days left · meet it: <g>+15 capital, goodwill${d.by !== 'parliament' ? `, ${d.by} pleased` : ''}</g> · ignore it: <r>support and stability fall</r></span>
        <div class="actions-row">${this.demandLink(d.kind)}<button type="button" class="claim danger" data-pl="refuse">Refuse</button></div></div>`
        : `<p class="hint">${p.legislature === 'parliament' || p.legislature === 'council' ? 'Parliament' : 'The elites'} will ask things of you from time to time: more welfare, peace, lower taxes, a trade deal, more research or defence. Meeting a demand earns capital and goodwill.</p>`}`;
    const laws = LAW_IDS.map((id) => {
      const L = LAWS[id], on = p.laws.includes(id);
      const clash = !on && (L.excludes ?? []).find((x) => p.laws.includes(x));
      const cost = Math.round(L.cost * (on ? 0.5 : 1) * (vote ? 1 : DECREE_DISCOUNT));
      const yes = vote ? lawVote({ legislature: p.legislature, support, factions }, id, on) : null;
      const leans = FACTIONS.filter((f) => L.lean[f]).map((f) => [`${FACTION_INFO[f].name} ${L.lean[f]! > 0 ? 'approve' : 'object'}`, L.lean[f]! > 0 ? 'good' : 'bad'] as [string, 'good' | 'bad']);
      const t = tip(L.name, ...effectLines(L.text), ...leans, L.upkeep ? [`Costs ${(L.upkeep * 100).toFixed(2)}% of GDP a year`, 'bad'] : null,
        yes !== null ? `${p.legislature === 'council' ? 'Council' : 'Parliament'}: about ${yes}% would vote for ${on ? 'repeal' : 'it'}` : 'By decree: no vote');
      const blocked = clash ? `Repeal ${LAWS[clash].name} first` : '';
      const btn = blocked ? `<span class="muted">${esc(blocked)}</span>`
        : `<button type="button" class="claim${on ? '' : ' primary'}" data-pl="law" data-law="${id}" data-enact="${on ? 0 : 1}" ${p.capital < cost ? 'disabled' : ''}>${on ? 'Repeal' : vote ? 'Put to a vote' : 'Decree'} · ${cost}</button>`;
      return `<div class="law-row${on ? ' on' : ''}" data-tip="${attr(t)}"><div><b>${esc(L.name)}</b>${on ? ' <span class="pill ok">in force</span>' : ''}
        <span class="mono">${esc(L.text)}</span>${yes !== null ? `<span class="vote ${yes >= 50 ? 'up' : 'down'}">${yes}% in favour</span>` : ''}</div>${btn}</div>`;
    }).join('');
    const claims = p.claims.length
      ? p.claims.map((c) => `<a href="#" class="go" data-go="diplo:${c}">${esc(this.pol.nations.get(c)?.name ?? `Nation ${c}`)}</a>`).join(', ')
      : 'none';
    this.set(`${head}<div class="econ-body">${kpis}
      <div class="econ-cols"><section>${demand}${groups}
        <span class="label" id="pol-claims">CLAIMS</span>
        <p class="hint">You hold claims on: ${claims}. A claim comes from a demand another nation refused (made in <a href="#" class="go" data-go="module:diplomacy">Diplomacy</a>). A war on a nation you claim is justified: parliament needs less convincing and the world condemns you far less.</p>
      </section>
      <section><span class="label" id="pol-laws">LAWS</span>${laws}</section></div></div>`);
  }

  /** Where to go to meet a demand. */
  private demandLink(kind: string) {
    const to: Record<string, [string, string]> = {
      welfare: ['econ:b-welfare', 'Open the budget'], research: ['econ:b-research', 'Open the budget'], defence: ['econ:b-military', 'Open the budget'],
      lower_tax: ['econ:econTax', 'Open taxes'], peace: ['module:diplomacy', 'Open Diplomacy'], trade: ['module:diplomacy', 'Find a trade partner'], infrastructure: ['politics:laws', 'See the law'],
    };
    const [go, text] = to[kind] ?? ['module:economy', 'Open Economy'];
    return `<a href="#" class="claim go-btn" data-go="${go}">${text}</a>`;
  }

  private set(html: string) { if (html !== this.html) { this.html = html; this.el.innerHTML = html; } }
}
