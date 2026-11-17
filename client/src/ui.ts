import { money } from '../../shared/economy';
import { GOVERNMENT_INFO } from '../../shared/research';
import { BUILDINGS, BUILDING_TYPES, type BuildingType } from '../../shared/buildings';
import { MISSILE_COST } from '../../shared/military';
import { MAX_ALLIANCES, MAX_TRADE_DEALS, type Deal, type Pact } from '../../shared/diplomacy';
import { FOCI, LIMITS, type Focus, type NationPublic } from '../../shared/protocol';
import type { Change, Game } from './game';
import { WEALTH_STOPS, type MapMode } from './map';
import { RESOURCE_NAMES, type Nation, type Political, type Province, type ResourceId } from './political';
import { BIOME_INFO, formatLatLon, type BiomeId, type Sample, type World } from './world';

export interface HudEvents {
  onMode(mode: MapMode, opacity: number): void;
  onOpacity(v: number): void;
  onGrid(on: boolean): void;
  onBorders(on: boolean): void;
  onLabels(on: boolean): void;
  onRivers(on: boolean): void;
  onProjection(type: 'globe' | 'mercator'): void;
  onSelectProvince(id: number): void;
}

/** Things the player can ask the server to do. */
export interface HudActions {
  claim(nation: number): void;
  release(): void;
  policy(p: { focus?: Focus; tax?: number }): void;
  autopilot(on: boolean): void;
  chat(text: string): void;
  signIn(): void;
  signOut(): void;
  toggleEconomy(): void;
  toggleForces(): void;
  toggleDiplomacy(): void;
  toggleResearch(): void;
  guide(): void;
  toggleSound(): boolean; // returns whether sound is now on
  propose(target: number, deal: Deal): void;
  cancel(target: number, pact: Pact): void;
  war(target: number): void;
  peace(target: number): void;
  moveHere(province: number): void;
  build(province: number, building: BuildingType): void;
  missile(province: number): void;
  nuke(province: number): void;
  embargo(target: number, on: boolean): void;
  selection(): number; // how many of your units are selected
  preview(province: number): { days: number } | null;
}

// [label, data-module id, stage it arrives in (null = available)]
const MODULES: [string, string, string | null][] = [
  ['Theatre map', 'map', null],
  ['Economy', 'economy', null],
  ['Ground forces', 'army', null],
  ['Naval ops', 'navy', null],
  ['Air command', 'air', null],
  ['Diplomacy', 'diplomacy', null],
  ['R&D', 'research', null],
];

const RESOURCES: [string, string][] = [
  ['gdp', 'GDP'], ['defence', 'Defence budget'], ['fuel', 'Fuel reserve'],
  ['munitions', 'Munitions'], ['reservists', 'Reservists'], ['approval', 'Approval'],
];

const MODES: [MapMode, string][] = [
  ['political', 'Political'],
  ['wealth', 'Wealth per person'],
  ['satellite', 'Satellite only'],
  ['terrain', 'Terrain types'],
  ['elevation', 'Elevation'],
  ['climate', 'Temperature'],
];
const DEFAULT_OPACITY: Record<MapMode, number> = { political: 30, wealth: 60, satellite: 0, terrain: 70, elevation: 70, climate: 70 };
const FOCUS_NAMES: Record<Focus, string> = { economy: 'Economy', military: 'Military', research: 'Research', diplomacy: 'Diplomacy' };
const PERSONALITY_NAMES: Record<string, string> = {
  expansionist: 'Expansionist', trader: 'Trader', turtle: 'Defensive', opportunist: 'Opportunist', idealist: 'Idealist',
};
const RIVER_NAMES = ['None', 'Stream', 'River', 'Large river', 'Major river', 'Great river'];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function people(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} bn`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} m`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
}

const km2 = (n: number) => `${n.toLocaleString('en-US')} km²`;

function describeElevation(m: number) {
  return m >= 0 ? `${m.toLocaleString('en-US')} m` : `${(-m).toLocaleString('en-US')} m deep`;
}

function rainfallWord(r: number) {
  return r < 0.15 ? 'Arid' : r < 0.3 ? 'Dry' : r < 0.5 ? 'Moderate' : r < 0.7 ? 'Wet' : 'Very wet';
}

function movementCost(t: BiomeId) {
  if (t === 'mountain_wet' || t === 'mountain_dry' || t === 'ice') return 'Very slow';
  if (t === 'rainforest' || t === 'boreal' || t === 'desert_sand') return 'Slow';
  if (t === 'temperate_forest' || t === 'tundra') return 'Normal';
  return 'Fast';
}

function gameDate(ms: number) {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)}`;
}

export class Hud {
  private root: HTMLElement;
  private inspector!: HTMLElement;
  private readout!: HTMLElement;
  private clock!: HTMLElement;
  private legend!: HTMLElement;
  private comms!: HTMLElement;
  private toastEl!: HTMLElement;
  private opacityByMode = { ...DEFAULT_OPACITY };
  private selected: { p: Province; s: Sample } | null = null;
  private commsTab: 'dispatches' | 'chat' = 'dispatches';
  private policyTimer = 0;

  constructor(
    root: HTMLElement,
    private world: World,
    private pol: Political,
    private game: Game,
    private events: HudEvents,
    private actions: HudActions,
  ) {
    this.root = root;
    this.render();
    this.tick();
    setInterval(() => this.tick(), 1000);
    game.on((c) => this.onGame(c));
    this.onGame(new Set<Change>(['status', 'me', 'mine', 'nations', 'events', 'chat', 'online']));
  }

  private render() {
    const meta = this.world.meta;
    const landCells = Object.entries(meta.biome_cells).filter(([b]) => b !== 'ocean') as [BiomeId, number][];
    const landTotal = landCells.reduce((s, [, n]) => s + n, 0) || 1;
    const composition = landCells.filter(([, n]) => n / landTotal > 0.004).sort((a, b) => b[1] - a[1]);
    const landProvinces = [...this.pol.provinces.values()].filter((p) => p.kind === 'land').length;
    const worldPop = [...this.pol.nations.values()].reduce((s, n) => s + n.pop, 0);
    const largest = [...this.pol.nations.values()].sort((a, b) => b.pop - a.pop).slice(0, 5);

    this.root.innerHTML = `
      <header class="panel top">
        <div class="brand">
          <div class="emblem" aria-hidden="true"><i></i></div>
          <div>
            <div class="title">SOVEREIGN COMMAND</div>
            <div class="sub mono" id="whoami"></div>
          </div>
        </div>
        <div class="resources mono" aria-label="National resources">
          ${RESOURCES.map(([id, r]) => `<div><span>${r.toUpperCase()}</span><b id="res-${id}">—</b></div>`).join('')}
        </div>
        <div class="clock">
          <button type="button" class="status mono" id="status"></button>
          <span class="mono date" id="clock"></span>
          <span class="speed mono" id="speed" title="The world clock never pauses"></span>
          <button type="button" class="link" data-act="guide">Guide</button>
          <button type="button" class="link" data-act="sound" id="soundBtn" aria-pressed="true">Sound on</button>
          <span id="account"></span>
        </div>
      </header>

      <nav class="panel left" aria-label="Command modules">
        <span class="label">MODULES</span>
        ${MODULES.map(([name, id, stage]) => `
          <button type="button" class="module${id === 'map' ? ' active' : ''}" data-module="${id}" ${stage ? 'disabled' : ''} ${id === 'map' ? 'aria-current="page"' : ''}>
            <span>${name.toUpperCase()}</span>${stage ? `<em>${stage}</em>` : ''}
          </button>`).join('')}
        <span class="label sep">MAP MODE</span>
        <div class="modes" role="radiogroup" aria-label="Map mode">
          ${MODES.map(([id, label], i) => `
            <label class="radio"><input type="radio" name="mode" value="${id}" ${i === 0 ? 'checked' : ''}>${label}</label>`).join('')}
        </div>
        <div class="slider" id="opacityRow">
          <label for="opacity"><span>OVERLAY</span><output id="opacityOut">${DEFAULT_OPACITY.political}%</output></label>
          <input id="opacity" type="range" min="0" max="100" value="${DEFAULT_OPACITY.political}">
        </div>
        <div class="legend" id="legend" hidden></div>
        <span class="label sep">VIEW</span>
        <label class="check"><input type="checkbox" id="borders" checked>Borders</label>
        <label class="check"><input type="checkbox" id="rivers" checked>Rivers</label>
        <label class="check"><input type="checkbox" id="labels" checked>Names</label>
        <label class="check"><input type="checkbox" id="grid">Grid lines</label>
        <div class="seg" role="group" aria-label="Projection">
          <button type="button" data-proj="globe" aria-pressed="true">Globe</button>
          <button type="button" data-proj="mercator" aria-pressed="false">Flat</button>
        </div>
      </nav>

      <aside class="panel right" aria-live="polite">
        <section id="myNation" hidden></section>
        <div id="inspector">
          <span class="label">SELECTION</span>
          <p class="hint">Click a province or sea zone to inspect it.</p>
        </div>
        <div class="world">
          <span class="label">WORLD · SEED ${meta.seed}</span>
          <div class="kv mono">
            <span>Players online</span><span id="statOnline">—</span>
            <span>Nations led by players</span><span id="statHumans">—</span>
            <span>Nations run by AI</span><span id="statAi">${this.pol.nations.size}</span>
            <span>Provinces</span><span>${landProvinces.toLocaleString('en-US')}</span>
            <span>Population</span><span>${people(worldPop)}</span>
          </div>
          <div class="composition" aria-label="Land surface by terrain type">
            ${composition.map(([b, n]) => `<i style="flex:${n};background:${BIOME_INFO[b].color}" title="${BIOME_INFO[b].name} ${(n / landTotal * 100).toFixed(1)}%"></i>`).join('')}
          </div>
          <span class="label">MOST POPULOUS</span>
          <ol class="ranking">
            ${largest.map((n) => `<li><button type="button" data-province="${n.capital}"><i style="background:${n.color}"></i>${esc(n.short)}<span class="mono">${people(n.pop)}</span></button></li>`).join('')}
          </ol>
        </div>
      </aside>

      <section class="panel comms" id="comms" hidden aria-label="Dispatches and chat">
        <div class="comms-tabs" role="tablist">
          <button type="button" role="tab" data-tab="dispatches">Dispatches</button>
          <button type="button" role="tab" data-tab="chat">World chat</button>
          <button type="button" class="link close" data-tab="close" aria-label="Close">Close</button>
        </div>
        <ol class="comms-list mono" id="commsList"></ol>
        <form class="chat-form" id="chatForm" hidden>
          <label for="chatInput" class="visually-hidden">Message</label>
          <input id="chatInput" maxlength="${LIMITS.chatLength}" placeholder="Message everyone in this world" autocomplete="off">
          <button type="submit">Send</button>
        </form>
      </section>

      <footer class="panel taskbar" aria-label="Forces and communications">
        <span class="mono tag">FORCES</span>
        <span class="empty" id="forcesSummary">Take command of a nation to raise armies.</span>
        <button type="button" data-module="army">ARMY</button>
        <button type="button" data-open="dispatches" id="btnDispatches">DISPATCHES</button>
        <button type="button" data-open="chat" id="btnChat">CHAT</button>
      </footer>

      <div class="readout mono" id="readout" hidden></div>
      <div class="toast" id="toast" role="status" hidden></div>
    `;

    this.inspector = this.root.querySelector('#inspector')!;
    this.readout = this.root.querySelector('#readout')!;
    this.clock = this.root.querySelector('#clock')!;
    this.legend = this.root.querySelector('#legend')!;
    this.comms = this.root.querySelector('#comms')!;
    this.toastEl = this.root.querySelector('#toast')!;
    const opacityRow = this.root.querySelector<HTMLElement>('#opacityRow')!;
    const opacity = this.root.querySelector<HTMLInputElement>('#opacity')!;
    const opacityOut = this.root.querySelector<HTMLOutputElement>('#opacityOut')!;
    let mode: MapMode = 'political';

    this.root.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
      r.addEventListener('change', () => {
        mode = r.value as MapMode;
        opacityRow.hidden = mode === 'satellite';
        opacity.value = String(this.opacityByMode[mode]);
        opacityOut.value = `${opacity.value}%`;
        this.renderLegend(mode);
        this.events.onMode(mode, this.opacityByMode[mode] / 100);
      }),
    );
    opacity.addEventListener('input', () => {
      this.opacityByMode[mode] = Number(opacity.value);
      opacityOut.value = `${opacity.value}%`;
      this.events.onOpacity(Number(opacity.value) / 100);
    });
    const toggle = (id: string, fn: (on: boolean) => void) =>
      this.root.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener('change', (e) => fn((e.target as HTMLInputElement).checked));
    toggle('grid', (on) => this.events.onGrid(on));
    toggle('borders', (on) => this.events.onBorders(on));
    toggle('labels', (on) => this.events.onLabels(on));
    toggle('rivers', (on) => this.events.onRivers(on));
    const projButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-proj]');
    projButtons.forEach((b) =>
      b.addEventListener('click', () => {
        projButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        this.events.onProjection(b.dataset.proj as 'globe' | 'mercator');
      }),
    );

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'autopilot') this.actions.autopilot(t.checked);
    });
    this.root.querySelector<HTMLFormElement>('#chatForm')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.root.querySelector<HTMLInputElement>('#chatInput')!;
      if (input.value.trim()) this.actions.chat(input.value);
      input.value = '';
    });
  }

  // ---- events ---------------------------------------------------------------
  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    const prov = t.closest<HTMLElement>('[data-province]:not([data-act])'); // action buttons carry a province too
    if (prov) return this.events.onSelectProvince(Number(prov.dataset.province));
    const mod = t.closest<HTMLElement>('[data-module]')?.dataset.module;
    if (mod === 'navy' || mod === 'air') { if (this.openPanel !== 'army') this.actions.toggleForces(); return; }
    if (mod === 'diplomacy' || (mod === 'map' && this.openPanel === 'diplomacy')) { this.actions.toggleDiplomacy(); return; }
    if (mod === 'research' || (mod === 'map' && this.openPanel === 'research')) { this.actions.toggleResearch(); return; }
    if (mod === 'economy' || mod === 'map' || mod === 'army') {
      if (mod === 'army' || (mod === 'map' && this.openPanel === 'army')) this.actions.toggleForces();
      if (mod === 'economy' || (mod === 'map' && this.openPanel === 'economy')) this.actions.toggleEconomy();
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'claim') this.actions.claim(Number(act.dataset.nation));
      else if (a === 'release') {
        if (act.dataset.confirm === '1') this.actions.release();
        else {
          act.dataset.confirm = '1';
          act.textContent = 'Confirm: hand this nation to the AI';
        }
      } else if (a === 'war') {
        if (act.dataset.confirm === '1') this.actions.war(Number(act.dataset.nation));
        else {
          act.dataset.confirm = '1';
          act.textContent = 'Confirm: declare war';
        }
      } else if (a === 'peace') this.actions.peace(Number(act.dataset.nation));
      else if (a === 'cede') this.actions.propose(Number(act.dataset.nation), { kind: 'peace', terms: 'cede' });
      else if (a === 'propose') this.actions.propose(Number(act.dataset.nation), { kind: act.dataset.kind as 'alliance' | 'trade' });
      else if (a === 'endpact') {
        if (act.dataset.confirm === '1') this.actions.cancel(Number(act.dataset.nation), act.dataset.pact as Pact);
        else { act.dataset.confirm = '1'; act.textContent = `Confirm: end the ${act.dataset.pact === 'alliance' ? 'alliance' : 'trade agreement'}`; }
      }
      else if (a === 'movehere') this.actions.moveHere(Number(act.dataset.province));
      else if (a === 'build') this.actions.build(Number(act.dataset.province), act.dataset.building as BuildingType);
      else if (a === 'missile') this.actions.missile(Number(act.dataset.province));
      else if (a === 'embargo') this.actions.embargo(Number(act.dataset.nation), act.dataset.on === '1');
      else if (a === 'nuke') {
        if (act.dataset.confirm === '1') this.actions.nuke(Number(act.dataset.province));
        else { act.dataset.confirm = '1'; act.textContent = 'Confirm: launch a nuclear strike'; }
      }
      else if (a === 'focus') this.actions.policy({ focus: act.dataset.focus as Focus });
      else if (a === 'signin') this.actions.signIn();
      else if (a === 'signout') this.actions.signOut();
      else if (a === 'guide') this.actions.guide();
      else if (a === 'sound') this.setSound(this.actions.toggleSound());
      else if (a === 'mine' && this.game.mine) {
        const n = this.pol.nations.get(this.game.mine.id);
        if (n) this.events.onSelectProvince(n.capital);
      }
      return;
    }
    if (t.id === 'status' && this.game.status === 'offline') return this.actions.signIn();
    const open = t.closest<HTMLElement>('[data-open]')?.dataset.open as 'dispatches' | 'chat' | undefined;
    if (open) {
      const same = !this.comms.hidden && this.commsTab === open;
      this.comms.hidden = same;
      this.commsTab = open;
      this.renderComms();
      return;
    }
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (tab === 'close') this.comms.hidden = true;
    else if (tab === 'dispatches' || tab === 'chat') {
      this.commsTab = tab;
      this.renderComms();
    }
  }

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'tax') return;
    this.root.querySelector<HTMLOutputElement>('#taxOut')!.value = `${t.value}%`;
    clearTimeout(this.policyTimer);
    this.policyTimer = window.setTimeout(() => this.actions.policy({ tax: Number(t.value) }), 350);
  }

  setSound(on: boolean) {
    const b = this.root.querySelector<HTMLElement>('#soundBtn');
    if (!b) return;
    b.textContent = on ? 'Sound on' : 'Sound off';
    b.setAttribute('aria-pressed', String(on));
  }

  private openPanel: 'economy' | 'army' | 'diplomacy' | 'research' | null = null;

  /** Highlight the module whose window is open (or the map when none is). */
  setOpenPanel(panel: 'economy' | 'army' | 'diplomacy' | 'research' | null) {
    this.openPanel = panel;
    this.root.querySelectorAll<HTMLElement>('[data-module]').forEach((b) => {
      const active = b.dataset.module === (panel ?? 'map');
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  private renderResources() {
    const e = this.game.mine?.econ;
    const set = (id: string, v: string, cls = '') => {
      const el = this.root.querySelector<HTMLElement>(`#res-${id}`)!;
      el.innerHTML = v;
      el.className = cls;
    };
    if (!e) {
      for (const [id] of RESOURCES) set(id, '—');
      return;
    }
    const g = (x: number) => `<i class="${x >= 0 ? 'up' : 'down'}">${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%</i>`;
    set('gdp', `${money(e.gdp)} ${g(e.growth)}`, 'live');
    set('defence', money(e.defence), 'live');
    set('fuel', `${e.fuelDays} DAYS`, e.fuelDays < 20 ? 'live warn' : 'live');
    set('munitions', `${e.munitions}%`, e.munitions < 40 ? 'live warn' : 'live');
    set('reservists', people(e.reservists).toUpperCase(), 'live');
    set('approval', `${e.stability.toFixed(0)}%`, e.stability < 40 ? 'live bad' : e.stability < 55 ? 'live warn' : 'live good');
  }

  private renderForcesSummary() {
    const el = this.root.querySelector<HTMLElement>('#forcesSummary')!;
    const mine = this.game.mine?.id;
    if (!mine) { el.textContent = 'Take command of a nation to raise armies.'; return; }
    const units = this.game.units.filter((u) => u.nation === mine);
    const moving = units.filter((u) => u.status === 'moving').length;
    const fighting = units.filter((u) => u.status === 'fighting').length;
    const wars = this.game.war.wars.filter((w) => w.a === mine || w.b === mine).length;
    el.textContent = `${units.length} units · ${moving} moving · ${fighting} in battle${wars ? ` · ${wars} war${wars > 1 ? 's' : ''}` : ''}`;
  }

  private onGame(c: Set<Change>) {
    if (c.has('units') || c.has('war') || c.has('mine') || c.has('status')) this.renderForcesSummary();
    if (c.has('mine') || c.has('status')) this.renderResources();
    if (c.has('status') || c.has('me') || c.has('mine') || c.has('online')) this.renderHeader();
    if (c.has('mine') || c.has('status')) this.renderMyNation();
    if (c.has('nations') || c.has('online') || c.has('status')) this.renderStats();
    if ((c.has('nations') || c.has('mine') || c.has('me') || c.has('status') || c.has('economy') || c.has('war')) && this.selected) {
      this.inspect(this.selected.p, this.selected.s);
    }
    if (c.has('events') || c.has('chat')) this.renderComms();
    if (c.has('error') && this.game.lastError) this.toast(this.game.lastError);
  }

  // ---- header / status ------------------------------------------------------------
  private renderHeader() {
    const g = this.game;
    const status = this.root.querySelector<HTMLButtonElement>('#status')!;
    status.dataset.state = g.status;
    status.textContent =
      g.status === 'online' ? `● ONLINE · ${g.online} ${g.online === 1 ? 'PLAYER' : 'PLAYERS'}`
        : g.status === 'connecting' ? '● CONNECTING…' : '● OFFLINE · SIGN IN';
    status.title = g.status === 'offline' ? 'Sign in to join the world' : '';
    this.root.querySelector('#speed')!.textContent = `${g.speed}× REAL TIME`;
    const who = this.root.querySelector<HTMLElement>('#whoami')!;
    const mine = g.mine ? this.pol.nations.get(g.mine.id) : undefined;
    if (g.me && mine) {
      who.innerHTML = `<button type="button" class="link" data-act="mine">LEADING ${esc(mine.short.toUpperCase())}</button> · ${esc(g.me.name)}`;
    } else if (g.me) {
      who.textContent = `NO NATION YET · ${g.me.name}`;
    } else {
      who.textContent = 'OBSERVER · NOT SIGNED IN';
    }
    this.root.querySelector('#account')!.innerHTML = g.me
      ? `<button type="button" class="link" data-act="signout">Log out</button>`
      : `<button type="button" class="link" data-act="signin">Sign in</button>`;
  }

  private renderStats() {
    const humans = this.game.humanNations().length;
    this.root.querySelector('#statOnline')!.textContent = this.game.status === 'online' ? String(this.game.online) : '—';
    this.root.querySelector('#statHumans')!.textContent = this.game.status === 'online' ? String(humans) : '—';
    this.root.querySelector('#statAi')!.textContent = String(this.pol.nations.size - humans);
  }

  /** Policy controls for the player's own nation. Updated in place so dragging the slider is never interrupted. */
  private renderMyNation() {
    const el = this.root.querySelector<HTMLElement>('#myNation')!;
    const mine = this.game.mine;
    const def = mine ? this.pol.nations.get(mine.id) : undefined;
    el.hidden = !mine || !def;
    if (!mine || !def) {
      el.innerHTML = '';
      return;
    }
    if (el.dataset.nation !== String(mine.id)) {
      el.dataset.nation = String(mine.id);
      el.innerHTML = `
        <div class="row-between"><span class="label">YOUR NATION</span><button type="button" class="link" data-province="${def.capital}">Go to capital</button></div>
        <div class="nation-name"><i style="background:${def.color}" aria-hidden="true"></i>${esc(def.name)}</div>
        <span class="label">NATIONAL FOCUS</span>
        <div class="seg focus" role="group" aria-label="National focus">
          ${FOCI.map((f) => `<button type="button" data-act="focus" data-focus="${f}" aria-pressed="false">${FOCUS_NAMES[f]}</button>`).join('')}
        </div>
        <div class="slider">
          <label for="tax"><span>TAX RATE</span><output id="taxOut"></output></label>
          <input id="tax" type="range" min="${LIMITS.taxMin}" max="${LIMITS.taxMax}" step="1">
        </div>
        <label class="check plain"><input type="checkbox" id="autopilot">Let advisers govern while I'm away</label>
        <p class="hint">Focus shifts growth, research or military strength; open <button type="button" class="link" data-module="economy">Economy</button> for the full budget. While you are offline for more than a day, advisers take over and hand back when you return.</p>
      `;
    }
    el.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.focus === mine.focus)));
    const tax = el.querySelector<HTMLInputElement>('#tax')!;
    if (document.activeElement !== tax) {
      tax.value = String(mine.tax);
      el.querySelector<HTMLOutputElement>('#taxOut')!.value = `${mine.tax}%`;
    }
    el.querySelector<HTMLInputElement>('#autopilot')!.checked = !!mine.autopilot;
  }

  private renderComms() {
    const list = this.root.querySelector<HTMLElement>('#commsList')!;
    const form = this.root.querySelector<HTMLElement>('#chatForm')!;
    this.root.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.commsTab)));
    const chatOpen = !this.comms.hidden && this.commsTab === 'chat';
    if (chatOpen) this.game.unreadChat = 0;
    const unread = this.game.unreadChat;
    this.root.querySelector('#btnChat')!.textContent = unread ? `CHAT · ${unread}` : 'CHAT';
    form.hidden = this.commsTab !== 'chat' || !this.game.me || this.game.status !== 'online';
    const nationName = (id?: number) => (id ? this.pol.nations.get(id)?.short : undefined);
    if (this.commsTab === 'dispatches') {
      const ev = this.game.events.slice(-60).reverse();
      list.innerHTML = ev.length
        ? ev.map((e) => `<li><time>${gameDate(e.at)}</time><span class="kind k-${e.kind}">${e.kind}</span><span>${esc(e.text)}</span></li>`).join('')
        : `<li class="empty-row">${this.game.status === 'online' ? 'No dispatches yet.' : 'Sign in to receive dispatches from the world.'}</li>`;
    } else {
      const lines = this.game.chat.slice(-80);
      list.innerHTML = lines.length
        ? lines.map((l) => {
            const n = nationName(l.nation);
            return `<li><time>${new Date(l.at).toTimeString().slice(0, 5)}</time><b>${esc(l.from)}${n ? ` · ${esc(n)}` : ''}</b><span>${esc(l.text)}</span></li>`;
          }).join('')
        : `<li class="empty-row">${this.game.status === 'online' ? 'Nobody has said anything yet.' : 'Sign in to chat with other players.'}</li>`;
      list.scrollTop = list.scrollHeight;
    }
  }

  private toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout(Number(this.toastEl.dataset.timer));
    this.toastEl.dataset.timer = String(window.setTimeout(() => (this.toastEl.hidden = true), 4500));
  }

  private renderLegend(mode: MapMode) {
    const items: [string, string][] =
      mode === 'terrain'
        ? (Object.keys(BIOME_INFO) as BiomeId[]).filter((b) => b !== 'ocean').map((b) => [BIOME_INFO[b].color, BIOME_INFO[b].name])
        : mode === 'elevation'
          ? [['#06142e', 'Deep ocean'], ['#3f8fb0', 'Shelf'], ['#3e7a3c', 'Lowland'], ['#c8b26a', 'Upland'], ['#a0704a', 'Highland'], ['#e6e2dc', 'Peaks']]
          : mode === 'climate'
            ? [['#3b4cc0', 'Below −10 °C'], ['#c0d4f5', '5 °C'], ['#f2cbb7', '15 °C'], ['#ee8468', '24 °C'], ['#b40426', 'Above 30 °C']]
            : mode === 'wealth'
              ? WEALTH_STOPS.map(([v, c]) => [c, `$${v.toLocaleString('en-US')} per person`] as [string, string])
              : [];
    this.legend.hidden = items.length === 0;
    this.legend.innerHTML = items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('');
  }

  private tick() {
    const d = this.game.gameNow();
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
    this.clock.textContent = `${date} · ${d.toISOString().slice(11, 16)}Z`;
  }

  // ---- map hover and selection ----------------------------------------------------------
  hover(s: Sample | null, p?: Province) {
    this.readout.hidden = !s;
    if (!s) return;
    const n = this.pol.nationOf(p);
    const where = p ? `${p.name}${n ? ` · ${n.short}` : ''}` : BIOME_INFO[s.biome].name;
    this.readout.textContent = `${formatLatLon(s.lat, s.lon)} · ${where}`;
  }

  /** Redraw the province panel (e.g. after the unit selection changed). */
  refreshSelection() {
    if (this.selected) this.inspect(this.selected.p, this.selected.s);
  }

  inspect(p: Province | undefined, s: Sample) {
    if (!p) return;
    this.selected = { p, s };
    const n = this.pol.nationOf(p);
    this.inspector.innerHTML = p.kind === 'land' ? this.landHtml(p, n, s) : this.seaHtml(p, s);
  }

  private resourcesHtml(p: Province) {
    const entries = Object.entries(p.res ?? {}) as [ResourceId, number][];
    if (!entries.length) return '<p class="hint">No notable resources.</p>';
    return `<div class="bars">${entries
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span>${RESOURCE_NAMES[k]}</span><div class="bar" role="img" aria-label="${RESOURCE_NAMES[k]} ${v} of 100"><i style="width:${v}%"></i></div><span class="mono">${v}</span>`)
      .join('')}</div>`;
  }

  private econRows(id: number) {
    const e = this.game.economy.get(id);
    if (!e) return '';
    const rank = [...this.game.economy.values()].filter((x) => x.gdp > e.gdp).length + 1;
    return `<span>GDP</span><span>${money(e.gdp)} · #${rank}</span>
      <span>Growth</span><span class="${e.growth >= 0 ? 'up' : 'down'}">${e.growth >= 0 ? '+' : '−'}${Math.abs(e.growth * 100).toFixed(1)}% a year</span>
      <span>Per person</span><span>$${e.gdppc.toLocaleString('en-US')}</span>`;
  }

  private controllerHtml(n: Nation) {
    const g = this.game;
    const live: NationPublic | undefined = g.nations.get(n.id);
    if (g.status !== 'online' || !live) {
      return `<button type="button" class="claim" data-act="signin">Sign in to lead this nation</button>`;
    }
    const focus = `<span>Government</span><span>${live.government ? GOVERNMENT_INFO[live.government].name : '—'}</span><span>Focus</span><span>${FOCUS_NAMES[live.focus]}</span><span>Technologies</span><span>${live.techs ?? 0}</span>`;
    if (g.mine?.id === n.id) {
      return `<div class="controller you"><b>You lead this nation.</b></div>
        <div class="kv mono">${focus}</div>
        <button type="button" class="claim danger" data-act="release">Step down</button>`;
    }
    const army = `<span>Army (estimate)</span><span>~${live.army ?? 0} divisions</span>`;
    const diplomacy = this.warButtons(n);
    if (live.controller === 'human') {
      const state = live.autopilot ? 'away · advisers in charge' : live.online ? 'online' : 'offline';
      return `<div class="controller human"><b>Led by ${esc(live.player ?? 'a player')}</b><span class="mono">${state}</span></div>
        <div class="kv mono">${focus}${army}</div>${diplomacy}`;
    }
    return `<div class="controller ai"><b>Run by the AI</b><span class="mono">${PERSONALITY_NAMES[live.personality ?? ''] ?? ''} government</span></div>
      <div class="kv mono">${focus}${army}</div>
      ${g.mine ? diplomacy : `<button type="button" class="claim primary" data-act="claim" data-nation="${n.id}">Take command of this nation</button>`}`;
  }

  private occupationHtml(p: Province) {
    const unrest = this.game.war.unrest[p.id];
    const restless = unrest ? `<div class="controller enemy"><b>Unrest ${unrest}%</b><span class="mono">recently conquered · a garrison and welfare calm it</span></div>` : '';
    return restless + this.occupationOnly(p);
  }

  private occupationOnly(p: Province) {
    const occ = this.game.war.occupied[p.id];
    const fighting = this.game.war.battles.includes(p.id);
    if (!occ && !fighting) return '';
    return `<div class="controller enemy"><b>${occ ? `Occupied by the ${esc(this.pol.nations.get(occ)?.short ?? '?')}` : 'Contested'}</b>${fighting ? '<span class="mono">battle under way</span>' : ''}</div>`;
  }

  private moveHereHtml(p: Province) {
    const n = this.actions.selection();
    if (!n || !this.game.mine) return '';
    const r = this.actions.preview(p.id);
    if (!r) return `<p class="hint">Your selected units cannot reach this province. Units only enter your own land, allies’ land, and land of nations you are at war with.</p>`;
    if (r.days < 0.05) return ''; // already there
    const secs = Math.round(r.days * (86_400 / this.game.speed));
    return `<button type="button" class="claim primary" data-act="movehere" data-province="${p.id}">Move ${n} selected unit${n > 1 ? "s" : ""} here · ${r.days.toFixed(1)} days (~${secs < 90 ? `${secs} s` : `${Math.round(secs / 60)} min`})</button>`;
  }

  /** Buildings here; build buttons in your own provinces. */
  private buildingsHtml(p: Province) {
    const g = this.game, list = g.war.buildings[p.id] ?? [];
    const mine = !!g.mine && p.nation === g.mine.id && (g.war.occupied[p.id] ?? p.nation) === g.mine.id;
    const nuked = g.war.nuked.includes(p.id);
    if (!list.length && !mine && !nuked) return '';
    const coastal = p.adj.some((q) => this.pol.provinces.get(q)?.kind === 'sea');
    const missing = BUILDING_TYPES.filter((t) => !list.some((b) => b.type === t) && (!BUILDINGS[t].coastal || coastal));
    return `<span class="label">BUILDINGS</span>
      ${nuked ? '<p class="hint down">Struck by a nuclear weapon: a third of its people are gone.</p>' : ''}
      ${list.length ? `<div class="bars">${list.map((b) => `<span>${BUILDINGS[b.type].name}</span><div class="bar"><i style="width:${Math.round(b.progress * 100)}%"></i></div><span class="mono">${b.progress >= 1 ? 'ready' : `${Math.round(b.progress * 100)}%`}</span>`).join('')}</div>` : '<p class="hint">None yet.</p>'}
      ${mine && missing.length ? `<div class="build-list">${missing.map((t) => `<button type="button" class="claim" data-act="build" data-province="${p.id}" data-building="${t}" title="${BUILDINGS[t].text}">
        <b>${BUILDINGS[t].name}</b><span class="mono">$${BUILDINGS[t].cost}bn · ${BUILDINGS[t].days} days</span><span>${BUILDINGS[t].text}</span></button>`).join('')}</div>` : ''}`;
  }

  /** Missile and nuclear strikes on enemy-held provinces. */
  private strikeHtml(p: Province) {
    const g = this.game, mine = g.mine;
    const ctrl = g.war.occupied[p.id] ?? p.nation;
    if (!mine || !g.atWar(mine.id, ctrl)) return '';
    const done = mine.research?.done ?? [];
    const mil = mine.mil;
    const missile = done.includes('hypersonics')
      ? `<button type="button" class="claim" data-act="missile" data-province="${p.id}" ${mil?.missileReady ? '' : 'disabled'}>${mil?.missileReady ? `Missile strike · $${MISSILE_COST}bn` : 'Missiles reloading (one salvo a day)'}</button>` : '';
    const nuke = (mil?.warheads ?? 0) > 0 ? `<button type="button" class="claim danger" data-act="nuke" data-province="${p.id}">Nuclear strike (${mil!.warheads} warhead${mil!.warheads > 1 ? 's' : ''})</button>` : '';
    return missile || nuke ? `<div class="actions-row">${missile}${nuke}</div>` : '';
  }

  /** Treaties, war and peace with another nation, when you lead one. */
  private warButtons(n: Nation) {
    const g = this.game, mine = g.mine;
    if (!mine || mine.id === n.id) return '';
    const out = (kind: string) => mine.diplo?.outgoing.some((p) => p.to === n.id && p.deal.kind === kind);
    const offer = (kind: string) => mine.diplo?.incoming.find((p) => p.from === n.id && p.deal.kind === kind);
    if (g.atWar(mine.id, n.id)) {
      const white = offer('peace')?.deal, sent = out('peace');
      const held = Object.entries(g.war.occupied).filter(([p, o]) => o === mine.id && this.pol.provinces.get(Number(p))?.nation === n.id).length;
      const lose = Object.entries(g.war.occupied).filter(([p, o]) => o === n.id && this.pol.provinces.get(Number(p))?.nation === mine.id).length;
      return `<div class="controller enemy"><b>At war with you</b><span class="mono">we hold ${held} · they hold ${lose}</span></div>
        ${white ? `<p class="hint">They offer ${white.kind === 'peace' && white.terms === 'cede' ? `peace if you cede the ${lose} province${lose === 1 ? '' : 's'} they hold` : 'white peace'}. Answer in the Diplomacy window.</p>` : ''}
        ${sent ? '<p class="hint">Your peace proposal awaits their answer.</p>' : `<div class="actions-row">
          <button type="button" class="claim" data-act="peace" data-nation="${n.id}">Offer white peace</button>
          ${held ? `<button type="button" class="claim primary" data-act="cede" data-nation="${n.id}">Demand the ${held} province${held > 1 ? 's' : ''} we hold</button>` : ''}</div>`}`;
    }
    const pact = (kind: 'alliance' | 'trade', label: string, max: number) => {
      const name = kind === 'alliance' ? 'alliance' : 'trade agreement';
      if (g.treaty(kind, mine.id, n.id)) return `<button type="button" class="claim" data-act="endpact" data-nation="${n.id}" data-pact="${kind}">End ${name}</button>`;
      if (offer(kind)) return `<p class="hint">They propose ${name === 'alliance' ? 'an alliance' : 'a trade agreement'}: answer in the Diplomacy window.</p>`;
      if (out(kind)) return `<p class="hint">Your ${name} proposal awaits their answer.</p>`;
      const full = g.war.treaties.filter((t) => t.kind === kind && (t.a === mine.id || t.b === mine.id)).length >= max;
      return `<button type="button" class="claim" data-act="propose" data-nation="${n.id}" data-kind="${kind}" ${full ? 'disabled' : ''}>${label}</button>`;
    };
    const allied = g.treaty('alliance', mine.id, n.id), trading = g.treaty('trade', mine.id, n.id);
    return `${allied || trading ? `<div class="controller you"><b>${[allied && 'Allied', trading && 'Trade agreement'].filter(Boolean).join(' · ')}</b></div>` : ''}
      <div class="actions-row">${pact('trade', 'Propose trade agreement', MAX_TRADE_DEALS)}${pact('alliance', 'Propose alliance', MAX_ALLIANCES)}</div>
      ${g.war.embargoes.some((e) => e.from === n.id && e.to === mine.id) ? '<p class="hint down">They embargo your trade.</p>' : ''}
      <div class="actions-row">${g.war.embargoes.some((e) => e.from === mine.id && e.to === n.id)
        ? `<button type="button" class="claim" data-act="embargo" data-nation="${n.id}" data-on="0">Lift embargo</button>`
        : `<button type="button" class="claim" data-act="embargo" data-nation="${n.id}" data-on="1" title="Close your markets to them; costs them trade in proportion to your economy">Impose embargo</button>`}</div>
      ${allied ? '' : `<button type="button" class="claim danger" data-act="war" data-nation="${n.id}">Declare war</button>`}`;
  }

  private landHtml(p: Province, n: Nation | undefined, s: Sample) {
    const t = BIOME_INFO[p.terrain];
    const capital = n?.capital === p.id;
    return `
      <div class="row-between"><span class="label">PROVINCE${capital ? ' · CAPITAL' : ''}</span><span class="mono coords">${formatLatLon(s.lat, s.lon)}</span></div>
      <div class="place">
        <i style="background:${t.color}" aria-hidden="true"></i>
        <div><div class="name">${esc(p.name.toUpperCase())}</div>
        <div class="muted">${esc(t.name)}${p.coastal ? ' · coastal' : ''}</div></div>
      </div>
      <div class="kv mono">
        <span>Population</span><span>${people(p.pop ?? 0)}</span>
        <span>Area</span><span>${km2(p.area)}</span>
        <span>Mean elevation</span><span>${describeElevation(p.elev)}</span>
        <span>Highest point</span><span>${describeElevation(p.peak ?? p.elev)}</span>
        <span>Climate here</span><span>${s.temperature} °C · ${rainfallWord(s.rainfall)}</span>
        <span>Rivers</span><span>${RIVER_NAMES[p.river ?? 0]}</span>
        ${p.lake ? `<span>Lakes</span><span>${km2(p.lake)}</span>` : ''}
        <span>Movement</span><span>${movementCost(p.terrain)}${(p.river ?? 0) >= 3 ? ' · river crossing' : ''}</span>
      </div>
      ${this.occupationHtml(p)}
      ${this.moveHereHtml(p)}
      ${this.strikeHtml(p)}
      ${this.buildingsHtml(p)}
      <span class="label">RESOURCES</span>
      ${this.resourcesHtml(p)}
      ${n ? `
      <div class="nation-card">
        <div class="row-between"><span class="label">NATION</span>${capital ? '' : `<button type="button" class="link" data-province="${n.capital}">Go to capital</button>`}</div>
        <div class="nation-name"><i style="background:${n.color}" aria-hidden="true"></i>${esc(n.name)}</div>
        <div class="kv mono">
          ${this.econRows(n.id)}
          <span>Population</span><span>${people(this.game.economy.get(n.id)?.pop ?? n.pop)}</span>
          <span>Provinces</span><span>${n.provinces}</span>
          <span>Area</span><span>${km2(n.area)}</span>
          <span>Neighbours</span><span>${n.neighbours.length}</span>
        </div>
        ${this.controllerHtml(n)}
      </div>` : ''}
    `;
  }

  private seaHtml(p: Province, s: Sample) {
    const coasts = p.adj.map((id) => this.pol.provinces.get(id)).filter((q) => q?.kind === 'land').length;
    return `
      <div class="row-between"><span class="label">SEA ZONE</span><span class="mono coords">${formatLatLon(s.lat, s.lon)}</span></div>
      <div class="place">
        <i style="background:${BIOME_INFO.ocean.color}" aria-hidden="true"></i>
        <div><div class="name">${esc(p.name.toUpperCase())}</div>
        <div class="muted">International waters</div></div>
      </div>
      <div class="kv mono">
        <span>Area</span><span>${km2(p.area)}</span>
        <span>Mean depth</span><span>${describeElevation(Math.min(p.elev, -1))}</span>
        <span>Depth here</span><span>${describeElevation(Math.min(s.elevation, -1))}</span>
        <span>Coastal provinces</span><span>${coasts}</span>
        <span>Movement</span><span>Naval only</span>
      </div>
      ${this.moveHereHtml(p)}
      <span class="label">OFFSHORE RESOURCES</span>
      ${this.resourcesHtml(p)}
    `;
  }
}
