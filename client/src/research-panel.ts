// The R&D window: the technology tree and the research queue.
import {
  BRANCHES, BRANCH_NAMES, ERA_NAMES, MAX_RESEARCH_QUEUE, MAX_TIER, TECHS, TECH_BY_ID, TIER_COST, pathCost, pathTo, prerequisites, ready,
  type Branch, type Government, type Tech, type TechId,
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

type Tab = 'open' | Branch;

export class ResearchPanel {
  private panel: HTMLElement;
  private tab: Tab = 'open';

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: ResearchActions) {
    this.panel = document.createElement('section');
    this.panel.className = 'panel econ-window research-window';
    keepScrollOn(this.panel); // redraws keep your place in the list
    this.panel.setAttribute('aria-label', 'Research');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    try { const t = localStorage.getItem('sov.researchTab'); if (t === 'open' || BRANCHES.includes(t as Branch)) this.tab = t as Tab; } catch { /* storage blocked */ }
    game.on((c) => { if (c.has('mine') && this.isOpen) this.render(); });
  }

  get isOpen() { return !this.panel.hidden; }
  toggle() { this.panel.hidden = !this.panel.hidden; if (this.isOpen) this.render(); }
  close() { this.panel.hidden = true; }

  private onClick(e: Event) {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!act) return;
    const r = act.dataset.r, id = act.dataset.tech as TechId;
    if (r === 'close') { this.close(); document.dispatchEvent(new CustomEvent('research-closed')); }
    else if (r === 'tab') {
      this.tab = act.dataset.tab as Tab;
      try { localStorage.setItem('sov.researchTab', this.tab); } catch { /* storage blocked */ }
      this.render();
      this.panel.querySelector('.tech-tree')?.scrollIntoView({ block: 'nearest' });
    }
    else if (r === 'tech') this.actions.research(id);
    else if (r === 'queue') this.actions.queue(id);
    else if (r === 'path') {
      // line up everything it needs, prerequisites first, then the technology itself
      const res = this.game.mine?.research;
      if (!res) return;
      const have = new Set<string>([...res.done, ...(res.queue ?? []), ...(res.current ? [res.current] : [])]);
      for (const t of pathTo(TECH_BY_ID.get(id)!, have)) this.actions.queue(t.id);
    }
    else if (r === 'unqueue') this.actions.queue(id, true);
  }

  render() {
    const mine = this.game.mine, r = mine?.research;
    const head = `<div class="econ-head"><div><span class="label">RESEARCH</span><h2>${esc(mine ? this.pol.nations.get(mine.id)?.name ?? '' : 'R&D')}</h2></div><button type="button" class="link" data-r="close">Close</button></div>`;
    if (!mine || !r) {
      this.panel.innerHTML = `${head}<div class="econ-body"><p class="hint">Take command of a nation to direct its research.</p></div>`;
      return;
    }
    const secsPerDay = 86_400 / this.game.speed;
    const rate = Math.max(0.1, r.rate);
    const time = (days: number) => { const s = days * secsPerDay; return s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
    const span = (pts: number) => { const d = pts / rate; return d < 400 ? `~${Math.ceil(d)} days` : `~${(d / 365).toFixed(1)} years`; };
    const cur = r.current ? TECH_BY_ID.get(r.current) : undefined;
    const done = new Set<string>(r.done), queue = r.queue ?? [];
    const lined = new Set<string>([...r.done, ...queue, ...(cur ? [cur.id] : [])]);
    const era = Math.max(0, ...r.done.map((id) => TECH_BY_ID.get(id)?.tier ?? 0));
    const left = pathCost(TECHS.filter((t) => !done.has(t.id)));

    const card = (t: Tech, showBranch = false) => {
      const isDone = done.has(t.id), active = r.current === t.id, slot = queue.indexOf(t.id);
      const canStart = ready(t, done), canQueue = ready(t, lined);
      const path = canQueue ? [] : pathTo(t, lined);
      const room = MAX_RESEARCH_QUEUE - queue.length;
      const needs = prerequisites(t);
      const cost = TIER_COST[t.tier];
      const tipText = tip(t.name, ...effectLines(t.text), `${ERA_NAMES[t.tier]} · tier ${t.tier} · ${cost.toLocaleString('en-US')} research points (${span(cost)})`,
        needs.length ? `Needs ${needs.map((p) => p.name).join(', ')}` : null);
      const needLine = needs.length ? `<span class="needs">Needs ${needs.map((p) => `<i class="${done.has(p.id) ? 'ok' : lined.has(p.id) ? 'lined' : 'no'}">${esc(p.name)}</i>`).join(' · ')}</span>` : '';
      return `<div class="tech${isDone ? ' done' : ''}${active ? ' active' : ''}${slot >= 0 ? ' queued' : ''}${t.capstone ? ' capstone' : ''}${!isDone && !canQueue ? ' locked' : ''}" data-tech="${t.id}" data-tip="${attr(tipText)}">
        <b>${esc(t.name)}</b><span class="mono">${showBranch ? `${esc(BRANCH_NAMES[t.branch])} · ` : ''}Tier ${t.tier} · ${cost.toLocaleString('en-US')} pts</span><span>${esc(t.text)}</span>${isDone ? '' : needLine}
        ${isDone ? '<em>Researched</em>' : active ? `<div class="bar"><i style="width:${Math.round((r.progress / cost) * 100)}%"></i></div>`
          : slot >= 0 ? `<div class="actions-row"><em>Queued #${slot + 1}</em><button type="button" class="claim" data-r="unqueue" data-tech="${t.id}">Remove</button></div>`
          : `<div class="actions-row">${canStart ? `<button type="button" class="claim primary" data-r="tech" data-tech="${t.id}">Research now</button>` : ''}
             ${canQueue ? `<button type="button" class="claim" data-r="queue" data-tech="${t.id}" ${room > 0 ? '' : 'disabled'}>Queue</button>`
               : `<button type="button" class="claim" data-r="path" data-tech="${t.id}" ${path.length <= room ? '' : 'disabled'} data-tip="${attr(tip('Queue the whole path', ...path.map((p) => p.name), `${pathCost(path).toLocaleString('en-US')} points, ${span(pathCost(path))}`))}">Queue with ${path.length - 1} before it</button>`}</div>`}
      </div>`;
    };

    let body: string;
    if (this.tab === 'open') {
      const open = TECHS.filter((t) => !done.has(t.id) && ready(t, done)).sort((a, b) => a.tier - b.tier || BRANCHES.indexOf(a.branch) - BRANCHES.indexOf(b.branch));
      body = open.length ? `<p class="hint">Everything you can research right now: ${open.length} technologies. Each branch's tab shows its whole line, era by era.</p><div class="tech-row">${open.map((t) => card(t, true)).join('')}</div>`
        : '<p class="hint">Every technology is researched. Your scientists have nothing left to learn.</p>';
    } else {
      const b = this.tab;
      const all = TECHS.filter((t) => t.branch === b);
      body = `<p class="hint">${all.filter((t) => done.has(t.id)).length} of ${all.length} researched in ${esc(BRANCH_NAMES[b])}. Technologies that need another branch say so; <b>Queue with … before it</b> lines up the whole path.</p>`
        + Array.from({ length: MAX_TIER }, (_, i) => i + 1).map((tier) => {
          const ts = all.filter((t) => t.tier === tier);
          if (!ts.length) return '';
          return `<div class="era"><span class="label">ERA ${tier} · ${esc(ERA_NAMES[tier].toUpperCase())}</span><div class="tech-row">${ts.map((t) => card(t)).join('')}</div></div>`;
        }).join('');
    }

    const tabs = [['open', `Available`] as [Tab, string], ...BRANCHES.map((b) => [b, BRANCH_NAMES[b]] as [Tab, string])].map(([k, name]) => {
      const n = k === 'open' ? TECHS.filter((t) => !done.has(t.id) && ready(t, done)).length : TECHS.filter((t) => t.branch === k && done.has(t.id)).length;
      const of = k === 'open' ? '' : `/${TECHS.filter((t) => t.branch === k).length}`;
      return `<button type="button" class="chip${this.tab === k ? ' on' : ''}" data-r="tab" data-tab="${k}" aria-pressed="${this.tab === k}">${esc(name)} <b>${n}${of}</b></button>`;
    }).join('');

    this.panel.innerHTML = `${head}
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Researching</span><b>${cur ? esc(cur.name) : '—'}</b><em>${cur ? `${Math.round((r.progress / TIER_COST[cur.tier]) * 100)}% · ${span(TIER_COST[cur.tier] - r.progress)} (${time((TIER_COST[cur.tier] - r.progress) / rate)})` : 'choose a technology below'}</em></div>
          <div><span>Research rate</span><b>${r.rate}</b><em>points a day · raise the research budget in Economy</em></div>
          <div><span>Queue</span><b>${queue.length} / ${MAX_RESEARCH_QUEUE}</b><em>${queue.length ? `${queue.slice(0, 6).map((q, i) => `${i + 1}. ${esc(TECH_BY_ID.get(q)?.name ?? q)}`).join(' → ')}${queue.length > 6 ? ` → +${queue.length - 6} more` : ''} · ${span(pathCost(queue.map((q) => TECH_BY_ID.get(q)!).filter(Boolean)))}` : cur ? 'nothing lined up: research stops after this one' : 'line up technologies below'}</em></div>
          <div><span>Technologies</span><b>${r.done.length} / ${TECHS.length}</b><em>${era ? `reached era ${era}, ${esc(ERA_NAMES[era])}` : 'bonuses are permanent'} · the rest ${span(left)} at this rate</em></div>
        </div>
        <div class="chips tech-tabs" role="group" aria-label="Branches">${tabs}</div>
        <div class="tech-tree">${body}</div>
        <p class="hint">Government, the people, factions and propaganda are in <a href="#" class="go" data-go="module:politics">Politics</a> (O).</p>
      </div>`;
  }
}
