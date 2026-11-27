// Your provinces as one list, with every filter you need to decide what to build
// where: search, cities or countryside, coast, terrain, a resource and how rich
// it is, what can still be built there, development, and what is under way.
// Columns sort (click a heading); click a row to go there; Build opens its build list.
// Used by the Economy window (Provinces tab, full) and the Eco lens (compact).
import { BUILDINGS, BUILDING_TYPES, type BuildingType, siteFits } from '../../shared/buildings';
import { devLabel } from '../../shared/development';
import type { Game } from './game';
import { RESOURCE_NAMES, type Political, type Province, type ResourceId } from './political';
import { BIOME_INFO } from './world';
import { allDev } from './dev';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const RES: ResourceId[] = ['farmland', 'timber', 'oil', 'gas', 'coal', 'ore', 'rare_earths'];
const people = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} m` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : `${Math.round(n)}`);

interface Filters { q: string; show: string; terrain: string; res: string; min: number; can: string; dev: number }
const DEFAULTS: Filters = { q: '', show: 'all', terrain: '', res: '', min: 1, can: '', dev: 0 };

export interface ProvinceListActions { go(province: number): void; build(province: number): void }

export class ProvinceList {
  private f: Filters = { ...DEFAULTS };
  private dev: Map<number, number> | null = null;
  private devAt = 0;

  constructor(private game: Game, private pol: Political, private actions: ProvinceListActions, private compact = false) {
    try { Object.assign(this.f, JSON.parse(localStorage.getItem(this.key()) ?? '{}')); } catch { /* storage blocked */ }
  }

  private key() { return `sov.plist.${this.compact ? 'lens' : 'full'}`; }

  /** True while the player is using a filter (typing, a list open): the host should hold off redrawing. */
  busy(host: HTMLElement) { const a = document.activeElement; return !!a && host.contains(a) && !!a.closest('.plist-filters'); }

  /** Refresh only the results under a mounted list (the filters stay as they are). False if none is mounted. */
  refresh(host: HTMLElement) {
    const out = host.querySelector<HTMLElement>('.plist-results');
    if (!out) return false;
    out.innerHTML = this.results();
    return true;
  }

  /** Wire a host element once (its events are delegated; the markup inside it may be redrawn freely). */
  wire(host: HTMLElement) {
    if (host.dataset.plistWired) return;
    host.dataset.plistWired = '1';
    const onFilter = (e: Event) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const k = t.dataset.pf as keyof Filters | undefined;
      if (!k) return;
      (this.f as unknown as Record<string, string | number>)[k] = k === 'min' || k === 'dev' ? Number(t.value) : t.value;
      try { localStorage.setItem(this.key(), JSON.stringify(this.f)); } catch { /* storage blocked */ }
      const out = host.querySelector<HTMLElement>('.plist-results');
      if (out) out.innerHTML = this.results();
    };
    host.addEventListener('input', onFilter);
    host.addEventListener('change', onFilter);
    host.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.plist')) return;
      if (t.closest('[data-pl="reset"]')) {
        this.f = { ...DEFAULTS };
        try { localStorage.removeItem(this.key()); } catch { /* storage blocked */ }
        const box = host.querySelector<HTMLElement>('.plist');
        if (box) box.outerHTML = this.html();
        return;
      }
      const b = t.closest<HTMLElement>('[data-pl-build]');
      if (b) { e.stopPropagation(); this.actions.build(Number(b.dataset.plBuild)); return; }
      const row = t.closest<HTMLElement>('tr[data-pl-go]');
      if (row && !t.closest('thead')) this.actions.go(Number(row.dataset.plGo));
    });
  }

  html() {
    const f = this.f;
    const mine = this.mine();
    const terrains = [...new Set(mine.map((p) => p.terrain))].sort((a, b) => (BIOME_INFO[a]?.name ?? a).localeCompare(BIOME_INFO[b]?.name ?? b));
    const opt = (v: string | number, label: string, cur: string | number) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="plist${this.compact ? ' compact' : ''}">
      <div class="plist-filters">
        <input type="search" data-pf="q" value="${esc(f.q)}" placeholder="Search provinces" aria-label="Search provinces">
        <select data-pf="show" aria-label="Which provinces">${[['all', 'All provinces'], ['city', 'Cities'], ['country', 'Countryside'], ['coastal', 'Coastal'], ['inland', 'Inland'], ['building', 'Building now'], ['empty', 'Nothing built yet'], ['occupied', 'Occupied by an enemy']].map(([v, l]) => opt(v, l, f.show)).join('')}</select>
        <select data-pf="can" aria-label="Can build">${opt('', 'Can build: anything', f.can)}${BUILDING_TYPES.map((t) => opt(t, `Can build: ${BUILDINGS[t].name}`, f.can)).join('')}</select>
        <select data-pf="res" aria-label="Resource">${opt('', 'Any resource', f.res)}${RES.map((r) => opt(r, RESOURCE_NAMES[r], f.res)).join('')}</select>
        <select data-pf="min" aria-label="How rich in it">${[[1, 'some'], [25, '25+'], [50, '50+'], [75, '75+']].map(([v, l]) => opt(v, `Resource ${l}`, f.min)).join('')}</select>
        <select data-pf="terrain" aria-label="Terrain">${opt('', 'Any terrain', f.terrain)}${terrains.map((t) => opt(t, BIOME_INFO[t]?.name ?? t, f.terrain)).join('')}</select>
        <select data-pf="dev" aria-label="Development">${[0, 20, 40, 60, 80].map((v) => opt(v, v ? `Development ${v}+` : 'Any development', f.dev)).join('')}</select>
        <button type="button" class="link" data-pl="reset">Clear filters</button>
      </div>
      <div class="plist-results">${this.results()}</div>
    </div>`;
  }

  private mine() {
    const me = this.game.mine?.id;
    return me === undefined ? [] : [...this.pol.provinces.values()].filter((p) => p.kind === 'land' && p.nation === me);
  }

  private devs() {
    if (!this.dev || performance.now() - this.devAt > 4000) { this.dev = allDev(this.pol, this.game); this.devAt = performance.now(); }
    return this.dev;
  }

  private coastal(p: Province) { return p.adj.some((q) => this.pol.provinces.get(q)?.kind === 'sea'); }

  /** Whether a work of this type could be started here now. */
  private canBuild(p: Province, t: BuildingType, coastal: boolean) {
    if (BUILDINGS[t].coastal && !coastal) return false;
    if (!siteFits(t, p, (q) => this.pol.provinces.get(q))) return false;
    return !(this.game.war.buildings[p.id] ?? []).some((b) => b.type === t && b.progress < 1);
  }

  private results() {
    const me = this.game.mine?.id;
    if (me === undefined) return '<p class="hint">Take command of a nation to list its provinces.</p>';
    const f = this.f, dev = this.devs(), q = f.q.trim().toLowerCase();
    const occupied = new Map<number, number>();
    for (const [pid, by] of Object.entries(this.game.war.occupied ?? {})) occupied.set(Number(pid), by as number);
    const capital = this.pol.nations.get(me)?.capital;
    const rows = this.mine().map((p) => {
      const list = this.game.war.buildings[p.id] ?? [];
      const coastal = this.coastal(p);
      return { p, d: dev.get(p.id) ?? 0, coastal, done: list.filter((b) => b.progress >= 1), doing: list.filter((b) => b.progress < 1) };
    }).filter(({ p, d, coastal, done, doing }) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (d < f.dev) return false;
      if (f.terrain && p.terrain !== f.terrain) return false;
      if (f.res && ((p.res as Record<string, number> | undefined)?.[f.res] ?? 0) < f.min) return false;
      if (f.can && !this.canBuild(p, f.can as BuildingType, coastal)) return false;
      switch (f.show) {
        case 'city': return !!p.city;
        case 'country': return !p.city;
        case 'coastal': return coastal;
        case 'inland': return !coastal;
        case 'building': return doing.length > 0;
        case 'empty': return done.length === 0 && doing.length === 0;
        case 'occupied': return occupied.has(p.id);
      }
      return true;
    }).sort((a, b) => (b.p.pop ?? 0) - (a.p.pop ?? 0));
    if (!rows.length) return '<p class="hint">No province matches these filters.</p>';
    const total = this.mine().length;
    const shown = rows.slice(0, this.compact ? 120 : 400);
    const resCell = (p: Province) => {
      const r = RES.map((k) => [k, (p.res as Record<string, number> | undefined)?.[k] ?? 0] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const focus = f.res ? r.filter(([k]) => k === f.res) : r.slice(0, this.compact ? 1 : 3);
      return { text: focus.map(([k, v]) => `${RESOURCE_NAMES[k]} ${Math.round(v)}`).join(', ') || '<span class="muted">none</span>', sort: focus[0]?.[1] ?? 0 };
    };
    const works = (done: { type: BuildingType }[], doing: { type: BuildingType; progress: number }[]) => {
      const names = [...new Set(done.map((b) => b.type))].map((t) => { const n = done.filter((b) => b.type === t).length; return `${BUILDINGS[t].name}${n > 1 ? ` ×${n}` : ''}`; });
      const now = doing.map((b) => `<span class="pill">${esc(BUILDINGS[b.type].name)} ${Math.round(b.progress * 100)}%</span>`);
      return `${esc(names.join(', ')) || (now.length ? '' : '<span class="muted">—</span>')} ${now.join(' ')}`;
    };
    const head = this.compact
      ? '<tr><th>Province</th><th>Dev</th><th>Resource</th><th>Works</th><th aria-label="Build"></th></tr>'
      : '<tr><th>Province</th><th>Dev</th><th>People</th><th>Terrain</th><th>Resources</th><th>Works</th><th aria-label="Build"></th></tr>';
    const body = shown.map(({ p, d, coastal, done, doing }) => {
      const rc = resCell(p);
      const tags = `${p.id === capital ? '<span class="pill ok" title="Capital">capital</span> ' : p.city ? '<span class="pill" title="A city">city</span> ' : ''}${coastal && !this.compact ? '<span class="pill" title="On the coast: ports can be built">coast</span> ' : ''}${occupied.has(p.id) ? '<span class="pill bad">occupied</span> ' : ''}`;
      const cells = this.compact
        ? `<td data-sort="${d}" title="${devLabel(d)}">${d}</td><td data-sort="${rc.sort}">${rc.text}</td><td data-sort="${done.length + doing.length}">${done.length}${doing.length ? ` <span class="pill">+${doing.length}</span>` : ''}</td>`
        : `<td data-sort="${d}" title="${devLabel(d)}"><span class="dev-bar"><i style="width:${d}%"></i></span> ${d}</td><td data-sort="${p.pop ?? 0}">${people(p.pop ?? 0)}</td><td>${esc(BIOME_INFO[p.terrain]?.name ?? p.terrain)}</td><td data-sort="${rc.sort}">${rc.text}</td><td data-sort="${done.length + doing.length}">${works(done, doing)}</td>`;
      return `<tr class="go-row" data-pl-go="${p.id}" title="Click to go there"><th scope="row" data-sort="${esc(p.name)}">${tags}${esc(p.name)}</th>${cells}<td><button type="button" class="link" data-pl-build="${p.id}">Build…</button></td></tr>`;
    }).join('');
    return `<p class="hint plist-count">${rows.length === total ? `All ${total} provinces` : `${rows.length} of ${total} provinces`}${rows.length > shown.length ? ` (first ${shown.length} shown; narrow the filters)` : ''}. Click a heading to sort, a row to go there.</p>
      <div class="table-wrap"><table class="league projects plist-table" data-sort-key="plist-${this.compact ? 'lens' : 'full'}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }
}
