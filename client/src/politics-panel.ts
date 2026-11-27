// The Politics window: political capital, the legislature (parliament, council,
// or rule by decree), laws in force and on offer, what parliament or the elites
// demand, and claims on other nations.
import { DECREE_DISCOUNT, HIGH_TAX, HIGH_TAX_SUPPORT, LAWS, LAW_IDS, LEGISLATURE_TEXT, MAX_CAPITAL, WAR_SUPPORT, lawVote, type LawId } from '../../shared/politics';
import { FACTIONS, FACTION_INFO, PILLAR_REVOLT, PROPAGANDA_COST, pillarStability, pillarState, type PropagandaMode } from '../../shared/society';
import { GOVERNMENTS, GOVERNMENT_INFO, REFORM_COOLDOWN_DAYS, type Government } from '../../shared/research';
import { ADVISER_AREAS, type AdviserArea, type Order } from '../../shared/protocol';
import type { Change, Game } from './game';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';
import { attr, effectLines, tip } from './tooltip';
import { CAMPAIGN_COST, CAMPAIGN_DAYS, COALITION_COST } from '../../shared/parties';
import { CHAMBER, blocsFor, chamberLegend, chamberSvg } from './chamber';

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
      else if (a === 'appeal') this.order({ kind: 'appeal' });
      else if (a === 'adviser') {
        const areas = [...this.el.querySelectorAll<HTMLInputElement>('[data-pl="adviser"]')].filter((x) => x.checked).map((x) => x.dataset.area as AdviserArea);
        this.order({ kind: 'advisers', areas });
      }
      else if (a === 'prop') {
        const mode = t.dataset.mode as PropagandaMode;
        const target = mode === 'abroad' ? Number((this.el.querySelector('#propTarget') as HTMLSelectElement).value) : undefined;
        this.order({ kind: 'propaganda', mode, target });
      } else if (a === 'gov') {
        if (t.dataset.confirm === '1') this.order({ kind: 'government', government: t.dataset.gov as Government });
        else { t.dataset.confirm = '1'; t.textContent = 'Confirm reform'; }
      }
      else if (a === 'campaign') this.order({ kind: 'campaign' });
      else if (a === 'coalition') this.order({ kind: 'coalition', party: t.dataset.party!, join: t.dataset.join === '1' });
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
    const groups = `<p class="hint">${esc(LEGISLATURE_TEXT[p.legislature])} Laws move the pillars' mood for as long as they are in force. <a href="#" class="go" data-go="module:research">Reform the government</a> in R&amp;D.</p>`;
    // the three pillars: keep each above 50 to avoid stability losses, above 75 for a bonus; below 25 they may rise
    const angry = FACTIONS.filter((f) => factions[f] < PILLAR_REVOLT).length;
    const pillars = `<section class="pillars${angry === 3 ? ' collapse' : ''}" id="pol-pillars"><span class="label">THE THREE PILLARS · BUSINESS, PEOPLE, MILITARY</span>
      <div class="pillar-list">${FACTIONS.map((f) => {
        const v = factions[f], st = pillarState(v), sd = pillarStability(v), info = FACTION_INFO[f];
        const t = tip(`${info.name}: ${Math.round(v)} of 100 · ${st.label}`, `Wants ${info.wants}`,
          [`Stability ${sd > 0 ? '+' : sd < 0 ? '−' : '±'}${Math.abs(sd)} from this group now`, sd >= 0 ? 'good' : 'bad'],
          [`75 and above (loyal): +3 stability and ${info.happy}`, 'good'],
          '50 to 75 (content): no effect',
          ['25 to 50 (uneasy): stability falls the lower it goes, to −6', 'bad'],
          [`Below 25: −8 stability, ${info.angry}, and the risk of ${info.revolt}`, 'bad'],
          'Moved mostly by events and how you answer them');
        return `<div class="pillar ${st.level}" data-tip="${attr(t)}"><div class="pillar-head"><b>${info.name}</b><span class="mono">${Math.round(v)}</span></div>
          <div class="pillar-bar" role="img" aria-label="${info.name} ${Math.round(v)} of 100, ${st.label}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i><s style="left:25%"></s><s style="left:50%"></s><s style="left:75%"></s></div>
          <div class="pillar-foot"><span>${st.label}</span><span class="mono">${sd > 0 ? `+${sd}` : sd < 0 ? `−${Math.abs(sd)}` : '±0'} stability</span></div></div>`;
      }).join('')}</div>
      <p class="hint">${angry === 3 ? '<b class="down">All three have turned against you: the government can fall at any moment, without a fight.</b> '
        : angry ? `<b class="down">${FACTIONS.filter((f) => factions[f] < PILLAR_REVOLT).map((f) => FACTION_INFO[f].name).join(' and ')} could rise against you.</b> ` : ''}Keep each above 50 to avoid stability losses; above 75 each gives a bonus. Below 25 a group may revolt; with all three below 25 the government falls without a fight. Events and how you answer them move them most.</p></section>`;
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
      ${pillars}
      ${this.partiesHtml()}
      <div class="actions-row"><button type="button" class="claim" data-pl="appeal" ${p.capital < 50 ? 'disabled' : ''} data-tip="${attr(tip('National appeal', ['+6 stability', 'good'], ['+5 goodwill in parliament', 'good'], ['Costs 50 political capital', 'bad']))}">Address the nation · 50</button></div>
      <div class="econ-cols"><section>${demand}${groups}
        <span class="label" id="pol-claims">CLAIMS</span>
        <p class="hint">You hold claims on: ${claims}. A claim comes from a demand another nation refused (made in <a href="#" class="go" data-go="module:diplomacy">Diplomacy</a>). A war on a nation you claim is justified: parliament needs less convincing and the world condemns you far less.</p>
      </section>
      <section><span class="label" id="pol-laws">LAWS</span>${laws}</section></div>
      ${this.societyHtml()}
      ${this.governmentHtml()}
      ${this.advisersHtml()}</div>`);
  }

  /** The people, propaganda and the factions. */
  private societyHtml() {
    const s = this.game.mine?.society;
    if (!s) return '';
    const axis = (v: number, left: string, right: string) => `<div class="axis"><span>${left}</span><div class="axis-bar"><i style="left:${((v + 1) / 2) * 100}%"></i></div><span>${right}</span></div>`;
    const nations = [...this.pol.nations.values()].filter((n) => n.id !== this.game.mine!.id).sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="econ-cols">
      <section>
        <span class="label">THE PEOPLE</span>
        ${axis(s.ideology.liberty, 'Authoritarian', 'Liberal')}
        ${axis(s.ideology.openness, 'Nationalist', 'Internationalist')}
        <p class="hint">Your government ${Math.round(s.fit) >= 0 ? `suits the people (${Math.round(s.fit) > 0 ? '+' : ''}${Math.round(s.fit)} stability)` : `<span class="down">clashes with what the people believe (${Math.round(s.fit)} stability)</span>`}. Beliefs drift toward the government, faster with propaganda; wealth breeds liberty, war breeds nationalism, trade breeds openness. Open societies gain more from trade deals; like-minded nations trust each other.</p>
        <span class="label">PROPAGANDA · ${(PROPAGANDA_COST * 100).toFixed(1)}% OF GDP A YEAR</span>
        <div class="actions-row">
          <button type="button" class="claim${s.propaganda.mode === 'off' ? ' primary' : ''}" data-pl="prop" data-mode="off">None</button>
          <button type="button" class="claim${s.propaganda.mode === 'home' ? ' primary' : ''}" data-pl="prop" data-mode="home" title="+4 stability; people drift toward your government three times as fast">At home</button>
          <select id="propTarget" class="text-input" aria-label="Target nation">${nations.map((n) => `<option value="${n.id}"${n.id === s.propaganda.target ? ' selected' : ''}>${esc(n.name)}</option>`).join('')}</select>
          <button type="button" class="claim${s.propaganda.mode === 'abroad' ? ' primary' : ''}" data-pl="prop" data-mode="abroad" title="Erodes their stability and pulls their people toward your values">Abroad</button>
        </div>
      </section>
      <section>
        <span class="label">WHAT EACH PILLAR WANTS</span>
        ${FACTIONS.map((f) => `<p class="hint"><b>${FACTION_INFO[f].name}</b>: ${FACTION_INFO[f].wants}. <a href="#" class="go" data-go="politics:pillars">See its bar</a></p>`).join('')}
        <p class="hint">Stability under 15% with an angry public or army can end in civil war.</p>
      </section>
    </div>`;
  }

  /** Single player: what the advisers handle, and what they have done. */
  private advisersHtml() {
    const a = this.game.mine?.advisers;
    if (!a?.available) return '';
    return `<div class="econ-cols"><section><span class="label" id="pol-advisers">ADVISERS · they act once a game week in the areas you tick</span>
      <div class="adviser-grid">${ADVISER_AREAS.map(([k, name, text]) => `<label class="check plain" data-tip="${attr(tip(name, text))}"><input type="checkbox" data-pl="adviser" data-area="${k}" ${a.areas.includes(k) ? 'checked' : ''}>${esc(name)}</label>`).join('')}</div>
      <p class="hint">They never move troops, declare war or make peace: those stay yours. Everything they do is listed here, so you can undo it.</p></section>
      <section><span class="label">WHAT THEY DID</span>${a.log.length ? `<ul class="reports">${a.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">Nothing yet.</p>'}</section></div>`;
  }

  /** The form of government and reform. */
  private governmentHtml() {
    const r = this.game.mine?.research;
    if (!r) return '';
    const day = this.game.market?.day ?? 0;
    const reforming = r.reformUntil !== undefined;
    const cooldown = r.reformedAt !== undefined ? Math.max(0, REFORM_COOLDOWN_DAYS - (day - r.reformedAt)) : 0;
    return `<span class="label" id="pol-government">FORM OF GOVERNMENT · ${reforming ? `reform under way, ${r.reformUntil! - day} days left` : cooldown ? `next reform possible in ${cooldown} days` : 'reform possible'}</span>
        <div class="gov-grid">
          ${GOVERNMENTS.map((g) => `<div class="tech${g === r.government ? ' active' : ''}" data-tip="${attr(tip(GOVERNMENT_INFO[g].name, ...effectLines(GOVERNMENT_INFO[g].text), g === r.government ? null : ['Reform: 30 days of turmoil, −10 stability', 'bad']))}"><b>${esc(GOVERNMENT_INFO[g].name)}</b><span>${esc(GOVERNMENT_INFO[g].text)}</span>
            ${g === r.government ? '<em>Current</em>' : `<button type="button" class="claim" data-pl="gov" data-gov="${g}" ${reforming || cooldown ? 'disabled' : ''}>Reform</button>`}</div>`).join('')}
        </div>
        <p class="hint">A reform takes 30 game days (5 minutes) of turmoil, −10 stability meanwhile, and the next is possible a game year later. Stability below 25 risks a coup or revolution. Random national events (booms, strikes, disasters, scandals, breakthroughs) appear in Dispatches.</p>`;
  }

  /** Parliament's parties: seats, polls, the governing coalition, and the next election. */
  /** The legislature drawn as its chamber: a hemicycle, a horseshoe council, an assembly before a podium, or a junta's table. */
  private chamberHtml() {
    const mine = this.game.mine!, gov = mine.government ?? 'democracy';
    const colour = this.pol.nations.get(mine.id)?.color ?? '#d9b45a';
    const blocs = blocsFor(gov, mine.parties, colour);
    return `<div class="chamber-wrap">${chamberSvg(gov, blocs, '#f0d48a')}<div><span class="label">${CHAMBER[gov].name.toUpperCase()} · ${CHAMBER[gov].seats} SEATS</span>
      ${chamberLegend(gov, blocs)}<p class="hint">Bright seats are the government's; faded ones are the opposition. ${gov === 'autocracy' ? 'The assembly meets to approve what the leader decrees.' : gov === 'junta' ? 'The service chiefs decide together; nothing passes against the army.' : 'Seats change at elections, following the polls.'}</p></div></div>`;
  }

  private partiesHtml() {
    const mine = this.game.mine!, ps = mine.parties;
    if (!ps?.length) return this.chamberHtml();
    const day = this.game.market?.day ?? 0;
    const gov = ps.filter((x) => x.gov), seats = gov.reduce((t, x) => t + x.seats, 0), poll = gov.reduce((t, x) => t + x.poll, 0);
    const toElection = mine.election !== undefined ? mine.election - day : undefined;
    const rows = ps.map((x) => {
      const t = tip(x.name, `Speaks for ${x.base === 'public' ? 'the public' : x.base === 'military' ? 'the military' : 'business'}`, `${x.liberty > 0.2 ? 'Liberal' : x.liberty < -0.2 ? 'Authoritarian' : 'Centrist'}, ${x.openness > 0.2 ? 'internationalist' : x.openness < -0.2 ? 'nationalist' : 'moderate on the world'}`,
        'Polls follow how close it stands to what people believe, how its group feels, and for the government, how the country is doing');
      return `<div class="party-row${x.gov ? ' gov' : ''}" data-tip="${attr(t)}"><i style="background:${x.colour}"></i><b>${esc(x.name)}</b>
        <span class="mono">${Math.round(x.seats * 100)}% seats · polls ${Math.round(x.poll * 100)}%</span>
        ${x.gov ? (gov.length > 1 ? `<button type="button" class="claim" data-pl="coalition" data-party="${esc(x.name)}" data-join="0">Drop</button>` : '<span class="pill ok">leads</span>')
          : `<button type="button" class="claim" data-pl="coalition" data-party="${esc(x.name)}" data-join="1" ${mine.politics!.capital < COALITION_COST ? 'disabled' : ''}>Invite · ${COALITION_COST}</button>`}</div>`;
    }).join('');
    const canCampaign = toElection !== undefined && toElection <= CAMPAIGN_DAYS;
    return `${this.chamberHtml()}<span class="label">PARLIAMENT · governing coalition ${Math.round(seats * 100)}% of seats, ${Math.round(poll * 100)}% in the polls${toElection !== undefined ? ` · election in ${toElection} days` : ''}</span>
      <div class="parties">${rows}</div>
      ${toElection !== undefined ? `<div class="actions-row"><button type="button" class="claim${canCampaign ? ' primary' : ''}" data-pl="campaign" ${canCampaign && mine.politics!.capital >= CAMPAIGN_COST ? '' : 'disabled'}
        data-tip="${attr(tip('Campaign push', ['The governing parties gain in the polls until the election', 'good'], [`Costs ${CAMPAIGN_COST} political capital and 0.05% of GDP`, 'bad'], `Opens ${CAMPAIGN_DAYS} days before the election`))}">${canCampaign ? `Campaign · ${CAMPAIGN_COST}` : `Campaigning opens ${CAMPAIGN_DAYS} days before the election`}</button></div>` : ''}
      <p class="hint">At the election, seats follow the polls. If the governing parties fall short of half, a new coalition forms: parliament blocks new wars for six months and repeals a law the new leaders' voters dislike.</p>`;
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
