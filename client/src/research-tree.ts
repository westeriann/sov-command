// A branch of the technology tree in a window of its own: its eras run left to
// right, each technology a card linked to the ones it needs, and what it needs
// from other branches named on the card. Opened from a slice of the research
// pie. Room to grow: later versions can draw prettier trees here without
// touching the R&D list.
import {
  BRANCH_NAMES, ERA_NAMES, MAX_RESEARCH_QUEUE, MAX_TIER, TECHS, TECH_BY_ID, pathCost, pathTo, prerequisites, ready, techCost,
  type Branch, type Tech,
} from '../../shared/research';
import type { Game } from './game';
import { attr, tip } from './tooltip';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface TreeActions {
  research(id: string): void;
  queue(id: string): void;
  unqueue(id: string): void;
}

const COL_W = 210, COL_GAP = 54, CARD_H = 112, ROW_GAP = 18, TOP = 34, LEFT = 18;

export class BranchWindow {
  private el: HTMLElement;
  private branch: Branch | null = null;

  constructor(root: HTMLElement, private game: Game, private act: TreeActions) {
    this.el = document.createElement('section');
    this.el.className = 'panel branch-window';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.hidden) { e.stopImmediatePropagation(); this.close(); } }, true);
    game.on((c) => { if (c.has('mine') && !this.el.hidden) this.render(); });
  }

  get isOpen() { return !this.el.hidden; }

  open(b: Branch) {
    const fresh = this.branch !== b;
    this.branch = b;
    this.el.hidden = false;
    this.render();
    if (fresh) {
      // start where the work is: the furthest era you have reached in this branch
      const done = new Set(this.game.mine?.research?.done ?? []);
      const reached = Math.max(0, ...TECHS.filter((t) => t.branch === b && done.has(t.id)).map((t) => t.tier));
      const sc = this.el.querySelector<HTMLElement>('.bw-scroll');
      if (sc) sc.scrollLeft = Math.max(0, (reached - 1) * (COL_W + COL_GAP));
    }
  }

  close() { this.el.hidden = true; }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bw]');
    if (!t) return;
    const id = t.dataset.tech ?? '';
    const a = t.dataset.bw;
    if (a === 'close') this.close();
    else if (a === 'now') this.act.research(id);
    else if (a === 'queue') this.act.queue(id);
    else if (a === 'unqueue') this.act.unqueue(id);
    else if (a === 'path') {
      const r = this.game.mine?.research;
      if (!r) return;
      const have = new Set<string>([...r.done, ...(r.queue ?? []), ...(r.current ? [r.current] : [])]);
      for (const x of pathTo(TECH_BY_ID.get(id)!, have)) this.act.queue(x.id);
    } else if (a === 'goto') {
      const tech = TECH_BY_ID.get(id);
      if (tech) this.open(tech.branch);
    }
  }

  render() {
    const b = this.branch, r = this.game.mine?.research;
    if (!b) return;
    const settings = this.game.settings;
    const techs = TECHS.filter((t) => t.branch === b);
    const done = new Set<string>(r?.done ?? []), queue = r?.queue ?? [];
    const lined = new Set<string>([...done, ...queue, ...(r?.current ? [r.current] : [])]);
    const rate = Math.max(0.1, r?.rate ?? 1);
    const span = (pts: number) => { const d = pts / rate; return d < 400 ? `~${Math.ceil(d)} days` : `~${(d / 365).toFixed(1)} years`; };

    // where each card stands: a column per era, cards stacked within it
    const pos = new Map<string, { x: number; y: number }>();
    let rows = 1;
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const col = techs.filter((t) => t.tier === tier);
      rows = Math.max(rows, col.length);
      col.forEach((t, i) => pos.set(t.id, { x: LEFT + (tier - 1) * (COL_W + COL_GAP), y: TOP + i * (CARD_H + ROW_GAP) }));
    }
    const width = LEFT * 2 + MAX_TIER * COL_W + (MAX_TIER - 1) * COL_GAP, height = TOP + rows * (CARD_H + ROW_GAP) + 10;

    const state = (t: Tech) => done.has(t.id) ? 'done' : r?.current === t.id ? 'current' : queue.includes(t.id) ? 'queued' : ready(t, done) ? 'open' : 'locked';
    const links = techs.flatMap((t) => prerequisites(t).filter((p) => p.branch === b).map((p) => {
      const a = pos.get(p.id)!, z = pos.get(t.id)!;
      const x1 = a.x + COL_W, y1 = a.y + CARD_H / 2, x2 = z.x, y2 = z.y + CARD_H / 2, mx = (x1 + x2) / 2;
      return `<path class="bw-link ${done.has(p.id) ? 'lit' : ''}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`;
    })).join('');
    const eras = Array.from({ length: MAX_TIER }, (_, i) => `<div class="bw-era" style="left:${LEFT + i * (COL_W + COL_GAP)}px;width:${COL_W}px"><b>ERA ${i + 1}</b> ${esc(ERA_NAMES[i + 1])}</div>`).join('');
    const room = MAX_RESEARCH_QUEUE - queue.length;
    const cards = techs.map((t) => {
      const p = pos.get(t.id)!, s = state(t), cost = techCost(t.tier, settings);
      const outside = prerequisites(t).filter((x) => x.branch !== b);
      const path = s === 'locked' && !ready(t, lined) ? pathTo(t, lined) : [];
      const progress = s === 'current' ? Math.min(1, (r?.progress ?? 0) / cost) : 0;
      const slot = queue.indexOf(t.id);
      const button = s === 'done' ? '<em>Researched</em>'
        : s === 'current' ? `<span class="bw-bar"><i style="width:${Math.round(progress * 100)}%"></i></span>`
        : s === 'queued' ? `<em>Queued #${slot + 1}</em> <button type="button" class="link" data-bw="unqueue" data-tech="${t.id}">Remove</button>`
        : s === 'open' ? `<button type="button" class="claim primary" data-bw="now" data-tech="${t.id}">Research</button><button type="button" class="claim" data-bw="queue" data-tech="${t.id}" ${room > 0 ? '' : 'disabled'}>Queue</button>`
        : ready(t, lined) ? `<button type="button" class="claim" data-bw="queue" data-tech="${t.id}" ${room > 0 ? '' : 'disabled'}>Queue</button>`
        : `<button type="button" class="claim" data-bw="path" data-tech="${t.id}" ${path.length <= room ? '' : 'disabled'} data-tip="${attr(tip('Queue the whole path', ...path.map((x) => x.name), `${pathCost(path, settings).toLocaleString('en-US')} points, ${span(pathCost(path, settings))}`))}">Queue path (${path.length})</button>`;
      return `<div class="bw-card ${s}${t.capstone ? ' capstone' : ''}" style="left:${p.x}px;top:${p.y}px;width:${COL_W}px;height:${CARD_H}px" data-tip="${attr(tip(t.name, t.text, `${cost.toLocaleString('en-US')} research points · ${span(cost)}`))}">
        <b>${esc(t.name)}</b><span class="bw-fx">${esc(t.text)}</span>
        ${outside.length ? `<span class="bw-out">Needs ${outside.map((x) => `<button type="button" class="link ${done.has(x.id) ? 'ok' : 'no'}" data-bw="goto" data-tech="${x.id}">${esc(x.name)}</button>`).join(', ')}</span>` : ''}
        <span class="bw-act">${button}</span></div>`;
    }).join('');
    const count = techs.filter((t) => done.has(t.id)).length;
    const sc = this.el.querySelector<HTMLElement>('.bw-scroll');
    const keep = sc ? [sc.scrollLeft, sc.scrollTop] : [0, 0];
    this.el.setAttribute('aria-label', `${BRANCH_NAMES[b]} research`);
    this.el.innerHTML = `<div class="econ-head"><div><span class="label">RESEARCH BRANCH · ${count} OF ${techs.length}</span><h2>${esc(BRANCH_NAMES[b])}</h2></div>
        <button type="button" class="link" data-bw="close">Close</button></div>
      <div class="bw-scroll"><div class="bw-canvas" style="width:${width}px;height:${height}px">
        ${eras}<svg class="bw-links" width="${width}" height="${height}" aria-hidden="true">${links}</svg>${cards}</div></div>
      <p class="hint bw-foot">Scroll sideways through the eras. Names under "Needs" are in other branches: click one to open its branch. ${r ? `Research rate ${r.rate} points a day.` : ''}</p>`;
    const nsc = this.el.querySelector<HTMLElement>('.bw-scroll')!;
    nsc.scrollLeft = keep[0]; nsc.scrollTop = keep[1];
  }
}
