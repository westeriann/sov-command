// The Diplomacy window: proposals waiting for an answer, treaties in force, and peace terms.
import {
  DEAL_NAMES, MAX_ALLIANCES, MAX_BLOC, MAX_TRADE_DEALS, RESOLUTION_TEXT, TRADE_DEAL_GROWTH, VOTE_DAYS, dealText,
  type Deal, type DealKind, type Pact, type ResolutionKind,
} from '../../shared/diplomacy';
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

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: DiplomacyActions) {
    this.panel = document.createElement('section');
    this.panel.className = 'panel econ-window diplo-window';
    keepScrollOn(this.panel); // redraws keep your place in the list
    this.panel.setAttribute('aria-label', 'Diplomacy');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    game.on((c) => {
      if (!(c.has('mine') || c.has('war') || c.has('nations')) || !this.isOpen) return;
      if (document.activeElement?.matches('input, select') && this.panel.contains(document.activeElement)) return; // don't wipe what is being typed
      this.render();
    });
  }

  get isOpen() { return !this.panel.hidden; }
  toggle() { this.panel.hidden = !this.panel.hidden; if (this.isOpen) this.render(); }
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
  }

  private name(id: number) {
    return `<button type="button" class="link" data-d="goto" data-nation="${id}">${esc(this.pol.nations.get(id)?.name ?? `Nation ${id}`)}</button>`;
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

    this.panel.innerHTML = `${head}
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Alliances</span><b>${allies.length} / ${MAX_ALLIANCES}</b><em>allies defend you and may cross your land</em></div>
          <div><span>Trade agreements</span><b>${trade.length} / ${MAX_TRADE_DEALS}</b><em>+${(trade.length * TRADE_DEAL_GROWTH * 100).toFixed(2)}% growth a year</em></div>
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
                <div class="actions-row"><button type="button" class="claim" data-d="white" data-nation="${foe}" ${sent(foe, 'peace') ? 'disabled' : ''}>White peace</button>
                ${ours ? `<button type="button" class="claim primary" data-d="cede" data-nation="${foe}" ${sent(foe, 'peace') ? 'disabled' : ''}>Demand the ${ours} province${ours > 1 ? 's' : ''} we hold</button>
                <button type="button" class="claim" data-d="puppet" data-nation="${foe}" ${sent(foe, 'peace') ? 'disabled' : ''}>Demand vassalage</button>` : ''}</div></div>`;
            }).join('') : '<p class="hint">No wars.</p>'}
          </section>
          <section>
            <span class="label">TREATIES</span>
            ${allies.length + trade.length ? [...allies.map((id) => ['alliance', id] as const), ...trade.map((id) => ['trade', id] as const)].map(([kind, id]) => `
              <div class="war-row"><div><b>${this.name(id)}</b><span class="mono">${DEAL_NAMES[kind]}</span></div>
              <button type="button" class="claim danger" data-d="cancel" data-nation="${id}" data-pact="${kind}">End</button></div>`).join('')
              : '<p class="hint">No treaties yet.</p>'}
            ${this.vassalsHtml(me)}
            <p class="hint">To propose a trade agreement or an alliance, click a nation on the map and use its panel. AI governments answer at once, by their character and situation; a Diplomacy focus makes them friendlier. Allies are defensive: if someone attacks you, your allies join the war. Peace that cedes land hands over the provinces the winner holds, with their people and output; a nation that loses all its land is annexed.</p>
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
