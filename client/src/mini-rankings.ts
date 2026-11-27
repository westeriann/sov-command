// The world panel's mini rankings: the top five nations in any of a dozen
// measures (people, wealth, forces, science...), with your own place below.
// Folds away; remembers the measure you last looked at.
import type { Game } from './game';
import type { Political } from './political';
import { money } from '../../shared/economy';
import { allDev, nationDev } from './dev';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Measure { name: string; tip: string; value(id: number): number | undefined; show(v: number): string; low?: boolean }

const people = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} bn` : n >= 1e6 ? `${Math.round(n / 1e6)} m` : `${Math.round(n / 1e3)} k`);

export class MiniRankings {
  private key = 'pop';
  private open = true;
  private dev: Map<number, number> | null = null;
  private devAt = 0;

  constructor(private el: HTMLElement, private game: Game, private pol: Political) {
    try {
      const saved = JSON.parse(localStorage.getItem('sov.minirank') ?? '{}') as { key?: string; open?: boolean };
      if (saved.key) this.key = saved.key;
      if (saved.open === false) this.open = false;
    } catch { /* storage blocked */ }
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.id !== 'miniRankKey') return;
      this.key = t.value; this.save(); this.render();
    });
    el.addEventListener('toggle', (e) => {
      const d = e.target as HTMLDetailsElement;
      if (d.id !== 'secRank') return;
      this.open = d.open; this.save();
      if (d.open) this.render();
    }, true);
    let queued = false;
    game.on((c) => {
      if (!(c.has('economy') || c.has('nations') || c.has('war') || c.has('mine')) || queued) return;
      queued = true;
      setTimeout(() => { queued = false; if (this.open) this.render(); }, 400); // at most a few times a second
    });
    this.render();
  }

  private save() { try { localStorage.setItem('sov.minirank', JSON.stringify({ key: this.key, open: this.open })); } catch { /* storage blocked */ } }

  private measures(): Record<string, Measure> {
    const econ = (id: number) => this.game.economy.get(id);
    const owned = new Map<number, number>();
    const area = new Map<number, number>();
    for (const p of this.pol.provinces.values()) {
      if (p.kind !== 'land' || p.nation === undefined) continue;
      owned.set(p.nation, (owned.get(p.nation) ?? 0) + 1);
      area.set(p.nation, (area.get(p.nation) ?? 0) + (p.area ?? 0));
    }
    const season = new Map((this.game.season?.leaders ?? []).map((l) => [l.nation, l]));
    return {
      pop: { name: 'Population', tip: 'People', value: (id) => econ(id)?.pop ?? this.pol.nations.get(id)?.pop, show: people },
      gdp: { name: 'GDP', tip: 'Yearly output', value: (id) => econ(id)?.gdp, show: (v) => money(v) },
      gdppc: { name: 'GDP per person', tip: 'Output per head', value: (id) => econ(id)?.gdppc, show: (v) => `$${Math.round(v).toLocaleString('en-US')}` },
      growth: { name: 'Growth', tip: 'Yearly economic growth', value: (id) => econ(id)?.growth, show: (v) => `${(v * 100).toFixed(1)}%` },
      dev: { name: 'Development', tip: 'Cities, wealth and works', value: (id) => this.devOf(id), show: (v) => `${Math.round(v)}` },
      stability: { name: 'Stability', tip: 'Public approval', value: (id) => econ(id)?.stability, show: (v) => `${Math.round(v)}` },
      power: { name: 'World power', tip: 'Share of world power (the match)', value: (id) => season.get(id)?.power, show: (v) => `${v}%` },
      score: { name: 'Match score', tip: 'Points in the match', value: (id) => season.get(id)?.score, show: (v) => v.toLocaleString('en-US') },
      army: { name: 'Army', tip: 'Divisions (intelligence estimate)', value: (id) => this.game.nations.get(id)?.army, show: (v) => `${v} div` },
      techs: { name: 'Research', tip: 'Technologies researched', value: (id) => this.game.nations.get(id)?.techs, show: (v) => `${v} techs` },
      provinces: { name: 'Provinces', tip: 'Land provinces held', value: (id) => owned.get(id), show: (v) => `${v}` },
      area: { name: 'Territory', tip: 'Land area', value: (id) => area.get(id), show: (v) => `${(v / 1e6).toFixed(2)} m km²` },
      satellites: { name: 'Satellites', tip: 'In orbit', value: (id) => this.game.nations.get(id)?.satellites, show: (v) => `${v}` },
      blackout: { name: 'Power supply', tip: 'Share of electricity demand met', value: (id) => { const b = econ(id)?.blackout; return b === undefined ? undefined : 1 - b; }, show: (v) => `${Math.round(v * 100)}%` },
    };
  }

  private devOf(id: number) {
    if (!this.dev || performance.now() - this.devAt > 5000) { this.dev = allDev(this.pol, this.game); this.devAt = performance.now(); }
    return nationDev(id, this.pol, this.game, this.dev);
  }

  render() {
    const all = this.measures();
    const m = all[this.key] ?? all.pop;
    const rows = [...this.pol.nations.values()]
      .filter((n) => !this.game.nations.get(n.id)?.annexedBy)
      .map((n) => ({ n, v: m.value(n.id) }))
      .filter((r): r is { n: typeof r.n; v: number } => r.v !== undefined && Number.isFinite(r.v))
      .sort((a, b) => b.v - a.v);
    const mine = this.game.mine?.id;
    const at = mine !== undefined ? rows.findIndex((r) => r.n.id === mine) : -1;
    const li = (r: (typeof rows)[number], i: number) => `<li${r.n.id === mine ? ' class="mine"' : ''}><button type="button" data-province="${r.n.capital}"><em>${i + 1}</em><i style="background:${r.n.color}"></i>${esc(r.n.short)}<span class="mono">${m.show(r.v)}</span></button></li>`;
    const body = rows.length
      ? `<ol class="ranking">${rows.slice(0, 5).map(li).join('')}${at >= 5 ? `<li class="gap" aria-hidden="true">⋯</li>${li(rows[at], at)}` : ''}</ol>`
      : '<p class="hint">No figures yet.</p>';
    const options = Object.entries(all).map(([k, x]) => `<option value="${k}"${k === this.key ? ' selected' : ''}>${x.name}</option>`).join('');
    const existing = this.el.querySelector<HTMLElement>('.mini-rank-body');
    if (existing) {
      existing.innerHTML = body;
      const sel = this.el.querySelector<HTMLSelectElement>('#miniRankKey');
      if (sel && document.activeElement !== sel) sel.innerHTML = options;
      return;
    }
    this.el.innerHTML = `<details class="rp-sec rank-sec" id="secRank"${this.open ? ' open' : ''}><summary class="label">RANKINGS</summary>
      <label class="mini-rank-pick"><span class="visually-hidden">Rank nations by</span><select id="miniRankKey">${options}</select></label>
      <div class="mini-rank-body">${body}</div></details>`;
  }
}
