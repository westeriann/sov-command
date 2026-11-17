// Rankings: the season leaderboard, a chart of the leaders' scores, the hall of
// fame, a replay of how the map changed, and a nation's history.
import type { Game } from './game';
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
    game.on((c) => { if (c.has('economy') && this.isOpen) this.render(); });
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
        <div class="econ-cols">
          <section>
            <span class="label">LEADERBOARD</span>
            <div class="table-wrap"><table class="league"><thead><tr><th>#</th><th>Nation</th><th>Leader</th><th>Score</th><th>Power</th></tr></thead><tbody>
              ${s.leaders.map((l, i) => `<tr${l.nation === this.game.mine?.id ? ' class="mine-row"' : ''}><td>${i + 1}</td>
                <th scope="row"><button type="button" class="link" data-k="goto" data-nation="${l.nation}">${name(l.nation)}</button></th>
                <td>${player(l.nation) ? esc(player(l.nation)!) : '<span class="muted">AI</span>'}</td><td class="mono">${l.score.toLocaleString('en-US')}</td><td class="mono">${l.power}%</td></tr>`).join('')}
            </tbody></table></div>
          </section>
          <section>
            <span class="label">SCORES THIS SEASON</span>
            ${this.chart()}
            <span class="label">HALL OF FAME</span>
            ${s.hallOfFame.length ? `<ol class="fame">${s.hallOfFame.map((h) => `<li><b>Season ${h.season}</b> · ${esc(h.name)}${h.player ? ` (${esc(h.player)})` : ''} · ${h.score.toLocaleString('en-US')} pts</li>`).join('')}</ol>` : '<p class="hint">No season has ended yet.</p>'}
            <span class="label">HISTORY</span>
            <button type="button" class="claim" data-k="replay">Replay the map</button>
            <p class="hint">Watch borders and fronts change week by week this season.</p>
          </section>
        </div>
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
    const r = await fetch(`/api/history?nation=${nation}`);
    const events = ((await r.json()).events ?? []) as { at: number; text: string }[];
    return `<span class="label">HISTORY · ${esc(name).toUpperCase()}</span>
      ${events.length ? `<ul class="reports">${events.map((e) => `<li><time class="mono">${new Date(e.at).toISOString().slice(0, 10)}</time> ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="hint">Nothing recorded yet.</p>'}`;
  } catch {
    return '<p class="hint">History is unavailable right now.</p>';
  }
}
