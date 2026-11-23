// The war room: declaring war with a war goal, and the peace conference where
// the winner chooses terms and pays for them with war score.
import { WAR_GOALS, type WarGoal } from '../../shared/military';
import { MAX_REPARATIONS, PEACE_COST, REPARATION_YEARS, DEMIL_YEARS, treatyCost, type PeaceTreaty } from '../../shared/peace';
import { GOVERNMENTS, GOVERNMENT_INFO, type Government } from '../../shared/research';
import { WAR_SUPPORT } from '../../shared/politics';
import type { Order } from '../../shared/protocol';
import type { Game } from './game';
import type { Political } from './political';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class WarRoom {
  private el: HTMLElement;
  private mode: 'declare' | 'peace' = 'declare';
  private target = 0;
  private goal: WarGoal = 'conquest';
  private treaty: PeaceTreaty = { provinces: [], reparations: 0, demilitarize: false };

  constructor(root: HTMLElement, private game: Game, private pol: Political, private order: (o: Order) => void) {
    this.el = document.createElement('div');
    this.el.className = 'modal-backdrop war-room';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) { this.close(); return; }
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
      if (!t) return;
      const a = t.dataset.w;
      if (a === 'close') this.close();
      else if (a === 'goal') { this.goal = t.dataset.goal as WarGoal; this.render(); }
      else if (a === 'declare') { this.order({ kind: 'war', target: this.target, goal: this.goal }); this.close(); }
      else if (a === 'white') { this.order({ kind: 'peace', target: this.target }); this.close(); }
      else if (a === 'propose') { this.order({ kind: 'propose', target: this.target, deal: { kind: 'peace', terms: 'treaty', treaty: this.treaty } }); this.close(); }
      else if (a === 'all') { this.treaty.provinces = this.occupied(); this.render(); }
      else if (a === 'none') { this.treaty.provinces = []; this.render(); }
    });
    this.el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.prov) {
        const p = Number(t.dataset.prov);
        this.treaty.provinces = t.checked ? [...this.treaty.provinces, p] : this.treaty.provinces.filter((x) => x !== p);
      } else if (t.id === 'trRep') this.treaty.reparations = Number(t.value) / 1000;
      else if (t.id === 'trDemil') this.treaty.demilitarize = t.checked;
      else if (t.id === 'trPuppet') this.treaty.puppet = t.checked;
      else if (t.id === 'trRegime') this.treaty.regime = (t.value || undefined) as Government | undefined;
      this.render();
    });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'trRep') { this.treaty.reparations = Number(t.value) / 1000; this.renderCost(); }
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.hidden) { e.stopImmediatePropagation(); this.close(); } }, true);
    game.on((c) => { if (!this.el.hidden && (c.has('war') || c.has('mine')) && this.mode === 'peace' && !this.game.atWar(this.game.mine?.id ?? -1, this.target)) this.close(); });
  }

  declare(target: number) { this.mode = 'declare'; this.target = target; this.goal = 'conquest'; this.open(); }
  peace(target: number) {
    this.mode = 'peace'; this.target = target;
    this.treaty = { provinces: this.occupied(), reparations: 0, demilitarize: false };
    // start from terms the war score can pay for
    while (this.treaty.provinces.length && this.cost() > Math.max(0, this.score())) this.treaty.provinces.pop();
    this.open();
  }

  private open() { this.el.hidden = false; this.render(); }
  close() { this.el.hidden = true; }

  private foeProvinces() { return [...this.pol.provinces.values()].filter((p) => p.kind === 'land' && p.nation === this.target); }
  private occupied() {
    const me = this.game.mine?.id;
    return this.foeProvinces().filter((p) => this.game.war.occupied[p.id] === me && p.id !== this.pol.nations.get(this.target)?.capital).sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0)).map((p) => p.id);
  }
  private score() { return this.game.mine?.warScores?.[this.target] ?? 0; }
  private ourGoal() {
    const me = this.game.mine?.id;
    return this.game.war.wars.find((w) => w.a === me && w.b === this.target)?.goal;
  }
  private cost() {
    const total = this.foeProvinces().reduce((s, p) => s + (p.pop ?? 0), 0) || 1;
    return treatyCost(this.treaty, (id) => (this.pol.provinces.get(id)?.pop ?? 0) / total, this.ourGoal());
  }

  private renderCost() {
    const c = this.cost(), s = this.score();
    const el = this.el.querySelector('.tr-cost');
    if (el) el.innerHTML = this.costHtml(c, s);
    const out = this.el.querySelector('#trRepOut');
    if (out) out.textContent = `${(this.treaty.reparations * 100).toFixed(1)}%`;
  }

  private costHtml(c: number, s: number) {
    const ok = c <= Math.max(0, s) + 5;
    return `<span>Terms cost <b>${c}</b> war score · you have <b class="${s >= 0 ? 'up' : 'down'}">${s > 0 ? '+' : ''}${s}</b></span>
      <span class="${ok ? 'up' : 'down'}">${ok ? 'An AI government will likely accept' : 'An AI government will refuse unless its position is desperate'}</span>`;
  }

  private render() {
    const n = this.pol.nations.get(this.target), mine = this.game.mine;
    if (!n || !mine) { this.close(); return; }
    const head = (title: string) => `<div class="econ-head"><div><span class="label">${title}</span><h2>${esc(n.name)}</h2></div><button type="button" class="link" data-w="close">Close</button></div>`;
    if (this.mode === 'declare') {
      const p = mine.politics, vote = (p?.legislature === 'parliament' || p?.legislature === 'council') && !p.emergencyUntil;
      const claim = p?.claims.includes(this.target);
      const pact = this.game.war.treaties.some((t) => t.kind === 'nap' && ((t.a === mine.id && t.b === this.target) || (t.b === mine.id && t.a === this.target)));
      const guards = this.game.war.treaties.filter((t) => t.kind === 'guarantee' && t.b === this.target).map((t) => this.pol.nations.get(t.a)?.name).filter(Boolean);
      const allies = this.game.war.treaties.filter((t) => t.kind === 'alliance' && (t.a === this.target || t.b === this.target)).map((t) => this.pol.nations.get(t.a === this.target ? t.b : t.a)?.name).filter(Boolean);
      this.el.innerHTML = `<div class="panel modal">${head('DECLARE WAR')}
        <span class="label">WAR GOAL · terms matching it cost half at the peace table</span>
        <div class="goal-grid">${(Object.keys(WAR_GOALS) as WarGoal[]).map((g) => `<button type="button" class="claim${this.goal === g ? ' primary' : ''}" data-w="goal" data-goal="${g}"><b>${WAR_GOALS[g].name}</b><span>${esc(WAR_GOALS[g].text)}</span></button>`).join('')}</div>
        <span class="label">WHAT FOLLOWS</span>
        <ul class="consequences">
          ${vote ? `<li class="${(p?.support ?? 0) >= (claim ? 25 : WAR_SUPPORT) ? 'up' : 'down'}">Parliament must back it: support ${p?.support ?? 0}%, needs ${claim ? 25 : WAR_SUPPORT}%${claim ? ' (you hold a claim)' : ''}</li>` : '<li>No vote needed: you rule by decree or emergency powers</li>'}
          ${claim ? '<li class="up">A justified war: the world condemns you far less</li>' : '<li class="down">Every nation will think less of you</li>'}
          ${pact ? '<li class="down"><b>You have a non-aggression pact: breaking it is a betrayal the whole world remembers</b></li>' : ''}
          ${allies.length ? `<li class="down">Their allies join against you: ${allies.map((x) => esc(x!)).join(', ')}</li>` : ''}
          ${guards.length ? `<li class="down">Their guarantors join against you: ${guards.map((x) => esc(x!)).join(', ')}</li>` : ''}
          <li>All treaties and contracts between you end</li>
        </ul>
        <div class="actions-row"><button type="button" class="claim danger" data-w="declare">Declare war: ${WAR_GOALS[this.goal].name.toLowerCase()}</button><button type="button" class="claim" data-w="close">Not now</button></div></div>`;
      return;
    }
    const s = this.score(), goal = this.ourGoal();
    const total = this.foeProvinces().reduce((sum, p) => sum + (p.pop ?? 0), 0) || 1;
    const occ = new Set(this.occupied());
    const provs = this.foeProvinces().filter((p) => p.id !== n.capital).sort((a, b) => Number(occ.has(b.id)) - Number(occ.has(a.id)) || (b.pop ?? 0) - (a.pop ?? 0)).slice(0, 40);
    const half = (g: WarGoal) => (goal === g ? 0.5 : 1);
    const pc = (p: number) => Math.round(PEACE_COST.province((this.pol.provinces.get(p)?.pop ?? 0) / total) * half('conquest'));
    this.el.innerHTML = `<div class="panel modal wide">${head('PEACE CONFERENCE')}
      <div class="score-bar"><i class="${s >= 0 ? 'pos' : 'neg'}" style="${s >= 0 ? 'left:50%' : `left:${50 + s / 2}%`};width:${Math.abs(s) / 2}%"></i></div>
      <p class="hint">War score ${s > 0 ? '+' : ''}${s}: land you hold of theirs, battles won and divisions destroyed.${goal ? ` Your war goal, <b>${WAR_GOALS[goal].name.toLowerCase()}</b>, makes matching terms cost half.` : ''} Players answer in their own time; AI governments accept terms their war score can pay for.</p>
      <div class="econ-cols"><section>
        <span class="label">PROVINCES · land you hold first <button type="button" class="link" data-w="all">all held</button> <button type="button" class="link" data-w="none">none</button></span>
        <div class="tr-provs">${provs.map((p) => `<label class="check"><input type="checkbox" data-prov="${p.id}" ${this.treaty.provinces.includes(p.id) ? 'checked' : ''}>${esc(p.name)}${occ.has(p.id) ? ' <span class="pill ok">held</span>' : ''}<span class="mono">${pc(p.id)}</span></label>`).join('') || '<p class="hint">No provinces to take.</p>'}</div>
      </section><section>
        <span class="label">OTHER TERMS</span>
        <div class="slider"><label for="trRep"><span>REPARATIONS · ${REPARATION_YEARS} YEARS · ${Math.round(PEACE_COST.reparationsPerPct * half('reparations'))} PER 1%</span><output id="trRepOut">${(this.treaty.reparations * 100).toFixed(1)}%</output></label>
          <input id="trRep" type="range" min="0" max="${MAX_REPARATIONS * 1000}" step="5" value="${Math.round(this.treaty.reparations * 1000)}"></div>
        <label class="check"><input type="checkbox" id="trDemil" ${this.treaty.demilitarize ? 'checked' : ''}>Demilitarise their border for ${DEMIL_YEARS} years · ${Math.round(PEACE_COST.demilitarize * half('humiliate'))}</label>
        <label class="check"><input type="checkbox" id="trPuppet" ${this.treaty.puppet ? 'checked' : ''}>Make them your vassal · ${Math.round(PEACE_COST.puppet * half('subjugate'))}</label>
        <label class="check">Impose a government · ${Math.round(PEACE_COST.regime * half('regime'))}
          <select id="trRegime"><option value="">(keep theirs)</option>${GOVERNMENTS.map((g) => `<option value="${g}" ${this.treaty.regime === g ? 'selected' : ''}>${GOVERNMENT_INFO[g].name}</option>`).join('')}</select></label>
        <div class="tr-cost">${this.costHtml(this.cost(), s)}</div>
        <div class="actions-row"><button type="button" class="claim primary" data-w="propose">Propose these terms</button><button type="button" class="claim" data-w="white">Offer white peace</button></div>
      </section></div></div>`;
  }
}
