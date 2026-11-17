// The Diplomacy window: proposals waiting for an answer, treaties in force, and peace terms.
import { DEAL_NAMES, MAX_ALLIANCES, MAX_TRADE_DEALS, TRADE_DEAL_GROWTH, dealText, type Deal, type DealKind, type Pact } from '../../shared/diplomacy';
import type { Game } from './game';
import type { Political } from './political';

export interface DiplomacyActions {
  propose(target: number, deal: Deal): void;
  answer(from: number, deal: DealKind, accept: boolean): void;
  cancel(target: number, pact: Pact): void;
  goToNation(id: number): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class DiplomacyPanel {
  private panel: HTMLElement;

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: DiplomacyActions) {
    this.panel = document.createElement('section');
    this.panel.className = 'panel econ-window diplo-window';
    this.panel.setAttribute('aria-label', 'Diplomacy');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    game.on((c) => { if ((c.has('mine') || c.has('war') || c.has('nations')) && this.isOpen) this.render(); });
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
    else if (d === 'white' || d === 'cede') this.actions.propose(id, { kind: 'peace', terms: d });
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
                ${ours ? `<button type="button" class="claim primary" data-d="cede" data-nation="${foe}" ${sent(foe, 'peace') ? 'disabled' : ''}>Demand the ${ours} province${ours > 1 ? 's' : ''} we hold</button>` : ''}</div></div>`;
            }).join('') : '<p class="hint">No wars.</p>'}
          </section>
          <section>
            <span class="label">TREATIES</span>
            ${allies.length + trade.length ? [...allies.map((id) => ['alliance', id] as const), ...trade.map((id) => ['trade', id] as const)].map(([kind, id]) => `
              <div class="war-row"><div><b>${this.name(id)}</b><span class="mono">${DEAL_NAMES[kind]}</span></div>
              <button type="button" class="claim danger" data-d="cancel" data-nation="${id}" data-pact="${kind}">End</button></div>`).join('')
              : '<p class="hint">No treaties yet.</p>'}
            <p class="hint">To propose a trade agreement or an alliance, click a nation on the map and use its panel. AI governments answer at once, by their character and situation; a Diplomacy focus makes them friendlier. Allies are defensive: if someone attacks you, your allies join the war. Peace that cedes land hands over the provinces the winner holds, with their people and output; a nation that loses all its land is annexed.</p>
          </section>
        </div>
      </div>`;
  }
}
