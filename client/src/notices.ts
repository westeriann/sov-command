// Notifications for your own nation: a collapsible list under the date, with
// urgent news (war on you, losses, strikes, revolts) in red and its own alarm;
// and small alert icons in the command bar for standing problems that need
// attention (at war, nothing being researched, blackouts, debt...).
import type { WorldEvent } from '../../shared/protocol';
import type { Game } from './game';
import type { Political } from './political';
import type { Cue, Sound } from './sound';
import { attr, tip } from './tooltip';

type Level = 'urgent' | 'important' | 'info';
interface Notice { key: string; at: number; level: Level; text: string; kind: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Small line icons, 16×16, drawn in currentColor. */
const ICONS: Record<string, string> = {
  war: '<path d="M3 3l10 10M13 3L3 13M2 11l3 3M11 14l3-3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  research: '<path d="M6 2h4M7 2v4l-4 7a1 1 0 0 0 1 1.5h8a1 1 0 0 0 1-1.5l-4-7V2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>',
  power: '<path d="M9 1L3 9h4l-1 6 6-8H8z" fill="currentColor"/>',
  supply: '<path d="M2 5l6-3 6 3v6l-6 3-6-3z M2 5l6 3 6-3 M8 8v6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M1 15L15 1" stroke="currentColor" stroke-width="1.6"/>',
  debt: '<path d="M8 1v14M11.5 4.5C11 3.5 9.8 3 8 3 6 3 4.5 4 4.5 5.5S6 7.5 8 8s3.5 1 3.5 2.5S10 13 8 13c-1.8 0-3-.5-3.5-1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>',
  unrest: '<path d="M8 1.5L15 14H1z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M8 6v4M8 11.5v1" stroke="currentColor" stroke-width="1.6"/>',
  mail: '<rect x="1.5" y="3.5" width="13" height="9" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M2 4l6 5 6-5" stroke="currentColor" stroke-width="1.4" fill="none"/>',
  idle: '<rect x="2" y="7" width="12" height="7" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M4 7V4h3v3M9 7V2h3v5" stroke="currentColor" stroke-width="1.4" fill="none"/>',
  shortage: '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M4 12L12 4" stroke="currentColor" stroke-width="1.6"/>',
  decision: '<path d="M3 15V2M3 2h9l-2 3 2 3H3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>',
  kit: '<path d="M2 6h12v7H2zM5 6V3h6v3" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M2 9h12" stroke="currentColor" stroke-width="1.2"/>',
  bell: '<path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>',
};
export const icon = (name: string) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

export interface NoticeActions { openModule(id: string): void; goToNation(id: number): void; goToProvince(id: number): void }

export class Notices {
  private list: Notice[] = [];
  private seen = new Set<string>();
  private unread = 0;
  private open = false;
  private primed = false;
  private el: HTMLElement;
  private alerts: HTMLElement;

  constructor(root: HTMLElement, private game: Game, private pol: Political, private sound: Sound, private actions: NoticeActions,
    private notify: (title: string, body: string) => void) {
    this.el = document.createElement('section');
    this.el.className = 'panel notices';
    this.el.setAttribute('aria-label', 'Notifications');
    root.appendChild(this.el);
    try { this.open = localStorage.getItem('sov.notices') === 'open'; } catch { /* storage blocked */ }
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-n="toggle"]')) {
        this.open = !this.open;
        if (this.open) this.unread = 0;
        try { localStorage.setItem('sov.notices', this.open ? 'open' : 'closed'); } catch { /* storage blocked */ }
        this.render();
      } else if (t.closest('[data-n="clear"]')) { this.list = []; this.unread = 0; this.render(); }
      else {
        const li = t.closest<HTMLElement>('[data-key]');
        const n = li && this.list.find((x) => x.key === li.dataset.key);
        if (n) this.follow(n);
      }
    });

    // alert icons live in the command bar, just before the clock
    this.alerts = document.createElement('div');
    this.alerts.className = 'alert-icons';
    this.alerts.setAttribute('aria-label', 'Problems needing attention');
    const clock = root.querySelector('.top .clock');
    clock?.parentElement?.insertBefore(this.alerts, clock);
    this.alerts.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
      if (a?.dataset.open) this.actions.openModule(a.dataset.open);
    });

    game.on((c) => {
      if (c.has('events') || c.has('mine')) this.collect();
      if (c.has('mine') || c.has('war') || c.has('units') || c.has('economy')) this.renderAlerts();
    });
    this.render();
  }

  // ---- notifications --------------------------------------------------------------
  /** How much this event matters to us, or null if it is not about us. */
  private classify(e: WorldEvent): Level | null {
    const me = this.game.mine && this.pol.nations.get(this.game.mine.id);
    if (!me) return null;
    const t = e.text;
    const aboutUs = e.nation === me.id || t.includes(me.name) || new RegExp(`\\b${me.short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t);
    if (!aboutUs) return null;
    const byOthers = e.nation !== me.id;
    if (/NUCLEAR|nuclear missile/i.test(t)) return 'urgent';
    if (e.kind === 'war') {
      if (byOthers && /declares war|enters the war|occupy|missiles strike|bombers destroy|declares independence|splits apart/i.test(t)) return 'urgent';
      if (/division was destroyed|Revolt in|Partisans rise|Uprising|Civil war|Hurricane .* makes landfall/i.test(t)) return 'urgent';
      return 'important';
    }
    if (/coup|revolution|loses the election/i.test(t)) return 'urgent';
    if (e.kind === 'diplomacy' || e.kind === 'peace' || e.kind === 'politics') return 'important';
    return 'info';
  }

  private collect() {
    if (!this.game.mine) return;
    const fresh: Notice[] = [];
    for (const e of this.game.events) {
      const key = `${e.at}|${e.text}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const level = this.classify(e);
      if (level) fresh.push({ key, at: e.at, level, text: e.text, kind: e.kind });
    }
    // the first look after taking a nation is history: list it, but no alarms for what already happened
    const history = !this.primed;
    this.primed = true;
    if (!fresh.length) return;
    this.list = [...fresh.reverse(), ...this.list].slice(0, 60);
    if (history) { this.render(); return; }
    if (!this.open) this.unread += fresh.length;
    const worst = fresh.some((n) => n.level === 'urgent') ? 'urgent' : fresh.some((n) => n.level === 'important') ? 'important' : 'info';
    const cue: Cue = worst === 'urgent' ? 'urgent'
      : fresh.some((n) => n.kind === 'war') ? 'war' : fresh.some((n) => n.kind === 'peace') ? 'peace'
      : fresh.some((n) => n.kind === 'research') ? 'research' : 'notice';
    this.sound.play(cue);
    const top = fresh.find((n) => n.level === worst)!;
    if (worst !== 'info') this.notify(worst === 'urgent' ? 'Sovereign Command: URGENT' : 'Sovereign Command', top.text);
    if (worst === 'urgent') { this.el.classList.remove('flash'); void this.el.offsetWidth; this.el.classList.add('flash'); }
    this.render();
  }

  /** Open the window a notice is about, and look at the place it names. */
  private follow(n: Notice) {
    const t = n.text;
    const module = n.kind === 'war' ? 'army'
      : n.kind === 'diplomacy' || n.kind === 'peace' ? 'diplomacy'
      : n.kind === 'research' ? 'research'
      : /completed in|blackout|power|market|trade|budget|tax/i.test(t) ? 'economy'
      : /mission|achievement|points/i.test(t) ? 'rankings'
      : n.kind === 'politics' ? 'research' : 'economy';
    this.actions.openModule(module);
    // the longest province name the text mentions, if any
    let best: { id: number; len: number } | null = null;
    for (const p of this.pol.provinces.values()) {
      if (p.name.length >= 3 && p.name.length > (best?.len ?? 0) && new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) best = { id: p.id, len: p.name.length };
    }
    if (best) this.actions.goToProvince(best.id);
  }

  private render() {
    this.el.classList.toggle('open', this.open);
    this.el.hidden = !this.game.mine;
    const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const latest = this.list[0];
    const urgent = this.list.slice(0, Math.max(1, this.unread)).some((n) => n.level === 'urgent') && this.unread > 0;
    this.el.innerHTML = `
      <button type="button" class="notices-head${urgent ? ' urgent' : ''}" data-n="toggle" aria-expanded="${this.open}">
        ${icon('bell')}<span class="label">NOTIFICATIONS</span>${this.unread ? `<b class="badge">${this.unread}</b>` : ''}
        <span class="latest">${!this.open && latest ? esc(latest.text) : ''}</span><i class="chev">${this.open ? '▴' : '▾'}</i>
      </button>
      ${this.open ? `<ol class="notices-list" data-keep-scroll>
        ${this.list.length ? this.list.map((n) => `<li class="lv-${n.level}" data-key="${esc(n.key)}" role="button" tabindex="0" title="Open"><time class="mono">${date(n.at)}</time><span>${esc(n.text)}</span></li>`).join('')
          : '<li class="empty-row">Nothing yet. News about your nation appears here.</li>'}
      </ol><div class="notices-foot"><button type="button" class="link" data-n="clear">Clear</button></div>` : ''}`;
    document.documentElement.style.setProperty('--notices-h', `${this.el.hidden ? 0 : this.el.offsetHeight + 8}px`);
  }

  // ---- alert icons ----------------------------------------------------------------
  private renderAlerts() {
    const mine = this.game.mine;
    if (!mine) { this.alerts.innerHTML = ''; return; }
    const out: { id: string; icon: string; level: 'bad' | 'warn'; open: string; tip: string }[] = [];
    const wars = this.game.war.wars.filter((w) => w.a === mine.id || w.b === mine.id);
    if (wars.length) {
      const foes = wars.map((w) => this.pol.nations.get(w.a === mine.id ? w.b : w.a)?.short ?? '?');
      out.push({ id: 'war', icon: 'war', level: 'bad', open: 'army', tip: tip(`At war (${wars.length})`, `Against: ${foes.join(', ')}`, ['Armies burn twice the oil; stability suffers', 'bad'], 'Click: Ground forces') });
    }
    const r = mine.research;
    if (r && !r.current) out.push({ id: 'research', icon: 'research', level: 'warn', open: 'research', tip: tip('Nothing being researched', ['Research points are being wasted', 'bad'], 'Click: R&D to pick a technology or fill the queue') });
    else if (r && !(r.queue ?? []).length) out.push({ id: 'queue', icon: 'research', level: 'warn', open: 'research', tip: tip('Research queue empty', `Researching ${r.current?.replace(/_/g, ' ')}; nothing lined up after it`, 'Click: R&D to queue the next technologies') });
    const e = mine.econ;
    const blackout = this.game.economy.get(mine.id)?.blackout ?? 0;
    if (blackout > 0.01) out.push({ id: 'power', icon: 'power', level: 'bad', open: 'economy', tip: tip(`Blackouts: ${Math.round(blackout * 100)}% of demand unmet`, ['Growth and stability fall', 'bad'], 'Build power stations (Economy)') });
    if (e && e.treasury < 0) out.push({ id: 'debt', icon: 'debt', level: 'warn', open: 'economy', tip: tip(`In debt: $${Math.abs(e.treasury).toFixed(1)}bn`, ['Interest drains the budget', 'bad'], 'Raise taxes or cut spending (Economy)') });
    if (e && e.stability < 30) out.push({ id: 'unrest', icon: 'unrest', level: 'bad', open: 'research', tip: tip(`Stability ${Math.round(e.stability)}`, ['Below 25: coups and revolutions become possible', 'bad'], 'Welfare spending, propaganda at home or a better-suited government help') });
    if (e && e.shortage > 0.05) out.push({ id: 'shortage', icon: 'shortage', level: 'warn', open: 'economy', tip: tip('Shortage of goods', [`${Math.round(e.shortage * 100)}% of needs unmet`, 'bad'], 'Trade deals and imports help (Economy)') });
    const cut = this.game.units.filter((u) => u.nation === mine.id && u.supplied === false).length;
    if (cut) out.push({ id: 'supply', icon: 'supply', level: 'bad', open: 'army', tip: tip(`${cut} unit${cut > 1 ? 's' : ''} out of supply`, ['Weaker in battle and losing strength each day', 'bad'], 'Reconnect them to your territory or a port') });
    const broken = Object.entries(this.game.war.buildings).filter(([p]) => this.pol.provinces.get(Number(p))?.nation === mine.id)
      .flatMap(([, l]) => l).filter((b) => b.damaged && b.repair === undefined).length;
    if (broken) out.push({ id: 'repair', icon: 'unrest', level: 'bad', open: 'economy', tip: tip(`${broken} building${broken > 1 ? 's' : ''} damaged by storms`, ['Out of action until repaired', 'bad'], 'Repair them from the province panel (click the province)') });
    if (mine.event) out.push({ id: 'event', icon: 'decision', level: 'bad', open: 'event:', tip: tip('A decision is waiting', `${mine.event.key.replace(/_/g, ' ')}: choose how to answer`, 'Unanswered, the first option is taken after 30 days', 'Click to decide') });
    const m = mine.mil;
    if (m?.queue.length && (m.equipment ?? 0) < (m.equipmentNeed ?? 0) * 3) out.push({ id: 'kit', icon: 'kit', level: 'bad', open: 'army', tip: tip(`Equipment running out: ${m.equipment ?? 0} in store`, [`The production line needs ${m.equipmentNeed} a day; arsenals and factories make ${m.equipmentRate}`, 'bad'], 'Raise the military budget, build factories, secure metals') });
    const props = mine.diplo?.incoming.length ?? 0;
    if (props) out.push({ id: 'mail', icon: 'mail', level: 'warn', open: 'diplomacy', tip: tip(`${props} proposal${props > 1 ? 's' : ''} awaiting your answer`, 'They lapse after 30 game days', 'Click: Diplomacy') });
    if (mine.mil && !mine.mil.queue.length && wars.length) out.push({ id: 'idle', icon: 'idle', level: 'warn', open: 'army', tip: tip('No units in production', ['At war with nothing being built', 'bad'], 'Click: Ground forces to recruit') });
    const html = out.map((a) => `<button type="button" class="alert-icon ${a.level}" data-${a.open.includes(':') ? 'go' : 'open'}="${a.open}" data-tip="${attr(a.tip)}" aria-label="${attr(a.tip.replace(/<[^>]+>/g, '').split('\n')[0])}">${icon(a.icon)}</button>`).join('');
    if (html !== this.alertsHtml) { this.alertsHtml = html; this.alerts.innerHTML = html; } // redraw only on change: hover and clicks stay put
  }
  private alertsHtml = '';
}
