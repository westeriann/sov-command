// Records: the ledger (every nation side by side, sortable) and the log (every
// dispatch this session, filtered by kind).
import { opinionWord } from '../../shared/diplomacy';
import { money } from '../../shared/economy';
import { GOVERNMENT_INFO } from '../../shared/research';
import type { EventKind } from '../../shared/protocol';
import type { Change, Game } from './game';
import type { Political } from './political';
import { keepScrollOn } from './keep-scroll';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
type Col = 'name' | 'gdp' | 'growth' | 'gdppc' | 'pop' | 'stability' | 'army' | 'techs' | 'opinion';
const COLS: [Col, string][] = [['name', 'Nation'], ['gdp', 'GDP'], ['growth', 'Growth'], ['gdppc', 'Per person'], ['pop', 'People'], ['stability', 'Stability'], ['army', 'Army'], ['techs', 'Techs'], ['opinion', 'Opinion of you']];
const KINDS: [EventKind | 'all', string][] = [['all', 'All'], ['war', 'War'], ['peace', 'Peace'], ['diplomacy', 'Diplomacy'], ['politics', 'Politics'], ['research', 'Research'], ['world', 'World']];

export class RecordsPanel {
  private el: HTMLElement;
  private tab: 'ledger' | 'log' = 'ledger';
  private sort: Col = 'gdp';
  private desc = true;
  private kind: EventKind | 'all' = 'all';
  private mineOnly = false;
  private html = '';
  private log: { at: number; kind: EventKind; nation?: number; text: string }[] = [];

  constructor(root: HTMLElement, private game: Game, private pol: Political) {
    this.el = document.createElement('section');
    this.el.className = 'panel econ-window records-window';
    keepScrollOn(this.el);
    this.el.setAttribute('aria-label', 'Records');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-rc]');
      if (!t) return;
      const a = t.dataset.rc;
      if (a === 'close') { this.close(); document.dispatchEvent(new CustomEvent('records-closed')); }
      else if (a === 'tab') this.tab = t.dataset.tab as 'ledger' | 'log';
      else if (a === 'sort') { const c = t.dataset.col as Col; this.desc = this.sort === c ? !this.desc : c !== 'name'; this.sort = c; }
      else if (a === 'kind') this.kind = t.dataset.kind as EventKind | 'all';
      else if (a === 'mine') this.mineOnly = !this.mineOnly;
      this.render();
    });
    // keep every event this session (the game only holds the recent ones)
    game.on((c: Set<Change>) => {
      if (c.has('events')) {
        const seen = new Set(this.log.map((x) => `${x.at}|${x.text}`));
        for (const e of this.game.events) if (!seen.has(`${e.at}|${e.text}`)) this.log.push(e);
        if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);
      }
      if (this.isOpen && (c.has('events') || c.has('economy') || c.has('nations'))) this.render();
    });
  }

  get isOpen() { return !this.el.hidden; }
  toggle() { this.el.hidden = !this.el.hidden; if (this.isOpen) { this.html = ''; this.render(); } }
  close() { this.el.hidden = true; }

  private render() {
    const head = `<div class="econ-head"><div><span class="label">RECORDS</span><h2>${this.tab === 'ledger' ? 'Ledger of nations' : 'Log of dispatches'}</h2></div>
      <div class="mk-tabs" role="tablist"><button type="button" role="tab" data-rc="tab" data-tab="ledger" aria-selected="${this.tab === 'ledger'}">Ledger</button><button type="button" role="tab" data-rc="tab" data-tab="log" aria-selected="${this.tab === 'log'}">Log</button></div>
      <button type="button" class="link" data-rc="close">Close</button></div>`;
    this.set(`${head}<div class="econ-body">${this.tab === 'ledger' ? this.ledgerHtml() : this.logHtml()}</div>`);
  }

  private ledgerHtml() {
    const g = this.game, me = g.mine?.id;
    const rows = [...this.pol.nations.values()].filter((n) => !g.nations.get(n.id)?.annexedBy).map((n) => {
      const e = g.economy.get(n.id), pub = g.nations.get(n.id);
      return {
        id: n.id, name: n.name, gdp: e?.gdp ?? 0, growth: e?.growth ?? 0, gdppc: e?.gdppc ?? 0, pop: e?.pop ?? n.pop, stability: e?.stability ?? 0,
        army: pub?.army ?? 0, techs: pub?.techs ?? 0, opinion: n.id === me ? 999 : g.mine?.relations?.[n.id]?.total ?? 0, gov: pub?.government,
      };
    });
    const k = this.sort;
    rows.sort((a, b) => (k === 'name' ? a.name.localeCompare(b.name) : (a[k] as number) - (b[k] as number)) * (this.desc ? -1 : 1));
    const fmt = (r: typeof rows[number], c: Col) => c === 'name' ? `<a href="#" class="go" data-go="${r.id === me ? 'module:economy' : `diplo:${r.id}`}">${esc(r.name)}</a><span class="muted"> ${r.gov ? GOVERNMENT_INFO[r.gov].name : ''}</span>`
      : c === 'gdp' ? money(r.gdp) : c === 'growth' ? `<span class="${r.growth >= 0 ? 'up' : 'down'}">${(r.growth * 100).toFixed(1)}%</span>` : c === 'gdppc' ? `$${r.gdppc.toLocaleString('en-US')}`
      : c === 'pop' ? `${(r.pop / 1e6).toFixed(1)} m` : c === 'opinion' ? (r.id === me ? '—' : `<span class="${r.opinion >= 10 ? 'up' : r.opinion <= -10 ? 'down' : ''}">${opinionWord(r.opinion)} ${r.opinion > 0 ? '+' : ''}${r.opinion}</span>`) : String(r[c]);
    return `<div class="table-wrap"><table class="goods ledger"><thead><tr>${COLS.map(([c, l]) => `<th scope="col"><button type="button" class="link" data-rc="sort" data-col="${c}">${l}${this.sort === c ? (this.desc ? ' ▾' : ' ▴') : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.id === me ? 'picked' : ''}">${COLS.map(([c]) => `<td>${fmt(r, c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint">Click a heading to sort. Armies are intelligence estimates, rounded to the nearest five divisions.</p>`;
  }

  private logHtml() {
    const me = this.game.mine?.id;
    const list = this.log.filter((e) => (this.kind === 'all' || e.kind === this.kind) && (!this.mineOnly || e.nation === me || (me !== undefined && e.text.includes(this.pol.nations.get(me)?.short ?? '\u0000'))))
      .slice().reverse().slice(0, 400);
    return `<div class="actions-row">${KINDS.map(([k, l]) => `<button type="button" class="claim${this.kind === k ? ' primary' : ''}" data-rc="kind" data-kind="${k}">${l}</button>`).join('')}
      <button type="button" class="claim${this.mineOnly ? ' primary' : ''}" data-rc="mine">Only my nation</button></div>
      <ul class="reports log-list">${list.map((e) => `<li><span class="mono">${new Date(e.at).toISOString().slice(0, 10)}</span> ${esc(e.text)}</li>`).join('') || '<li>Nothing yet.</li>'}</ul>`;
  }

  private set(html: string) { if (html !== this.html) { this.html = html; this.el.innerHTML = html; } }
}
