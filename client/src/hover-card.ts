// A small card that follows the mouse over foreign land: who rules it, what they
// think of you, and the treaties and quarrels between you.
import { PACTS, PACT_INFO, opinionWord } from '../../shared/diplomacy';
import { GOVERNMENT_INFO } from '../../shared/research';
import type { Game } from './game';
import type { Political, Province } from './political';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class HoverCard {
  private el: HTMLElement;
  private shown: number | null = null;
  private timer = 0;

  constructor(root: HTMLElement, private game: Game, private pol: Political) {
    this.el = document.createElement('div');
    this.el.className = 'hover-card';
    this.el.hidden = true;
    root.appendChild(this.el);
  }

  /** The mouse is over this province at (x, y) in the page; null hides the card. */
  move(p: Province | undefined, x: number, y: number) {
    const me = this.game.mine?.id;
    const id = p?.kind === 'land' ? p.nation ?? null : null;
    if (id === null || me === undefined || id === me) { this.hide(); return; }
    this.el.style.left = `${Math.min(innerWidth - 270, x + 18)}px`;
    this.el.style.top = `${Math.min(innerHeight - 160, y + 18)}px`;
    if (id === this.shown) return;
    this.shown = id;
    window.clearTimeout(this.timer);
    this.el.hidden = true;
    // a short pause, so sweeping across the map does not flicker cards
    this.timer = window.setTimeout(() => { this.render(id); this.el.hidden = false; }, 300);
  }

  hide() { window.clearTimeout(this.timer); this.shown = null; this.el.hidden = true; }

  private render(id: number) {
    const g = this.game, me = g.mine!.id, w = g.war, n = this.pol.nations.get(id);
    if (!n) return;
    const pub = g.nations.get(id), o = g.mine?.relations?.[id];
    const atWar = w.wars.some((x) => (x.a === me && x.b === id) || (x.b === me && x.a === id));
    const ties = PACTS.filter((k) => w.treaties.some((t) => t.kind === k && (k === 'guarantee' ? (t.a === me && t.b === id) || (t.a === id && t.b === me) : (t.a === me && t.b === id) || (t.b === me && t.a === id))))
      .map((k) => PACT_INFO[k].name);
    const claim = g.mine?.politics?.claims.includes(id);
    const embargo = w.embargoes.some((e) => (e.from === me && e.to === id) || (e.from === id && e.to === me));
    this.el.innerHTML = `<b>${esc(n.name)}</b>
      <span class="muted">${pub?.government ? GOVERNMENT_INFO[pub.government].name : ''}${pub?.controller === 'human' ? ` · led by ${esc(pub.player ?? 'a player')}` : ''}</span>
      ${o ? `<span>Their opinion of you: <b class="${o.total >= 10 ? 'up' : o.total <= -10 ? 'down' : ''}">${opinionWord(o.total)} ${o.total > 0 ? '+' : ''}${o.total}</b></span>` : ''}
      ${atWar ? '<span class="down"><b>At war with you</b></span>' : ''}
      ${ties.length ? `<span class="up">${ties.map(esc).join(' · ')}</span>` : ''}
      ${claim ? '<span>You hold a claim on them</span>' : ''}${embargo ? '<span class="down">Embargo</span>' : ''}
      <em>Click for their panel · P for Diplomacy</em>`;
  }
}
