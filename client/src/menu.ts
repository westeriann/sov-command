import { art } from './art-icons';
import { ASSET_BASE } from './config';
import {
  AUTOPILOT_CHOICES, DEFAULT_SETTINGS, GAME_MODES, HOST_SPEEDS, MAPS, MODE_INFO, RELEASE_CHOICES, START_SPEEDS,
  type GameSettings, type NewGame,
} from '../../shared/settings';

// The splash screen and the main menu. The splash shows while the planet and the
// world load; the menu then opens over the slowly turning globe, and Escape brings
// it back during play (single-player pauses while it is open). Options here drive
// the same controls as the map drawer and top bar, so the two never disagree.

export interface MenuActions {
  offline: boolean; // single-player build (the world runs in this window)
  desktop: boolean; // inside the desktop app
  continue(): void; // close the menu and play
  newGame(game: NewGame): void; // delete the single-player world and start a new one with these choices
  /** The map and mode the world in play was made with. */
  settings?: () => GameSettings | undefined;
  slots?: (msg: { t: 'slots' } | { t: 'save-slot'; name: string } | { t: 'load-slot'; name: string } | { t: 'delete-slot'; name: string }) => Promise<{ list: { name: string; info: string }[]; ironman: boolean; error?: string; saved?: string }>;
  manual(): void;
  pause(on: boolean): void;
  music: { level: number; on: boolean; setLevel(v: number): void; toggle(): void; play(): void; pause(): void };
  /** Sound-effect volumes by group: interface, effects, ambience. */
  sfx?: { groups: [string, string][]; get(g: string): number; set(g: string, v: number): void };
  /** Shared worlds: who leads what, to pick a nation from the menu. */
  lobby?: () => { id: number; name: string; player?: string; online?: boolean; gdp: number }[];
  claim?: (id: number) => void;
  /** The top bar's figures: every choice, what is shown now, and how to change it. */
  topbar?: { items: [string, string][]; defaults: string[]; get(): string[]; set(ids: string[]): void };
  mineId?: () => number | undefined;
}

/** What the desktop app offers the page (see desktop/preload.cjs). */
interface DesktopBridge {
  /** Host the last hosted world, or (given the create-game choices) a new one. */
  host(game?: NewGame): Promise<{ port: number; url: string; addresses: string[] }>;
  /** The last hosted world's choices, or null when there is none. */
  lastHosted?(): Promise<Partial<NewGame> | null>;
  stopHost(): Promise<boolean>;
  hosting(): Promise<{ port: number; addresses: string[] } | null>;
  singlePlayer(): Promise<boolean>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Page = 'main' | 'options' | 'multiplayer' | 'credits' | 'newgame' | 'host' | 'saves';

export const MOTTO = 'Glory be to the victor and the spoils they shall have.';

/** Tips shown under the loading bar, one after another. */
const TIPS = [
  'Click any figure in a province panel (population, owner, resources, specialty) to jump to where you can change it.',
  'Every province has a specialty from its climate and place. Luxuries such as wine, coffee and gems reach your trade partners at half strength.',
  'In a democracy, parliament votes on your laws and must back a war of choice. Meet its demands to keep its support.',
  'Autocracies and juntas rule by decree: cheaper in political capital, but laws the public dislikes cost stability.',
  'A demand another nation refuses gives you a claim: a war on them is justified, and the world condemns you far less.',
  'Breaking a non-aggression pact is a betrayal every nation remembers.',
  'Gifts and envoys warm relations; AI governments answer proposals mostly by their opinion of you.',
  'Supply contracts deliver goods every day at a fixed price, even through embargoes and blockades.',
  'A guarantor joins any war declared on the nation it guarantees. Guarantee your small neighbours to keep the big ones honest.',
  'Short of timber, construction and repairs slow down; short of oil, your armies fight weaker.',
  'Press Q with units selected to give an order, then click where it should go. Tab jumps to your next army.',
  'Hold W A S D to move the camera; Shift moves it faster.',
  'Hurricanes form only over warm seas in season. Buildings they damage do nothing until repaired.',
  'Uranium makes nuclear power stations cheaper and is needed for warheads. Hold some, or trade with someone who does.',
  'Research never stops: points earned with nothing to study are banked and spent later.',
  'Winter in cold lands slows armies by half, and foreign troops lose strength every day.',
  'Rivers slow attackers and shape the borders between provinces.',
  'Open borders take in refugees from wars and famines: more people, and some unrest.',
  'Press I for the manual and ? for every key. Esc brings back this menu.',
  'Free trade makes trade agreements worth half again as much; tariffs raise money but annoy your partners.',
  'Emergency powers let you rule without parliament, but liberties erode and the public sours.',
  'A world council resolution can sanction, condemn or force a ceasefire on any nation.',
];

/** Options shown in the menu: [label, id of the control in the game interface it drives]. */
const GRAPHICS: [string, string, string][] = [
  ['3D models', 'models3d', 'Animated troops, ships, aircraft, cities and buildings when zoomed in'],
  ['Tilt the camera with zoom', 'tilt', 'The camera leans over the land as you zoom in'],
  ['Borders', 'borders', 'National and province borders'],
  ['Rivers', 'rivers', 'Rivers and lakes'],
  ['Place names', 'labels', 'Names of nations and provinces'],
  ['Grid lines', 'grid', 'Latitude and longitude'],
];

export class MainMenu {
  private el: HTMLElement;
  private page: Page = 'main';
  private ready = false;
  private progressText = 'Charting the planet';
  private progress = 0;
  private hostInfo: { url?: string; addresses: string[]; error?: string; busy?: boolean } | null = null;
  private get bridge() { return (window as unknown as { sovDesktop?: DesktopBridge }).sovDesktop; }
  private saves: { list: { name: string; info: string }[]; ironman: boolean; error?: string; saved?: string } | null = null;
  private tip = Math.floor(Math.random() * TIPS.length);
  /** The create-game screen's choices, remembered between games. */
  private draft: NewGame = MainMenu.loadDraft();
  private lastHosted: Partial<NewGame> | null | undefined;
  private confirmNew = false;

  private static loadDraft(): NewGame {
    const d: NewGame = { ...DEFAULT_SETTINGS, ironman: false, speed: 5, autopilotMin: 60, releaseDays: 7 };
    try { Object.assign(d, JSON.parse(localStorage.getItem('sov.newgame') ?? '{}')); } catch { /* storage blocked */ }
    delete d.nation; // the nation is chosen afresh each time
    return d;
  }
  private saveDraft() {
    const { nation: _n, ...keep } = this.draft;
    try { localStorage.setItem('sov.newgame', JSON.stringify(keep)); } catch { /* storage blocked */ }
  }
  private tipTimer = 0;
  isOpen = true;

  constructor(private hud: HTMLElement, private a: MenuActions) {
    this.el = document.createElement('div');
    this.el.className = 'main-menu splash';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Sovereign Command');
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('change', (e) => this.onInput(e));
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (this.el.classList.contains('splash') && this.ready) { e.preventDefault(); this.showMenu(); return; }
      if (e.key === 'Escape' && this.ready) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (this.page !== 'main') { this.page = 'main'; this.render(); } else this.close();
      }
    }, true);
    this.render();
    // a new tip every few seconds while the splash is up
    this.tipTimer = window.setInterval(() => {
      if (!this.el.classList.contains('splash')) return;
      const el = this.el.querySelector<HTMLElement>('.splash-tip');
      if (!el) return;
      el.classList.add('fading');
      window.setTimeout(() => {
        this.tip = (this.tip + 1) % TIPS.length;
        const t = el.querySelector('span');
        if (t) t.textContent = TIPS[this.tip];
        el.classList.remove('fading');
      }, 400);
    }, 7000);
  }

  /** Loading progress on the splash screen (0..1). */
  setProgress(text: string, f: number) { this.progressText = text; this.progress = f; if (!this.ready) this.render(); }

  /** Everything is loaded: invite the player in, then show the menu by itself after a moment. */
  setReady() {
    if (this.ready) return;
    this.ready = true;
    this.progress = 1;
    this.progressText = 'Ready';
    this.render();
  }

  private showMenu() {
    window.clearInterval(this.tipTimer);
    this.el.classList.remove('splash');
    this.page = 'main';
    this.render();
  }

  open(page: Page = 'main') {
    if (!this.ready) return;
    this.isOpen = true;
    this.page = page;
    this.confirmNew = false;
    this.el.hidden = false;
    this.el.classList.remove('splash', 'leaving');
    document.body.classList.add('menu-open');
    this.a.pause(true);
    this.render();
  }

  close() {
    if (!this.ready) return;
    this.isOpen = false;
    this.el.classList.add('leaving');
    document.body.classList.remove('menu-open');
    window.setTimeout(() => { if (!this.isOpen) this.el.hidden = true; }, 380);
    this.a.pause(false);
    this.a.continue();
  }

  private control<T extends HTMLElement>(id: string) { return this.hud.querySelector<T>(`#${id}`); }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
    if (this.el.classList.contains('splash')) { if (this.ready) this.showMenu(); return; }
    if (!t) return;
    const m = t.dataset.m;
    if (m === 'play') this.close();
    else if (m === 'page') {
      this.page = t.dataset.page as Page;
      if (this.page === 'saves') void this.a.slots?.({ t: 'slots' }).then((r) => { this.saves = r; this.render(); });
      if (this.page === 'newgame' || this.page === 'host') this.confirmNew = false;
      if (this.page === 'multiplayer' && this.bridge?.lastHosted) void this.bridge.lastHosted().then((r) => { this.lastHosted = r; this.render(); });
      this.render();
    }
    else if (m === 'back') { this.page = 'main'; this.render(); }
    else if (m === 'manual') { this.close(); this.a.manual(); }
    else if (m === 'ng') {
      // a choice on the create-game screen
      const k = t.dataset.k as keyof NewGame, v = t.dataset.v!;
      (this.draft as unknown as Record<string, unknown>)[k] = k === 'map' || k === 'mode' ? v : k === 'ironman' ? !this.draft.ironman : Number(v);
      this.confirmNew = false;
      this.saveDraft();
      this.render();
    }
    else if (m === 'newgame-yes') {
      if (!this.confirmNew) { this.confirmNew = true; this.render(); return; }
      this.saveDraft();
      this.a.newGame({ ...this.draft });
    }
    else if (m === 'host-new') { this.startHosting({ map: this.draft.map, mode: this.draft.mode, speed: this.draft.speed && HOST_SPEEDS.includes(this.draft.speed) ? this.draft.speed : 1, autopilotMin: this.draft.autopilotMin, releaseDays: this.draft.releaseDays }); }
    else if (m === 'save' || m === 'load' || m === 'delete') {
      const name = m === 'save' ? (this.el.querySelector<HTMLInputElement>('#saveName')?.value ?? '') : t.dataset.name ?? '';
      if (m === 'delete' && t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Confirm delete'; return; }
      if (m === 'load' && t.dataset.confirm !== '1') { t.dataset.confirm = '1'; t.textContent = 'Confirm: load (unsaved progress is lost)'; return; }
      void this.a.slots?.({ t: m === 'save' ? 'save-slot' : m === 'load' ? 'load-slot' : 'delete-slot', name } as never).then((r) => { this.saves = r; this.render(); });
    }
    else if (m === 'quit') window.close();
    else if (m === 'host') this.startHosting();
    else if (m === 'open-host' && this.hostInfo?.url) location.href = this.hostInfo.url;
    else if (m === 'stop-host') { void this.bridge?.stopHost().then(() => this.bridge?.singlePlayer()); }
    else if (m === 'single') void this.bridge?.singlePlayer();
    else if (m === 'pick') { this.a.claim?.(Number(t.dataset.nation)); this.close(); }
    else if (m === 'join') {
      const input = this.el.querySelector<HTMLInputElement>('#mpUrl');
      let url = (input?.value ?? '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try { localStorage.setItem('sov.server', url); } catch { /* storage blocked */ }
      location.href = url;
    }
    else if (m === 'sound') { this.control<HTMLElement>('soundBtn')?.click(); this.render(); }
    else if (m === 'alerts') { this.control<HTMLElement>('alertsBtn')?.click(); this.render(); }
    else if (m === 'music') { if (this.a.music.on) this.a.music.pause(); else this.a.music.play(); this.render(); }
    else if (m === 'speed') { this.hud.querySelector<HTMLElement>(`[data-act="speed"][data-x="${t.dataset.x}"]`)?.click(); window.setTimeout(() => this.render(), 50); }
    else if (m === 'tb-toggle' || m === 'tb-up' || m === 'tb-down' || m === 'tb-reset') {
      const tb = this.a.topbar;
      if (!tb) return;
      let ids = tb.get();
      const id = t.dataset.id!;
      if (m === 'tb-reset') ids = [...tb.defaults];
      else if (m === 'tb-toggle') ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      else {
        const i = ids.indexOf(id), j = m === 'tb-up' ? i - 1 : i + 1;
        if (i >= 0 && j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      tb.set(ids);
      this.render();
    }
    else if (m === 'fullscreen') {
      if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.();
      window.setTimeout(() => this.render(), 200);
    }
  }

  /** Host a world on this computer: the last one, or a new one with the create-game choices. */
  private startHosting(game?: NewGame) {
    const b = this.bridge;
    if (!b) return;
    this.page = 'multiplayer';
    this.hostInfo = { addresses: [], busy: true }; this.render();
    b.host(game).then((r) => { this.hostInfo = { url: r.url, addresses: r.addresses }; this.render(); })
      .catch((err: Error) => { this.hostInfo = { addresses: [], error: String(err.message ?? err) }; this.render(); });
  }

  /** Options drive the game's own controls. */
  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.id === 'ngNation') { const v = (t as unknown as HTMLSelectElement).value; this.draft.nation = v ? Number(v) : undefined; this.confirmNew = false; this.render(); return; }
    const target = t.dataset.ctl;
    if (target) {
      const c = this.control<HTMLInputElement>(target);
      if (!c) return;
      if (t.type === 'checkbox') { if (c.checked !== t.checked) { c.checked = t.checked; c.dispatchEvent(new Event('change', { bubbles: true })); } }
      else { c.value = t.value; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); }
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${t.value}%`;
    } else if (t.dataset.sfx && this.a.sfx) {
      this.a.sfx.set(t.dataset.sfx, Number(t.value) / 100);
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${t.value}%`;
    } else if (t.id === 'mVol') {
      this.a.music.setLevel(Number(t.value) / 100);
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${t.value}%`;
    }
  }

  private render() {
    if (this.el.classList.contains('splash')) {
      this.el.innerHTML = `<div class="splash-inner">
        ${LOGO_HTML}
        <h1>SOVEREIGN<span>COMMAND</span></h1>
        <p class="motto">${MOTTO}</p>
        <div class="load"><i style="width:${Math.round(this.progress * 100)}%"></i></div>
        <p class="load-text mono">${this.ready ? 'Press any key or click to begin' : `${esc(this.progressText)}…`}</p>
        <p class="splash-tip"><b>TIP</b><span>${esc(TIPS[this.tip])}</span></p>
      </div>`;
      return;
    }
    const body = this.page === 'options' ? this.optionsHtml() : this.page === 'multiplayer' ? this.multiplayerHtml()
      : this.page === 'credits' ? this.creditsHtml() : this.page === 'newgame' ? this.createHtml('single') : this.page === 'host' ? this.createHtml('host') : this.page === 'saves' ? this.savesHtml() : this.mainHtml();
    this.el.innerHTML = `<div class="menu-shell">
      <div class="menu-brand">${LOGO_HTML}<h1>SOVEREIGN<span>COMMAND</span></h1><p class="motto">${MOTTO}</p></div>
      <div class="menu-body">${body}</div>
      <p class="menu-foot mono">Esc returns to the game${this.a.offline ? ' · the world is paused while this menu is open' : ''}</p></div>`;
    (this.el.querySelector('[data-m="play"], #mpUrl') as HTMLElement | null)?.focus();
  }

  private mainHtml() {
    const a = this.a;
    const btn = (m: string, label: string, sub: string, extra = '') => `<button type="button" class="menu-btn" data-m="${m}" ${extra}><b>${label}</b><span>${sub}</span></button>`;
    return `<nav class="menu-list">
      ${a.offline ? btn('play', 'Single player', `Continue your campaign${a.settings?.() ? ` · ${MODE_INFO[a.settings()!.mode].name}` : ''}`) : btn('play', 'Play', `Return to the world${a.settings?.() ? ` · ${MODE_INFO[a.settings()!.mode].name}` : ''}`)}
      ${a.offline ? btn('page', 'Save and load', 'Keep your world under a name, or go back to one', 'data-page="saves"') : ''}
      ${a.offline ? btn('page', 'New campaign', 'Choose the map, game mode, your nation and the rules, and start a fresh world', 'data-page="newgame"') : ''}
      ${btn('page', 'Multiplayer', a.offline ? 'Join a world server with other players' : 'You are playing on a shared world', 'data-page="multiplayer"')}
      ${btn('page', 'Options', 'Graphics, sound, interface and game speed', 'data-page="options"')}
      ${btn('manual', 'Manual', 'How everything works, with links into the game')}
      ${btn('page', 'Credits', 'Who and what made this', 'data-page="credits"')}
      ${a.desktop ? btn('quit', 'Quit', 'Your world is saved') : ''}
    </nav>`;
  }

  /** The create-game screen: single player, or a world hosted on this computer. */
  private createHtml(kind: 'single' | 'host') {
    const d = this.draft, single = kind === 'single';
    const pick = (k: keyof NewGame, v: string | number, on: boolean, inner: string, cls = 'ng-card') =>
      `<button type="button" class="${cls}${on ? ' on' : ''}" data-m="ng" data-k="${k}" data-v="${v}" aria-pressed="${on}">${inner}</button>`;
    const seg = (k: keyof NewGame, list: number[], label: (v: number) => string, cur: number | undefined) =>
      `<div class="ng-seg">${list.map((v) => pick(k, v, cur === v, label(v), 'chip')).join('')}</div>`;
    const nations = single ? (this.a.lobby?.() ?? []).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const speeds = single ? START_SPEEDS : HOST_SPEEDS;
    const speed = speeds.includes(d.speed ?? 0) ? d.speed : speeds[single ? 1 : 0];
    const mode = MODE_INFO[d.mode];
    return `<h2>${single ? 'New campaign' : 'Host a new world'}</h2>
      <p class="hint">${single ? 'Everything about the world is chosen here, and kept with it: a save always plays as it began.' : 'A shared world on this computer: you and friends lead nations side by side, the AI runs the rest. These choices are kept with the world.'}</p>
      <div class="ng-grid">
        <section><span class="label">MAP</span>
          <div class="ng-cards">${MAPS.map((m) => pick('map', m.id, d.map === m.id, `<b>${esc(m.name)}</b><span>${esc(m.text)}</span>`)).join('')}
            <div class="ng-card soon" aria-disabled="true"><b>Custom maps</b><span>Worlds of your own making will appear here in a later version.</span></div></div>
        </section>
        <section><span class="label">GAME MODE</span>
          <div class="ng-cards">${GAME_MODES.map((k) => pick('mode', k, d.mode === k, `<b>${esc(MODE_INFO[k].name)}</b><em>${esc(MODE_INFO[k].tagline)}</em><span>${esc(MODE_INFO[k].text)}</span>`)).join('')}</div>
        </section>
        ${single ? `<section><span class="label">YOUR NATION</span>
          <select id="ngNation" class="text-input" aria-label="Your nation"><option value="">Choose on the map once the world opens</option>
            ${nations.map((n) => `<option value="${n.id}" ${d.nation === n.id ? 'selected' : ''}>${esc(n.name)}${n.gdp ? ` · GDP $${Math.round(n.gdp).toLocaleString('en-US')}bn` : ''}</option>`).join('')}</select>
          <p class="hint">Every other nation is run by the AI.</p>
        </section>` : ''}
        <section><span class="label">RULES</span>
          <div class="ng-rule"><span>${single ? 'Starting speed' : 'World speed'}</span>${seg('speed', speeds, (v) => `${v}×`, speed)}</div>
          <p class="hint">1× is a game day every 10 real seconds, a game year an hour.${single ? ' You can change it while playing.' : ' Every player shares it.'}</p>
          ${single ? `<div class="ng-rule"><span>Ironman</span>${pick('ironman', 1, !!d.ironman, d.ironman ? 'On: a single autosave, every decision stands' : 'Off: save and load freely', 'chip')}</div>` : `
          <div class="ng-rule"><span>Advisers take over an absent leader after</span>${seg('autopilotMin', AUTOPILOT_CHOICES, (v) => (v === 0 ? 'never' : v < 60 ? `${v} min` : `${v / 60} h`), d.autopilotMin ?? 60)}</div>
          <div class="ng-rule"><span>A nation goes back to the AI when its leader is away</span>${seg('releaseDays', RELEASE_CHOICES, (v) => (v === 0 ? 'never' : `${v} day${v > 1 ? 's' : ''}`), d.releaseDays ?? 7)}</div>`}
        </section>
      </div>
      <p class="ng-summary mono">${esc(MAPS.find((m) => m.id === d.map)?.name ?? '')} · ${esc(mode.name)}${mode.research !== 1 ? ' (research at half cost)' : ''} · ${speed}×${single ? `${d.ironman ? ' · Ironman' : ''} · ${d.nation !== undefined ? esc(nations.find((n) => n.id === d.nation)?.name ?? '') : 'nation chosen on the map'}` : ''} · from 1 January 2026</p>
      <div class="menu-row">${single
        ? `<button type="button" class="claim ${this.confirmNew ? 'danger' : 'primary'}" data-m="newgame-yes">${this.confirmNew ? 'Confirm: delete my current world and start' : 'Start the campaign'}</button>`
        : '<button type="button" class="claim primary" data-m="host-new">Start hosting this world</button>'}
        <button type="button" class="claim" data-m="${single ? 'back' : 'page'}" ${single ? '' : 'data-page="multiplayer"'}>Back</button></div>
      ${single && this.confirmNew ? '<p class="hint">Your current single-player world is replaced. Named saves are kept.</p>' : ''}
      ${!single ? '<p class="hint">Your last hosted world is kept aside as a backup (one only) when a new one starts.</p>' : ''}`;
  }

  private savesHtml() {
    const s = this.saves;
    if (!s) return '<h2>Save and load</h2><p class="hint">Reading your saves…</p>';
    if (s.ironman) return `<h2>Save and load</h2><p>This is an <b>Ironman</b> campaign: the world saves itself every 20 seconds, and there is no going back to an earlier save.</p><div class="menu-row"><button type="button" class="claim" data-m="back">Back</button></div>`;
    return `<h2>Save and load</h2>
      <p class="hint">Your world also saves itself every 20 seconds, and whenever this menu opens.</p>
      ${s.error ? `<p class="down">${esc(s.error)}</p>` : ''}${s.saved ? `<p class="up">Saved as “${esc(s.saved)}”.</p>` : ''}
      <div class="menu-row"><input id="saveName" class="text-input" maxlength="40" placeholder="Name this save" aria-label="Save name"><button type="button" class="claim primary" data-m="save">Save</button></div>
      <div class="save-list">${s.list.map((x) => `<div class="save-row"><div><b>${esc(x.name)}</b><span class="mono">${esc(x.info)}</span></div>
        <button type="button" class="claim" data-m="load" data-name="${esc(x.name)}">Load</button><button type="button" class="claim danger" data-m="delete" data-name="${esc(x.name)}">Delete</button></div>`).join('') || '<p class="hint">No named saves yet.</p>'}</div>
      <div class="menu-row"><button type="button" class="claim" data-m="back">Back</button></div>`;
  }

  private multiplayerHtml() {
    let last = '';
    try { last = localStorage.getItem('sov.server') ?? ''; } catch { /* storage blocked */ }
    if (!this.a.offline) {
      // a shared world: pick a nation here, see who leads what
      const list = (this.a.lobby?.() ?? []).sort((a, b) => Number(!!b.player) - Number(!!a.player) || b.gdp - a.gdp).slice(0, 60);
      const me = this.a.mineId?.();
      return `<h2>Multiplayer</h2><p>You are on a shared world: every nation not led by a player is run by the AI, and the world keeps turning while you are away. Press <b>Space</b> in the game to vote for a pause: it pauses when every leader online agrees.</p>
        <span class="label">NATIONS · players first, then the largest economies</span>
        <div class="save-list lobby">${list.map((n) => `<div class="save-row"><div><b>${esc(n.name)}</b><span class="mono">${n.player ? `led by ${esc(n.player)}${n.online ? ' · online' : ''}` : 'AI · free to lead'} · GDP $${Math.round(n.gdp).toLocaleString('en-US')}bn</span></div>
          ${n.id === me ? '<span class="pill ok">yours</span>' : n.player ? '' : `<button type="button" class="claim primary" data-m="pick" data-nation="${n.id}">Lead it</button>`}<span></span></div>`).join('') || '<p class="hint">Sign in to see the nations.</p>'}</div>
        <div class="menu-row"><button type="button" class="claim primary" data-m="play">Return to the world</button>${this.bridge ? '<button type="button" class="claim" data-m="single">Back to single player</button>' : ''}<button type="button" class="claim" data-m="back">Back</button></div>`;
    }
    const h = this.hostInfo;
    const hosting = this.bridge ? `<span class="label">HOST A GAME ON THIS COMPUTER</span>
      <p>Run a shared world here: you and friends on the same network join it in this game or any browser. For friends elsewhere, forward port 8787 on your router to this computer.</p>
      ${h?.busy ? '<p class="hint">Starting the world server…</p>' : h?.error ? `<p class="down">${esc(h.error)}</p>` : h?.url ? `<p class="up">Your world is running. Friends join at:</p><ul class="credits">${h.addresses.map((a) => `<li class="mono">${esc(a)}</li>`).join('') || '<li>(no network found: only this computer can join)</li>'}</ul>
        <div class="menu-row"><button type="button" class="claim primary" data-m="open-host">Enter my world</button><button type="button" class="claim danger" data-m="stop-host">Stop hosting</button></div>`
        : `<div class="menu-row"><button type="button" class="claim primary" data-m="page" data-page="host">Host a new world…</button>${this.lastHosted ? `<button type="button" class="claim" data-m="host">Continue my hosted world${this.lastHosted.mode ? ` (${MODE_INFO[this.lastHosted.mode]?.name ?? ''})` : ''}</button>` : ''}</div>`}
      <span class="label">JOIN A WORLD</span>` : '';
    return `<h2>Multiplayer</h2>${hosting}
      <p>Shared worlds run on a server: many players lead nations side by side, the AI runs the rest, and the world keeps turning while you are away. Enter the address of a world server (whoever runs it can tell you; the game's server starts with <span class="mono">npm start</span>).</p>
      <div class="menu-row"><input id="mpUrl" class="text-input" type="url" placeholder="https://play.example.com" value="${esc(last)}" aria-label="Server address">
      <button type="button" class="claim primary" data-m="join">Join</button></div>
      <p class="hint">${this.a.desktop ? 'To come back to single player, press Ctrl+Shift+H, or restart the game. ' : ''}Your single-player world stays saved here.</p>
      <div class="menu-row"><button type="button" class="claim" data-m="back">Back</button></div>`;
  }

  private optionsHtml() {
    const check = (label: string, id: string, hint: string) => {
      const c = this.control<HTMLInputElement>(id);
      return c ? `<label class="check" title="${esc(hint)}"><input type="checkbox" data-ctl="${id}" ${c.checked ? 'checked' : ''}>${label}</label>` : '';
    };
    const relief = this.control<HTMLInputElement>('relief');
    const sound = this.control<HTMLElement>('soundBtn')?.getAttribute('aria-pressed') !== 'false';
    const alerts = this.control<HTMLElement>('alertsBtn')?.getAttribute('aria-pressed') === 'true';
    const vol = Math.round(this.a.music.level * 100);
    const speeds = [...this.hud.querySelectorAll<HTMLElement>('[data-act="speed"]')];
    return `<h2>Options</h2>
      <div class="opt-grid">
        <section><span class="label">GRAPHICS</span>
          ${GRAPHICS.map(([l, id, h]) => check(l, id, h)).join('')}
          ${relief ? `<div class="slider"><label><span>RELIEF</span><output>${relief.value}%</output></label><input type="range" min="0" max="200" step="10" value="${relief.value}" data-ctl="relief"></div>` : ''}
          <button type="button" class="claim" data-m="fullscreen">${document.fullscreenElement ? 'Leave full screen' : 'Full screen'}${this.a.desktop ? ' (F11)' : ''}</button>
        </section>
        <section><span class="label">SOUND</span>
          <button type="button" class="claim${sound ? ' primary' : ''}" data-m="sound">Sound effects: ${sound ? 'on' : 'off'}</button>
          ${(this.a.sfx?.groups ?? []).map(([g, label]) => { const v = Math.round((this.a.sfx!.get(g)) * 100); return `<div class="slider"><label for="sfx-${g}"><span>${label.toUpperCase()}</span><output>${v}%</output></label><input id="sfx-${g}" type="range" min="0" max="100" value="${v}" data-sfx="${g}"></div>`; }).join('')}
          <button type="button" class="claim${this.a.music.on ? ' primary' : ''}" data-m="music">Music: ${this.a.music.on ? 'playing' : 'off'}</button>
          <div class="slider"><label><span>MUSIC VOLUME</span><output>${vol}%</output></label><input id="mVol" type="range" min="0" max="100" value="${vol}"></div>
          <p class="hint">Add your own tracks from the ${art('music')} player in the top bar.</p>
        </section>
        <section><span class="label">INTERFACE</span>
          ${check('Colour-blind friendly colours', 'colorBlind', 'Blue and orange instead of green and red')}
          <button type="button" class="claim${alerts ? ' primary' : ''}" data-m="alerts">Desktop alerts: ${alerts ? 'on' : 'off'}</button>
          <p class="hint">Hover over anything for a tooltip; ? lists every key.</p>
        </section>
        ${this.topbarHtml()}
        <section><span class="label">GAMEPLAY</span>
          ${speeds.length ? `<div class="menu-row">${speeds.map((b) => `<button type="button" class="claim${b.getAttribute('aria-pressed') === 'true' ? ' primary' : ''}" data-m="speed" data-x="${b.dataset.x}">${b.dataset.x}×</button>`).join('')}</div><p class="hint">1× is a game day every 10 seconds.</p>` : '<p class="hint">Shared worlds run at the server\'s speed.</p>'}
          ${this.a.offline ? '<p class="hint">Advisers: choose what they handle for you in Politics (O).</p>' : check('Advisers govern while I am away', 'autopilot', 'The AI runs your nation while you are offline')}
        </section>
      </div>
      <div class="menu-row"><button type="button" class="claim" data-m="back">Back</button></div>`;
  }

  /** Options: which figures the top bar shows, and in what order. */
  private topbarHtml() {
    const tb = this.a.topbar;
    if (!tb) return '';
    const on = tb.get();
    const rows = [...on, ...tb.items.map(([k]) => k).filter((k) => !on.includes(k))];
    const name = (k: string) => tb.items.find(([x]) => x === k)?.[1] ?? k;
    return `<section class="tb-opts"><span class="label">TOP BAR</span>
      ${rows.map((k) => `<div class="tb-row"><label class="check plain"><input type="checkbox" data-m="tb-toggle" data-id="${k}" ${on.includes(k) ? 'checked' : ''}>${esc(name(k))}</label>
        ${on.includes(k) ? `<button type="button" class="link" data-m="tb-up" data-id="${k}" aria-label="Move up">▲</button><button type="button" class="link" data-m="tb-down" data-id="${k}" aria-label="Move down">▼</button>` : ''}</div>`).join('')}
      <button type="button" class="link" data-m="tb-reset">Back to the default</button>
      <p class="hint">Ctrl-click any figure in the bar to shrink it; click a figure to open the window where you change it.</p></section>`;
  }

  private creditsHtml() {
    return `<h2>Credits</h2>
      <p><b>Sovereign Command</b>: a real-time grand strategy game set in 2026, on a procedurally generated planet with its own climate, rivers and peoples.</p>
      <ul class="credits">
        <li>Map rendering: MapLibre GL JS (BSD licence)</li>
        <li>3D models and weather: three.js (MIT licence)</li>
        <li>Typefaces: Oswald, Barlow and IBM Plex Mono (SIL Open Font Licence)</li>
        <li>Desktop app: Electron (MIT licence)</li>
        <li>Soundtrack: composed live in your browser by the game's own synthesiser</li>
        <li>Sound effects: Kenney (kenney.nl, CC0); NASA, Kennedy Space Center (rocket liftoff, public domain); US civil-defense siren (Wikimedia Commons, public domain); OpenGameArt contributors qubodup, Bobjt, Cokabear, rockseller, WolfTech and others (CC0)</li>
        <li>Sound effects with credit: "Rubber seal dabbed on ink pad" by Subhashish Panigrahi (CC BY 3.0); "Sonic boom" by AirMan (CC BY 3.0); "Free Crowd Cheering Sounds" by Gregor Quendel (CC BY 4.0); "Light Machine Gun" by KuraiWolf (CC BY 4.0); "Jet Engine Takeoff" by dklon (CC BY 3.0); "Rain and Thunder Loop" by Pompei2 (CC BY 3.0). Trimmed and levelled for the game.</li>
      </ul>
      <div class="menu-row"><button type="button" class="claim" data-m="back">Back</button></div>`;
  }
}

/** The game's emblem: a globe in a brass ring with a star. */
/** The game's logo (client/public/brand/logo.png), or the drawn emblem below if it cannot load. */
const LOGO = `<img class="logo" src="${ASSET_BASE}brand/logo.png" alt="Sovereign Command" onerror="this.replaceWith(document.createRange().createContextualFragment(this.dataset.fallback))" data-fallback="">`;
const EMBLEM_SVG = `<svg class="emblem" viewBox="0 0 120 120" aria-hidden="true">
  <defs><linearGradient id="brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d48a"/><stop offset="1" stop-color="#9c7a34"/></linearGradient></defs>
  <circle cx="60" cy="60" r="56" fill="none" stroke="url(#brass)" stroke-width="3"/>
  <circle cx="60" cy="60" r="47" fill="#0d1a24" stroke="url(#brass)" stroke-width="1.5"/>
  <g fill="none" stroke="#d9b45a" stroke-width="1.2" opacity="0.75">
    <ellipse cx="60" cy="60" rx="20" ry="47"/><ellipse cx="60" cy="60" rx="38" ry="47"/>
    <path d="M13 60h94M18 38h84M18 82h84"/>
  </g>
  <path d="M60 30l7.6 15.4 17 2.5-12.3 12 2.9 16.9L60 68.8l-15.2 8 2.9-16.9-12.3-12 17-2.5z" fill="url(#brass)" stroke="#2a1f0c" stroke-width="1"/>
</svg>`;

const LOGO_HTML = LOGO.replace('data-fallback=""', `data-fallback="${EMBLEM_SVG.replace(/"/g, '&quot;')}"`);
