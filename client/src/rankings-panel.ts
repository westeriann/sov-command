// Rankings: the season leaderboard, a chart of the leaders' scores, the hall of
// fame, a replay of how the map changed, and a nation's history.
import type { Game } from './game';
import { flagSvg } from '../../shared/flags';
import { flagOf } from './customize';
import { ACHIEVEMENTS, MISSION_REWARD_DAYS, type AchievementKey } from '../../shared/goals';
import type { Political } from './political';

export interface RankingsActions {
  goToNation(id: number): void;
  /** Show territory as it was (owners and occupiers by province), or null for the live map. */
  showTerritory(frame: { o: Record<number, number>; x: Record<number, number> } | null): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LINE_COLORS = ['#5fd4ea', '#ffb547', '#7be08a', '#ff7a6b', '#c49bff', '#f2e36b', '#6bb8ff', '#ff9bd2'];

export class RankingsPanel {
  private panel: HTMLElement;
  private bar: HTMLElement;
  private frames: { day: number; o: Record<number, number>; x: Record<number, number> }[] = [];
  private timer = 0;

  constructor(root: HTMLElement, private game: Game, private pol: Political, private actions: RankingsActions) {
    this.panel = document.createElement('section');
    this.panel.className = 'panel econ-window rankings-window';
    this.panel.setAttribute('aria-label', 'Rankings');
    this.panel.hidden = true;
    root.appendChild(this.panel);
    this.bar = document.createElement('section');
    this.bar.className = 'panel replay-bar';
    this.bar.setAttribute('aria-label', 'Map replay');
    this.bar.hidden = true;
    root.appendChild(this.bar);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    this.bar.addEventListener('click', (e) => this.onClick(e));
    this.bar.addEventListener('input', (e) => { if ((e.target as HTMLElement).id === 'replaySlider') this.showFrame(Number((e.target as HTMLInputElement).value)); });
    game.on((c) => { if ((c.has('economy') || c.has('mine')) && this.isOpen) this.render(); });
  }

  get isOpen() { return !this.panel.hidden; }
  toggle() { this.panel.hidden = !this.panel.hidden; if (this.isOpen) this.render(); }
  close() { this.panel.hidden = true; }

  private onClick(e: Event) {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
    if (!act) return;
    const k = act.dataset.k;
    if (k === 'close') { this.close(); document.dispatchEvent(new CustomEvent('rankings-closed')); }
    else if (k === 'goto') this.actions.goToNation(Number(act.dataset.nation));
    else if (k === 'replay') void this.startReplay();
    else if (k === 'compare') void this.compare();
    else if (k === 'play') this.play();
    else if (k === 'stop') this.stopReplay();
  }

  render() {
    const s = this.game.season;
    const head = `<div class="econ-head"><div><span class="label">RANKINGS</span><h2>${s ? `Season ${s.number}` : 'Season'}</h2></div><button type="button" class="link" data-k="close">Close</button></div>`;
    if (!s) { this.panel.innerHTML = `${head}<div class="econ-body"><p class="hint">Connect to a world to see its rankings.</p></div>`; return; }
    const left = Math.max(0, s.endsAt - Date.now());
    const days = Math.floor(left / 86_400_000), hours = Math.floor((left % 86_400_000) / 3_600_000);
    const name = (id: number) => esc(this.pol.nations.get(id)?.name ?? `Nation ${id}`);
    const player = (id: number) => this.game.nations.get(id)?.player;
    this.panel.innerHTML = `${head}
      <div class="econ-body">
        <div class="econ-kpis">
          <div><span>Season ends in</span><b>${days} d ${hours} h</b><em>real time · ${new Date(s.endsAt).toUTCString().slice(5, 22)} UTC</em></div>
          <div><span>Leader</span><b>${s.leaders[0] ? name(s.leaders[0].nation) : '—'}</b><em>${s.leaders[0] ? `${s.leaders[0].score.toLocaleString('en-US')} points` : ''}</em></div>
          <div><span>How to win</span><b>Power</b><em>40% wealth, 30% people, 20% forces, 10% science, scored every game day</em></div>
          <div><span>Early victory</span><b>40% for 60 days</b><em>hold 40% of world power for 60 game days</em></div>
        </div>
        ${this.goalsHtml()}
        <div class="econ-cols">
          <section>
            <span class="label">LEADERBOARD</span>
            <div class="table-wrap"><table class="league"><thead><tr><th>#</th><th>Nation</th><th>Leader</th><th>Score</th><th>Power</th></tr></thead><tbody>
              ${s.leaders.map((l, i) => `<tr${l.nation === this.game.mine?.id ? ' class="mine-row"' : ''}><td>${i + 1}</td>
                <th scope="row"><button type="button" class="link flag-link" data-k="goto" data-nation="${l.nation}">${this.pol.nations.get(l.nation) ? flagSvg(flagOf(this.pol.nations.get(l.nation)!), 18) : ''}${name(l.nation)}</button></th>
                <td>${player(l.nation) ? `${esc(player(l.nation)!)}${l.badges ? ` <span class="badge" title="${l.badges} achievement${l.badges > 1 ? 's' : ''}">★${l.badges}</span>` : ''}` : '<span class="muted">AI</span>'}</td><td class="mono">${l.score.toLocaleString('en-US')}</td><td class="mono">${l.power}%</td></tr>`).join('')}
            </tbody></table></div>
          </section>
          <section>
            <span class="label">SCORES THIS SEASON</span>
            ${this.chart()}
            <span class="label">HALL OF FAME</span>
            ${s.hallOfFame.length ? `<ol class="fame">${s.hallOfFame.map((h) => `<li><b>Season ${h.season}</b> · ${esc(h.name)}${h.player ? ` (${esc(h.player)})` : ''} · ${h.score.toLocaleString('en-US')} pts</li>`).join('')}</ol>` : '<p class="hint">No season has ended yet.</p>'}
            <span class="label">COMPARE NATIONS</span>
            <div class="council-form"><select id="cmpA" aria-label="First nation">${this.nationOptions(this.game.mine?.id ?? s.leaders[0]?.nation)}</select>
            <select id="cmpB" aria-label="Second nation">${this.nationOptions(s.leaders.find((l) => l.nation !== this.game.mine?.id)?.nation)}</select>
            <button type="button" class="claim" data-k="compare">Compare GDP, forces and territory</button></div>
            <div id="compare"></div>
            <span class="label">HISTORY</span>
            <button type="button" class="claim" data-k="replay">Replay the map</button>
            <p class="hint">Watch borders and fronts change week by week this season.</p>
          </section>
        </div>
      </div>`;
  }

  private nationOptions(selected?: number) {
    return [...this.pol.nations.values()].sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => `<option value="${n.id}"${n.id === selected ? ' selected' : ''}>${esc(n.name)}</option>`).join('');
  }

  private async compare() {
    const a = Number((this.panel.querySelector('#cmpA') as HTMLSelectElement).value);
    const b = Number((this.panel.querySelector('#cmpB') as HTMLSelectElement).value);
    const box = this.panel.querySelector<HTMLElement>('#compare')!;
    box.innerHTML = '<p class="hint">Loading…</p>';
    let series: { day: number; v: Record<number, { g: number; a: number; p: number }> }[] = [];
    try { series = (await (await fetch(`/api/stats?nations=${a},${b}`)).json()).series ?? []; } catch { /* offline */ }
    if (series.length < 2) { box.innerHTML = '<p class="hint">Not enough weekly figures yet.</p>'; return; }
    const chart = (key: 'g' | 'a' | 'p', title: string) => {
      const max = Math.max(1, ...series.flatMap((f) => [f.v[a]?.[key] ?? 0, f.v[b]?.[key] ?? 0]));
      const W = 200, H = 70;
      const line = (id: number, color: string) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${series.map((f, i) =>
        `${((i / (series.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 2 - ((f.v[id]?.[key] ?? 0) / max) * (H - 8)).toFixed(1)}`).join(' ')}"/>`;
      return `<figure class="mini-chart"><figcaption>${title}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">${line(a, LINE_COLORS[0])}${line(b, LINE_COLORS[1])}</svg></figure>`;
    };
    const nm = (id: number) => esc(this.pol.nations.get(id)?.short ?? '');
    box.innerHTML = `<div class="chart-legend"><span><i style="background:${LINE_COLORS[0]}"></i>${nm(a)}</span><span><i style="background:${LINE_COLORS[1]}"></i>${nm(b)}</span></div>
      <div class="mini-charts">${chart('g', 'GDP')}${chart('a', 'Forces')}${chart('p', 'Provinces held')}</div>`;
  }

  /** This season's missions and the player's achievements. */
  private goalsHtml() {
    const mine = this.game.mine, me = this.game.me;
    if (!mine?.missions) return '';
    const got = (me?.achievements ?? []) as AchievementKey[];
    return `<div class="econ-cols">
      <section>
        <span class="label">YOUR SEASON MISSIONS</span>
        ${mine.missions.map((m) => `<div class="war-row"><div><b class="${m.done ? 'up' : ''}">${m.done ? '✓ ' : ''}${esc(m.text)}</b></div></div>`).join('')}
        <p class="hint">Each mission completed is worth ${MISSION_REWARD_DAYS} game days of your normal scoring, plus 2% of GDP in cash. New missions come with each season.</p>
      </section>
      <section>
        <span class="label">ACHIEVEMENTS · ${got.length} OF ${Object.keys(ACHIEVEMENTS).length}</span>
        <ul class="achievements">${(Object.entries(ACHIEVEMENTS) as [AchievementKey, { name: string; text: string; emblem?: string }][]).map(([k, a]) =>
          `<li class="${got.includes(k) ? 'got' : ''}"><b>${a.name}</b> · ${a.text}${a.emblem ? ` · unlocks the ${a.emblem} emblem` : ''}</li>`).join('')}</ul>
      </section>
    </div>`;
  }

  /** A small line chart of the current top nations' scores. */
  private chart() {
    const h = this.game.season?.history ?? [];
    if (h.length < 2) return '<p class="hint">The chart fills in week by week.</p>';
    const ids = Object.keys(h[h.length - 1].s).map(Number);
    const max = Math.max(1, ...h.flatMap((p) => Object.values(p.s)));
    const W = 420, H = 150;
    const x = (i: number) => (i / (h.length - 1)) * (W - 10) + 5;
    const y = (v: number) => H - 5 - (v / max) * (H - 15);
    const lines = ids.map((id, k) => {
      const pts = h.map((p, i) => (p.s[id] !== undefined ? `${x(i).toFixed(1)},${y(p.s[id]).toFixed(1)}` : '')).filter(Boolean).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${LINE_COLORS[k % LINE_COLORS.length]}" stroke-width="2"><title>${esc(this.pol.nations.get(id)?.name ?? '')}</title></polyline>`;
    }).join('');
    const legend = ids.map((id, k) => `<span><i style="background:${LINE_COLORS[k % LINE_COLORS.length]}"></i>${esc(this.pol.nations.get(id)?.short ?? '')}</span>`).join('');
    return `<svg class="score-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scores of the leading nations over this season">${lines}</svg><div class="chart-legend">${legend}</div>`;
  }

  private async startReplay() {
    try {
      const r = await fetch('/api/replay');
      this.frames = (await r.json()).frames ?? [];
    } catch { this.frames = []; }
    this.bar.hidden = false;
    if (!this.frames.length) {
      this.bar.innerHTML = '<span class="hint">No weekly snapshots yet: they are taken every game week.</span> <button type="button" class="link" data-k="stop">Close</button>';
      return;
    }
    this.close();
    this.bar.innerHTML = `<span class="label">REPLAY</span><button type="button" class="claim" data-k="play">Play</button>
      <input id="replaySlider" type="range" min="0" max="${this.frames.length - 1}" value="0" aria-label="Week">
      <output class="mono" id="replayDay"></output><button type="button" class="claim" data-k="stop">Back to live map</button>`;
    this.showFrame(0);
  }

  private showFrame(i: number) {
    const f = this.frames[i];
    if (!f) return;
    this.actions.showTerritory(f);
    const out = this.bar.querySelector('#replayDay');
    if (out) out.textContent = `day ${f.day}`;
    const slider = this.bar.querySelector<HTMLInputElement>('#replaySlider');
    if (slider) slider.value = String(i);
  }

  private play() {
    window.clearInterval(this.timer);
    let i = Number(this.bar.querySelector<HTMLInputElement>('#replaySlider')?.value ?? 0);
    if (i >= this.frames.length - 1) i = 0;
    this.timer = window.setInterval(() => {
      this.showFrame(i++);
      if (i >= this.frames.length) window.clearInterval(this.timer);
    }, 400);
  }

  private stopReplay() {
    window.clearInterval(this.timer);
    this.bar.hidden = true;
    this.actions.showTerritory(null);
  }
}

/** A nation's recent history, fetched from the server. */
export async function historyHtml(nation: number, name: string) {
  try {
    const [r, st] = await Promise.all([fetch(`/api/history?nation=${nation}`), fetch(`/api/stats?nations=${nation}`)]);
    const events = ((await r.json()).events ?? []) as { at: number; text: string }[];
    const series = ((await st.json()).series ?? []) as { day: number; v: Record<number, { g: number; a: number; p: number }> }[];
    const spark = (key: 'g' | 'a' | 'p', title: string) => {
      if (series.length < 2) return '';
      const vals = series.map((f) => f.v[nation]?.[key] ?? 0), max = Math.max(1, ...vals), W = 120, H = 34;
      const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - (v / max) * (H - 6)).toFixed(1)}`).join(' ');
      return `<figure class="mini-chart"><figcaption>${title} · ${vals[vals.length - 1].toLocaleString('en-US')}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title} over time"><polyline fill="none" stroke="#5fd4ea" stroke-width="1.6" points="${pts}"/></svg></figure>`;
    };
    return `<span class="label">HISTORY · ${esc(name).toUpperCase()}</span>
      ${series.length >= 2 ? `<div class="mini-charts">${spark('g', 'GDP $bn')}${spark('a', 'Forces')}${spark('p', 'Provinces')}</div>` : ''}
      ${events.length ? `<ul class="reports">${events.map((e) => `<li><time class="mono">${new Date(e.at).toISOString().slice(0, 10)}</time> ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="hint">Nothing recorded yet.</p>'}`;
  } catch {
    return '<p class="hint">History is unavailable right now.</p>';
  }
}
