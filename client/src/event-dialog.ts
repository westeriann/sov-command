import { art } from './art-icons';
// A decision: an event happened to your nation; choose how to answer. The
// dialog can be set aside and reopened from the alert icon; unanswered, the
// first option is taken when time runs out.
import { EVENTS, EVENT_DAYS } from '../../shared/events';
import type { Order } from '../../shared/protocol';
import type { Change, Game } from './game';
import type { Political } from './political';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class EventDialog {
  private el: HTMLElement;
  private shownFor = ''; // the event we last showed, so setting it aside sticks
  onShow: () => void = () => {};
  /** You answered: a different sound from the one that announced it. */
  onChoose: () => void = () => {};

  constructor(root: HTMLElement, private game: Game, private pol: Political, private order: (o: Order) => void) {
    this.el = document.createElement('div');
    this.el.className = 'modal-backdrop event-dialog';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-ev]');
      if (!t) return;
      if (t.dataset.ev === 'later') { this.el.hidden = true; return; }
      const ev = this.game.mine?.event;
      if (ev) { this.order({ kind: 'choose', event: ev.key, option: Number(t.dataset.ev) }); this.onChoose(); }
      this.el.hidden = true;
    });
    game.on((c: Set<Change>) => {
      if (!c.has('mine')) return;
      const ev = this.game.mine?.event;
      const id = ev ? `${ev.key}:${ev.day}` : '';
      if (!ev) { this.el.hidden = true; this.shownFor = ''; return; }
      if (id !== this.shownFor && !document.body.classList.contains('menu-open')) { this.shownFor = id; this.open(); }
    });
  }

  get pending() { return !!this.game.mine?.event; }

  open() {
    const ev = this.game.mine?.event;
    if (!ev) return;
    const def = EVENTS[ev.key];
    const left = Math.max(0, EVENT_DAYS - ((this.game.market?.day ?? ev.day) - ev.day));
    const about = ev.about !== undefined ? this.pol.nations.get(ev.about)?.name : undefined;
    this.el.innerHTML = `<div class="panel modal event-card" role="dialog" aria-label="${esc(def.title)}">
      <div class="event-art" aria-hidden="true">${art(ev.key)}</div>
      <span class="label">DECISION · ${left} days to answer</span>
      <h2>${esc(def.title)}</h2>
      <p>${esc(def.text)}${about ? ` <b>(${esc(about)})</b>` : ''}</p>
      <div class="event-options">${def.options.map((o, i) => `<button type="button" class="event-option" data-ev="${i}"><b>${esc(o.text)}</b>
        <ul>${o.effects.map(([t, k]) => `<li class="${k === 'good' ? 'up' : k === 'bad' ? 'down' : ''}">${esc(t)}</li>`).join('')}</ul></button>`).join('')}</div>
      <div class="actions-row"><button type="button" class="link" data-ev="later">Decide later (the first option is taken if time runs out)</button></div></div>`;
    this.el.hidden = false;
    this.onShow();
  }
}
