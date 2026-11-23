// The R&D window: the technology tree and the research queue.
import {
  BRANCHES, BRANCH_NAMES, MAX_RESEARCH_QUEUE, TECHS, TIER_COST, prerequisite,
  type Government, type TechId,
} from '../../shared/research';
import type { Game } from './game';
import type { PropagandaMode } from '../../shared/society';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';
import { attr, effectLines, tip } from './tooltip';

export interface ResearchActions {
  research(tech: TechId): void;
  queue(tech: TechId, remove?: boolean): void;
  government(g: Government): void;
  propaganda(mode: PropagandaMode, target?: number): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class ResearchPanel {
  private panel: HTMLElement;

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: ResearchActions) {
    this.panel = document.createElement('section');
    this.panel.className = 'panel econ-window research-window';
    keepScrollOn(this.panel); // redraws keep your place in the list
    this.panel.setAttribute('aria-label', 'Research');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    game.on((c) => { if (c.has('mine') && this.isOpen) this.render(); });
  }

  get isOpen() { return !this.panel.hidden; }
  toggle() { this.panel.hidden = !this.panel.hidden; if (this.isOpen) this.render(); }
  close() { this.panel.hidden = true; }

  private onClick(e: Event) {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!act) return;
    const r = act.dataset.r;
    if (r === 'close') { this.close(); document.dispatchEvent(new CustomEvent('research-closed')); }
    else if (r === 'tech') this.actions.research(act.dataset.tech as TechId);
    else if (r === 'queue') this.actions.queue(act.dataset.tech as TechId);
    else if (r === 'unqueue') this.actions.queue(act.dataset.tech as TechId, true);

  }

  render() {
    const mine = this.game.mine, r = mine?.research;
    const head = `<div class="econ-head"><div><span class="label">RESEARCH</span><h2>${esc(mine ? this.pol.nations.get(mine.id)?.name ?? '' : 'R&D')}</h2></div><button type="button" class="link" data-r="close">Close</button></div>`;
    if (!mine || !r) {
      this.panel.innerHTML = `${head}<div class="econ-body"><p class="hint">Take command of a nation to direct its research.</p></div>`;
      return;
    }
    const secsPerDay = 86_400 / this.game.speed;
    const time = (days: number) => { const s = days * secsPerDay; return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`; };
    const cur = r.current ? TECHS.find((t) => t.id === r.current) : undefined;

    this.panel.innerHTML = `${head}
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Researching</span><b>${cur ? esc(cur.name) : '—'}</b><em>${cur ? `${Math.round((r.progress / TIER_COST[cur.tier]) * 100)}% · ~${Math.ceil((TIER_COST[cur.tier] - r.progress) / Math.max(0.1, r.rate))} days (${time((TIER_COST[cur.tier] - r.progress) / Math.max(0.1, r.rate))})` : 'choose a technology below'}</em></div>
          <div><span>Research rate</span><b>${r.rate}</b><em>points a day · raise the research budget in Economy</em></div>
          <div><span>Queue</span><b>${(r.queue ?? []).length} / ${MAX_RESEARCH_QUEUE}</b><em>${(r.queue ?? []).length ? (r.queue ?? []).map((q, i) => `${i + 1}. ${esc(TECHS.find((t) => t.id === q)!.name)}`).join(' → ') : cur ? 'nothing lined up: research stops after this one' : 'line up technologies below'}</em></div>
          <div><span>Technologies</span><b>${r.done.length} / ${TECHS.length}</b><em>bonuses are permanent</em></div>
        </div>
        <div class="tech-grid">
          ${BRANCHES.map((b) => `<section><span class="label">${BRANCH_NAMES[b].toUpperCase()}</span>
            ${TECHS.filter((t) => t.branch === b).map((t) => {
              const done = r.done.includes(t.id), active = r.current === t.id;
              const pre = prerequisite(t), locked = !!pre && !r.done.includes(pre.id);
              const queue = r.queue ?? [], slot = queue.indexOf(t.id);
              // can line it up once its prerequisite is known, under way, or already in the queue
              const queueable = !pre || r.done.includes(pre.id) || r.current === pre.id || queue.includes(pre.id);
              const tipText = tip(t.name, ...effectLines(t.text), `Tier ${t.tier} · ${TIER_COST[t.tier].toLocaleString('en-US')} research points`, pre ? `Needs ${pre.name}` : null);
              return `<div class="tech${done ? ' done' : ''}${active ? ' active' : ''}${slot >= 0 ? ' queued' : ''}" data-tip="${attr(tipText)}">
                <b>${esc(t.name)}</b><span class="mono">Tier ${t.tier} · ${TIER_COST[t.tier].toLocaleString('en-US')} pts</span><span>${esc(t.text)}</span>
                ${done ? '<em>Researched</em>' : active ? `<div class="bar"><i style="width:${Math.round((r.progress / TIER_COST[t.tier]) * 100)}%"></i></div>`
                  : slot >= 0 ? `<div class="actions-row"><em>Queued #${slot + 1}</em><button type="button" class="claim" data-r="unqueue" data-tech="${t.id}">Remove</button></div>`
                  : `<div class="actions-row">${locked ? '' : `<button type="button" class="claim primary" data-r="tech" data-tech="${t.id}">Research now</button>`}
                     <button type="button" class="claim" data-r="queue" data-tech="${t.id}" ${queueable && queue.length < MAX_RESEARCH_QUEUE ? '' : 'disabled'}>${queueable ? 'Queue' : `Needs ${esc(pre!.name)}`}</button></div>`}
              </div>`;
            }).join('')}</section>`).join('')}
        </div>
        <p class="hint">Government, the people, factions and propaganda are in <a href="#" class="go" data-go="module:politics">Politics</a> (O).</p>
      </div>`;
  }
}
