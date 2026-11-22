// The R&D window: the technology tree and the form of government.
import {
  BRANCHES, BRANCH_NAMES, GOVERNMENTS, GOVERNMENT_INFO, REFORM_COOLDOWN_DAYS, TECHS, TIER_COST, prerequisite,
  type Government, type TechId,
} from '../../shared/research';
import type { Game } from './game';
import { FACTIONS, FACTION_INFO, PROPAGANDA_COST, type PropagandaMode } from '../../shared/society';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';

export interface ResearchActions {
  research(tech: TechId): void;
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
    this.panel.setAttribute('aria-label', 'Research and government');
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
    else if (r === 'prop') {
      const mode = act.dataset.mode as PropagandaMode;
      const target = mode === 'abroad' ? Number((this.panel.querySelector('#propTarget') as HTMLSelectElement).value) : undefined;
      this.actions.propaganda(mode, target);
    } else if (r === 'gov') {
      if (act.dataset.confirm === '1') this.actions.government(act.dataset.gov as Government);
      else { act.dataset.confirm = '1'; act.textContent = 'Confirm reform'; }
    }
  }

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
          <button type="button" class="claim${s.propaganda.mode === 'off' ? ' primary' : ''}" data-r="prop" data-mode="off">None</button>
          <button type="button" class="claim${s.propaganda.mode === 'home' ? ' primary' : ''}" data-r="prop" data-mode="home" title="+4 stability; people drift toward your government three times as fast">At home</button>
          <select id="propTarget" class="text-input" aria-label="Target nation">${nations.map((n) => `<option value="${n.id}"${n.id === s.propaganda.target ? ' selected' : ''}>${esc(n.name)}</option>`).join('')}</select>
          <button type="button" class="claim${s.propaganda.mode === 'abroad' ? ' primary' : ''}" data-r="prop" data-mode="abroad" title="Erodes their stability and pulls their people toward your values">Abroad</button>
        </div>
      </section>
      <section>
        <span class="label">FACTIONS</span>
        ${FACTIONS.map((f) => {
          const v = Math.round(s.factions[f]);
          const mood = v > 75 ? `<span class="up">pleased: ${FACTION_INFO[f].happy}</span>` : v < 25 ? `<span class="down">angry: ${FACTION_INFO[f].angry}</span>` : 'content';
          return `<div class="faction"><b>${FACTION_INFO[f].name}</b><div class="bar"><i style="width:${v}%"></i></div><span class="mono">${v}</span><span class="hint">Wants ${FACTION_INFO[f].wants}. ${mood}.</span></div>`;
        }).join('')}
        <p class="hint">Stability under 15% with an angry public or army can end in civil war.</p>
      </section>
    </div>`;
  }

  render() {
    const mine = this.game.mine, r = mine?.research;
    const head = `<div class="econ-head"><div><span class="label">RESEARCH &amp; GOVERNMENT</span><h2>${esc(mine ? this.pol.nations.get(mine.id)?.name ?? '' : 'R&D')}</h2></div><button type="button" class="link" data-r="close">Close</button></div>`;
    if (!mine || !r) {
      this.panel.innerHTML = `${head}<div class="econ-body"><p class="hint">Take command of a nation to direct its research.</p></div>`;
      return;
    }
    const day = this.game.market?.day ?? 0;
    const secsPerDay = 86_400 / this.game.speed;
    const time = (days: number) => { const s = days * secsPerDay; return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`; };
    const cur = r.current ? TECHS.find((t) => t.id === r.current) : undefined;
    const reforming = r.reformUntil !== undefined;
    const cooldown = r.reformedAt !== undefined ? Math.max(0, REFORM_COOLDOWN_DAYS - (day - r.reformedAt)) : 0;
    const gov = GOVERNMENT_INFO[r.government];

    this.panel.innerHTML = `${head}
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Researching</span><b>${cur ? esc(cur.name) : '—'}</b><em>${cur ? `${Math.round((r.progress / TIER_COST[cur.tier]) * 100)}% · ~${Math.ceil((TIER_COST[cur.tier] - r.progress) / Math.max(0.1, r.rate))} days (${time((TIER_COST[cur.tier] - r.progress) / Math.max(0.1, r.rate))})` : 'choose a technology below'}</em></div>
          <div><span>Research rate</span><b>${r.rate}</b><em>points a day · raise the research budget in Economy</em></div>
          <div><span>Technologies</span><b>${r.done.length} / ${TECHS.length}</b><em>bonuses are permanent</em></div>
          <div><span>Government</span><b>${esc(gov.name)}</b><em>${reforming ? `reform under way · ${r.reformUntil! - day} days left` : cooldown ? `next reform in ${cooldown} days` : 'reform possible'}${r.nextElection !== undefined && r.government === 'democracy' ? ` · election in ${Math.max(0, r.nextElection - day)} days` : ''}${(r.oppositionUntil ?? -1) > day ? ` · opposition parliament for ${r.oppositionUntil! - day} days` : ''}</em></div>
        </div>
        <div class="tech-grid">
          ${BRANCHES.map((b) => `<section><span class="label">${BRANCH_NAMES[b].toUpperCase()}</span>
            ${TECHS.filter((t) => t.branch === b).map((t) => {
              const done = r.done.includes(t.id), active = r.current === t.id;
              const pre = prerequisite(t), locked = !!pre && !r.done.includes(pre.id);
              return `<div class="tech${done ? ' done' : ''}${active ? ' active' : ''}">
                <b>${esc(t.name)}</b><span class="mono">Tier ${t.tier} · ${TIER_COST[t.tier].toLocaleString('en-US')} pts</span><span>${esc(t.text)}</span>
                ${done ? '<em>Researched</em>' : active ? `<div class="bar"><i style="width:${Math.round((r.progress / TIER_COST[t.tier]) * 100)}%"></i></div>`
                  : `<button type="button" class="claim" data-r="tech" data-tech="${t.id}" ${locked ? 'disabled' : ''}>${locked ? `Needs ${esc(pre!.name)}` : 'Research'}</button>`}
              </div>`;
            }).join('')}</section>`).join('')}
        </div>
        ${this.societyHtml()}
        <span class="label">FORM OF GOVERNMENT</span>
        <div class="gov-grid">
          ${GOVERNMENTS.map((g) => `<div class="tech${g === r.government ? ' active' : ''}"><b>${esc(GOVERNMENT_INFO[g].name)}</b><span>${esc(GOVERNMENT_INFO[g].text)}</span>
            ${g === r.government ? '<em>Current</em>' : `<button type="button" class="claim" data-r="gov" data-gov="${g}" ${reforming || cooldown ? 'disabled' : ''}>Reform</button>`}</div>`).join('')}
        </div>
        <p class="hint">A reform takes 30 game days (5 minutes) of turmoil, −10 stability meanwhile, and the next is possible a game year later. Stability below 25 risks a coup or revolution. Random national events (booms, strikes, disasters, scandals, breakthroughs) appear in Dispatches.</p>
      </div>`;
  }
}
