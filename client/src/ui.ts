import { art } from './art-icons';
import { terrainEffects } from '../../shared/military';
import { buildInfo, buildTipLines } from './build-info';
import { DEV_STOPS, nationDev } from './dev';
import { money } from '../../shared/economy';
import { GOVERNMENT_INFO, TECHS, techCost } from '../../shared/research';
import { maxSpeed } from '../../shared/settings';
import { HARVEST, SEASON_NAMES, coldLand, seasonAt } from '../../shared/seasons';
import { historyHtml } from './rankings-panel';
import { flagSvg } from '../../shared/flags';
import { flagOf } from './customize';
import { BUILDINGS, BUILDING_TYPES, type BuildingType, REPAIR_COST_SHARE, REPAIR_TIME_SHARE } from '../../shared/buildings';
import { MISSILE_COST } from '../../shared/military';
import { SPY_MISSIONS, type SpyMission } from '../../shared/diplomacy';
import { MAX_ALLIANCES, MAX_TRADE_DEALS, opinionWord, type Deal, type Pact } from '../../shared/diplomacy';
import { FOCI, LIMITS, type Focus, type NationPublic } from '../../shared/protocol';
import type { Change, Game } from './game';
import { RESOURCE_STOPS, SPECIALTY_COLOURS, WEALTH_STOPS, type MapMode } from './map';
import { DIPLO_CATS, type DiploCat } from './diplo-map';
import { RESOURCE_NAMES, type Nation, type Political, type Province, type ResourceId } from './political';
import { BIOME_INFO, formatLatLon, type BiomeId, type Sample, type World } from './world';
import { attr, effectLines, tip } from './tooltip';
import { buildSpeed, devLabel, development, MILITARY_WORKS } from '../../shared/development';
import { ASSET_BASE } from './config';
import { SPECIALTIES, SPECIALTY_LIST, specialtyOf } from '../../shared/specialties';

/** A figure that leads to where it can be changed (handled by the data-go router in main.ts). */
const go = (target: string, html: string, hint?: string) => `<a href="#" class="go" data-go="${target}"${hint ? ` data-tip="${attr(tip(hint))}"` : ''}>${html}</a>`;
/** Which market good each province resource feeds. */
const RES_GOOD: Record<ResourceId, string> = { farmland: 'food', timber: 'timber', oil: 'oil', gas: 'gas', coal: 'coal', ore: 'metals', rare_earths: 'rare_earths' };

export interface HudEvents {
  onMode(mode: MapMode, opacity: number): void;
  onOpacity(v: number): void;
  onBorderStrength(v: number): void;
  onGrid(on: boolean): void;
  onBorders(on: boolean): void;
  onLabels(on: boolean): void;
  onRivers(on: boolean): void;
  onProjection(type: 'globe' | 'mercator'): void;
  onRelief(v: number): void;
  onTilt(on: boolean): void;
  onSelectProvince(id: number): void;
  onResource(key: string): void;
  onDiploFilter(shown: Set<DiploCat>): void;
}

/** Things the player can ask the server to do. */
export interface HudActions {
  claim(nation: number): void;
  found(province: number): void;
  release(): void;
  policy(p: { focus?: Focus; tax?: number }): void;
  autopilot(on: boolean): void;
  chat(text: string, channel: 'world' | 'allies' | 'direct', to?: number): void;
  signIn(): void;
  signOut(): void;
  toggleEconomy(): void;
  toggleMarket(): void;
  manual(): void;
  music(): void;
  toggleForces(view?: 'land' | 'sea' | 'air'): void;
  toggleDiplomacy(): void;
  toggleResearch(): void;
  toggleRankings(): void;
  togglePolitics(): void;
  toggleEspionage(): void;
  toggleRecords(): void;
  worlds(): void;
  account(): void;
  customize(): void;
  admin(): void;
  report(from: string, text: string): Promise<void>;
  rally(province: number | null): void;
  toggleAlerts(): boolean;
  setColorBlind(on: boolean): void;
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
  order(o: import('../../shared/protocol').Order): void;
  selection(): number; // how many of your units are selected
  preview(province: number): { days: number } | null;
}

// [label, data-module id, stage it arrives in (null = available)]
const MODULES: [string, string, string | null][] = [
  ['Theatre map', 'map', null],
  ['Economy', 'economy', null],
  ['Market', 'market', null],
  ['Ground forces', 'army', null],
  ['Naval ops', 'navy', null],
  ['Air command', 'air', null],
  ['Diplomacy', 'diplomacy', null],
  ['Politics', 'politics', null],
  ['Espionage', 'espionage', null],
  ['R&D', 'research', null],
  ['Rankings', 'rankings', null],
  ['Records', 'records', null],
];

/** What each window is for, shown when hovering its button. */
const MODULE_TIPS: Record<string, string> = {
  map: tip('Theatre map', 'Close windows and look at the map', 'Key: M'),
  economy: tip('Economy', 'Budget, taxes, stability, buildings and migration', 'Key: E'),
  market: tip('Market', 'Every good and electricity: your output, use and trade, and world prices, with charts', 'Key: X'),
  army: tip('Ground forces', 'Recruit divisions and see your armies', 'Key: F'),
  navy: tip('Naval ops', 'Build fleets and see where they are', 'Key: N'),
  air: tip('Air command', 'Raise air wings, satellites and strategic weapons', 'Key: B'),
  diplomacy: tip('Diplomacy', 'Relations with every nation; treaties, contracts, gifts, envoys, demands, spies and the world council', 'Key: P'),
  espionage: tip('Espionage', 'Agent networks abroad, counter-intelligence, covert missions and reports', 'Key: J'),
  politics: tip('Politics', 'Political capital, laws, parliament (or rule by decree) and what it demands of you', 'Key: O'),
  research: tip('R&D and government', 'Technologies, the research queue, society and reforms', 'Key: R'),
  records: tip('Records', 'The ledger of every nation side by side, and the full log of dispatches', 'Key: V'),
  rankings: tip('Rankings', 'Scores, leaderboards, comparisons and map replays', 'Key: K'),
};
const RESOURCE_TIPS: Record<string, string> = {
  treasury: tip('Treasury', 'Money in the bank, and the yearly surplus or deficit', ['In debt: interest grows with the debt and with unrest', 'bad'], 'Click: Economy'),
  stability: tip('Stability', 'How content your people are', ['Below 25: coups and revolutions become possible', 'bad'], 'Click: Politics'),
  capital: tip('Political capital', 'Spent on laws, appeals, coalitions and autonomy', 'Click: Politics'),
  forces: tip('Manpower and equipment', 'Reservists free to recruit, and equipment in store', 'Units need both to be built and reinforced', 'Click: Ground forces'),
  war: tip('War', 'Your wars and the war score of each (−100..100)', 'Click: Diplomacy'),
  research: tip('Research', 'The technology under way and how far along it is', 'Click: R&D'),
  development: tip('Development', 'Your provinces\' average development, weighted by people (0..100)', 'Grows with cities and crowding together with wealth per person, and with works built', 'Click: the development map'),
  power: tip('Electricity', 'Share of demand met', ['Blackouts stop industry and anger the public', 'bad'], 'Click: Market'),
  support: tip('Parliament support', 'Laws pass at 50% of votes; wars of choice need 40%', 'Click: Politics'),
  gdp: tip('Gross domestic product', 'The size of your economy each year, and its growth', 'Taxes on it pay for everything else'),
  defence: tip('Defence budget', 'Money a year for building and keeping your forces', 'Set the military share in Economy'),
  fuel: tip('Fuel reserve', 'Days of oil your forces have in store', ['Running out: forces fight up to 40% weaker', 'bad']),
  munitions: tip('Munitions', 'Ammunition stocks for battle', ['Empty: units fight much weaker', 'bad']),
  reservists: tip('Reservists', 'Trained men free to form new units'),
  approval: tip('Approval (stability)', 'How content your people are', ['Below 25: coups and revolutions become possible', 'bad']),
};
const FOCUS_TIPS: Record<string, string> = {
  economy: tip('Economy focus', ['+0.6% growth a year', 'good']),
  military: tip('Military focus', ['Units built 20% faster', 'good'], ['+15% reservists', 'good'], ['−0.3% growth a year', 'bad']),
  research: tip('Research focus', ['Research 25% faster', 'good'], ['+0.2% growth a year', 'good']),
  diplomacy: tip('Diplomacy focus', ['+3 stability', 'good'], ['+0.2% growth a year', 'good'], ['Other nations trust you more', 'good']),
};

/** Everything the top bar can show: [id, label]. */
export const TOPBAR_ITEMS: [string, string][] = [
  ['treasury', 'Treasury'], ['gdp', 'GDP'], ['stability', 'Stability'], ['capital', 'Pol. capital'], ['forces', 'Manpower · kit'],
  ['war', 'War'], ['research', 'Research'], ['defence', 'Defence budget'], ['fuel', 'Fuel reserve'], ['munitions', 'Munitions'],
  ['power', 'Electricity'], ['support', 'Parliament'], ['reservists', 'Reservists'], ['development', 'Development'],
];
/** What the top bar shows unless the player picks otherwise (Options, Interface). */
export const TOPBAR_DEFAULT = ['treasury', 'gdp', 'stability', 'development', 'capital', 'forces', 'war', 'research'];
const TOPBAR_KEY = 'sov.topbar';
export function topbarChoice(): string[] {
  try { const v = JSON.parse(localStorage.getItem(TOPBAR_KEY) ?? 'null'); if (Array.isArray(v)) return v.filter((x) => TOPBAR_ITEMS.some(([k]) => k === x)); } catch { /* storage blocked */ }
  return [...TOPBAR_DEFAULT];
}
export function saveTopbarChoice(ids: string[]) { try { localStorage.setItem(TOPBAR_KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } }


const MODES: [MapMode, string][] = [
  ['political', 'Political'],
  ['wealth', 'Wealth per person'],
  ['development', 'Development'],
  ['resource', 'Resources'],
  ['diplomatic', 'Diplomatic'],
  ['satellite', 'Satellite only'],
  ['terrain', 'Terrain types'],
  ['elevation', 'Elevation'],
  ['climate', 'Temperature'],
  ['lights', 'Night lights (power)'],
];
const DEFAULT_OPACITY: Record<MapMode, number> = { political: 72, wealth: 60, development: 65, resource: 75, diplomatic: 72, satellite: 0, terrain: 70, elevation: 70, climate: 70, lights: 85 };
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
  /** Border strength, percent (100: as designed). */
  borderStrength = (() => { try { const v = Number(localStorage.getItem('sov.map.borders')); return v >= 0 && v <= 200 && localStorage.getItem('sov.map.borders') !== null ? v : 100; } catch { return 100; } })();
  private opacityByMode: Record<MapMode, number> = { ...DEFAULT_OPACITY, ...(() => { try { return JSON.parse(localStorage.getItem('sov.map.strength') ?? '{}') as Partial<Record<MapMode, number>>; } catch { return {}; } })() };
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
    // at high speed the game reports changes many times a second: gather them and redraw the
    // panels at most four times a second, so the interface keeps pace without stalling the map
    let pending: Set<Change> | null = null;
    game.on((c) => {
      if (c.has('error') || c.has('status') || c.has('mine')) { if (pending) { for (const k of pending) c.add(k); pending = null; } this.onGame(c); return; }
      if (pending) { for (const k of c) pending.add(k); return; }
      pending = new Set(c);
      window.setTimeout(() => { const p = pending; pending = null; if (p) this.onGame(p); }, 250);
    });
    this.onGame(new Set<Change>(['status', 'me', 'mine', 'nations', 'events', 'chat', 'online']));
  }

  // ---- the map drawer and the folding menu ---------------------------------------------
  drawerOpen = false;
  setDrawer(open: boolean) {
    this.drawerOpen = open;
    const d = this.root.querySelector<HTMLElement>('#mapDrawer');
    const b = this.root.querySelector<HTMLElement>('[data-act="mapdrawer"]');
    if (d) d.hidden = !open;
    if (b) { b.setAttribute('aria-expanded', String(open)); b.textContent = `${open ? '▾' : '▴'} MAP`; }
  }
  setLeftCollapsed(folded: boolean) {
    document.body.classList.toggle('left-collapsed', folded);
    const b = this.root.querySelector<HTMLElement>('[data-act="collapse-left"]');
    if (b) { b.setAttribute('aria-expanded', String(!folded)); b.textContent = folded ? '▸' : '◂'; }
    try { localStorage.setItem('sov.leftFolded', folded ? '1' : '0'); } catch { /* storage blocked */ }
  }

  /** Set by main: the 3D models switch in the View menu. */
  onModels: (on: boolean) => void = () => {};
  setModels(on: boolean) {
    const box = this.root.querySelector<HTMLInputElement>('#models3d');
    if (box) box.checked = on;
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
          <img class="brand-logo" src="${ASSET_BASE}brand/logo.png" alt="Sovereign Command" title="Sovereign Command" onerror="this.outerHTML='<div class=&quot;emblem&quot; title=&quot;Sovereign Command&quot;><i></i></div>'">
          <div class="sub mono" id="whoami"></div>
        </div>
        <div class="resources mono" aria-label="National figures">${this.topbarHtml()}</div>
        <div class="clock">
          <button type="button" class="status mono" id="status"></button>
          <span class="mono date" id="clock"></span>
          <span class="speed mono" id="speed" title="The world clock never pauses"></span>
          <span class="speed-ctl offline-only" role="group" aria-label="Game speed"><button type="button" data-act="pause" class="pause-btn" aria-pressed="false" data-tip="${attr(tip('Pause (Space)', 'Stop the clock; press again to resume', 'Single player only'))}">${art('pause')}</button>${[1, 5, 10, 20].map((x) => `<button type="button" data-act="speed" data-x="${x}" aria-pressed="false" title="${x === 1 ? 'A game day every 10 seconds' : `${x} times faster`}">${x}×</button>`).join('')}</span>
          <button type="button" class="link offline-only" data-act="newgame">New game</button>
          <button type="button" class="link" data-act="worlds">Worlds</button>
          <button type="button" class="link" data-act="alerts" id="alertsBtn" aria-pressed="false" title="Browser notifications when something happens to your nation while this tab is in the background">Alerts off</button>
          <button type="button" class="icon-btn" data-act="mainmenu" aria-label="Main menu" data-tip="${attr(tip('Main menu (Esc)', 'Options, multiplayer, a new campaign, the manual', 'Single player pauses while it is open'))}">${art('menu')}</button>
          <button type="button" class="icon-btn" data-act="manual" aria-label="Manual" data-tip="${attr(tip('Manual (I)', 'How everything in the game works, with links to each window'))}">i</button>
          <button type="button" class="icon-btn" data-act="music" aria-label="Music player" data-tip="${attr(tip('Music', 'Play, pause and choose the soundtrack'))}">${art('music')}</button>
          <button type="button" class="link" data-act="sound" id="soundBtn" aria-pressed="true">Sound on</button>
          <span id="account"></span>
        </div>
      </header>

      <nav class="panel left" aria-label="Command modules">
        <div class="left-head"><span class="label">MODULES</span>
          <button type="button" class="collapse-btn" data-act="collapse-left" aria-expanded="true" data-tip="${attr(tip('Fold the menu', 'Keys still open every window'))}">◂</button></div>
        ${MODULES.map(([name, id, stage]) => `
          <button type="button" class="module${id === 'map' ? ' active' : ''}" data-module="${id}" data-tip="${attr(MODULE_TIPS[id] ?? '')}" ${stage ? 'disabled' : ''} ${id === 'map' ? 'aria-current="page"' : ''}>
            <span>${name.toUpperCase()}</span>${stage ? `<em>${stage}</em>` : ''}
          </button>`).join('')}
      </nav>

      <button type="button" class="panel map-toggle" data-act="mapdrawer" aria-expanded="false" aria-controls="mapDrawer" data-tip="${attr(tip('Map modes and view', 'Political, wealth, terrain, temperature, night lights; borders, 3D, relief'))}">▴ MAP</button>
      <button type="button" class="panel home-btn" data-go="do:capital" aria-label="Back to my nation" data-tip="${attr(tip('Back to my nation (Home key)', 'Fly the camera back to your capital'))}">${art('home')}</button>
      <section class="panel map-drawer" id="mapDrawer" hidden aria-label="Map modes and view">
        <details class="drawer-sec" data-sec="mode" open><summary class="label">MAP MODE</summary>
        <div class="modes" role="radiogroup" aria-label="Map mode">
          ${MODES.map(([id, label], i) => `
            <label class="radio"><input type="radio" name="mode" value="${id}" ${i === 0 ? 'checked' : ''}>${label}</label>`).join('')}
        </div></details>
        <div class="mode-options" id="modeOptions" hidden></div>
        <div class="slider" id="opacityRow">
          <label for="opacity" data-tip="${attr(tip('Colour strength', 'How strongly the map mode is painted over the satellite imagery. Lower it to let the land show through.'))}"><span>COLOUR STRENGTH</span><output id="opacityOut">${this.opacityByMode.political}%</output></label>
          <input id="opacity" type="range" min="0" max="100" value="${this.opacityByMode.political}">
        </div>
        <div class="legend" id="legend" hidden></div>
        <details class="drawer-sec sep" data-sec="view" open><summary class="label">VIEW</summary>
        <label class="check"><input type="checkbox" id="borders" checked>Borders</label>
        <div class="slider">
          <label for="borderStrength" data-tip="${attr(tip('Border strength', 'How boldly national and province borders are drawn over the map'))}"><span>BORDER STRENGTH</span><output id="borderOut">${this.borderStrength}%</output></label>
          <input id="borderStrength" type="range" min="0" max="200" step="10" value="${this.borderStrength}">
        </div>
        <label class="check"><input type="checkbox" id="rivers" checked>Rivers</label>
        <label class="check"><input type="checkbox" id="labels" checked>Names</label>
        <label class="check"><input type="checkbox" id="grid">Grid lines</label>
        <label class="check"><input type="checkbox" id="colorBlind">Colour-blind friendly</label>
        <label class="check" title="Animated troops, ships, aircraft, cities and buildings when zoomed in"><input type="checkbox" id="models3d" checked>3D models</label>
        <label class="check" title="The camera leans over the map as you zoom in. Right-drag or Ctrl-drag tilts it by hand."><input type="checkbox" id="tilt" checked>Tilt with zoom</label>
        <div class="slider">
          <label for="relief"><span>RELIEF (3D)</span><output id="reliefOut">100%</output></label>
          <input id="relief" type="range" min="0" max="200" step="10" value="100">
        </div>
        <div class="seg" role="group" aria-label="Projection">
          <button type="button" data-proj="globe" aria-pressed="true">Globe</button>
          <button type="button" data-proj="mercator" aria-pressed="false">Flat</button>
        </div></details>
      </section>

      <aside class="panel right" aria-live="polite">
        <details class="rp-sec" id="secNation" hidden><summary class="label">YOUR NATION</summary><section id="myNation" hidden></section></details>
        <details class="rp-sec" id="secSelection" open><summary class="label">SELECTION</summary><div id="inspector">
          <p class="hint">Click a province or sea zone to inspect it.</p>
        </div></details>
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
          <select id="chatChannel" aria-label="Channel"><option value="world">World</option><option value="allies">Allies</option><option value="direct">Direct</option></select>
          <select id="chatTo" aria-label="Send to" hidden>${[...this.pol.nations.values()].sort((a, b) => a.name.localeCompare(b.name)).map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select>
          <input id="chatInput" maxlength="${LIMITS.chatLength}" placeholder="Message everyone in this world" autocomplete="off">
          <button type="submit">Send</button>
        </form>
      </section>

      <footer class="panel taskbar" aria-label="Forces and communications">
        <div class="forces-chip mono"><span class="tag">FORCES</span> <span id="forcesSummary">Take command of a nation to raise armies.</span></div>
        <span class="mono tag lens-tag">LENSES</span>
        <button type="button" data-lens="military" aria-pressed="false" data-tip="${attr(tip('Military lens', 'Wars, forces, production and supply at a glance, with advice', 'Click again to close'))}">MILITARY</button>
        <button type="button" data-lens="eco" aria-pressed="false" data-tip="${attr(tip('Eco lens', 'Treasury, taxes, shortages, power and construction at a glance, with advice', 'Click again to close'))}">ECO</button>
        <button type="button" data-open="dispatches" id="btnDispatches">DISPATCHES</button>
        <button type="button" data-open="chat" id="btnChat">CHAT</button>
        <button type="button" class="phone-only" data-act="menu" aria-label="Show or hide the menu">MENU</button>
        <button type="button" class="phone-only" data-act="info" aria-label="Show or hide details">INFO</button>
      </footer>

      <div class="readout mono" id="readout" hidden></div>
      <div class="toast" id="toast" role="status" hidden></div>
    `;

    this.inspector = this.root.querySelector('#inspector')!;
    // the two right-hand sections fold: opening one closes the other
    for (const d of this.root.querySelectorAll<HTMLDetailsElement>('.right .rp-sec')) {
      d.addEventListener('toggle', () => { if (d.open) for (const o of this.root.querySelectorAll<HTMLDetailsElement>('.right .rp-sec')) if (o !== d) o.open = false; });
    }
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
        this.renderModeOptions(mode);
        this.events.onMode(mode, this.opacityByMode[mode] / 100);
      }),
    );
    // the resource picker and the diplomatic filter
    const opts = this.root.querySelector<HTMLElement>('#modeOptions')!;
    opts.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (t.id === 'resPick') { this.resourceKey = t.value; this.events.onResource(t.value); this.renderLegend('resource'); }
      else if (t.dataset.cat) {
        const c = t.dataset.cat as DiploCat;
        if ((t as HTMLInputElement).checked) this.diploShown.add(c); else this.diploShown.delete(c);
        this.events.onDiploFilter(this.diploShown);
      }
    });
    const bs = this.root.querySelector<HTMLInputElement>('#borderStrength')!, bsOut = this.root.querySelector<HTMLOutputElement>('#borderOut')!;
    bs.addEventListener('input', () => {
      this.borderStrength = Number(bs.value);
      bsOut.value = `${bs.value}%`;
      try { localStorage.setItem('sov.map.borders', bs.value); } catch { /* storage blocked */ }
      this.events.onBorderStrength(this.borderStrength / 100);
    });
    opacity.addEventListener('input', () => {
      this.opacityByMode[mode] = Number(opacity.value);
      opacityOut.value = `${opacity.value}%`;
      try { localStorage.setItem('sov.map.strength', JSON.stringify(this.opacityByMode)); } catch { /* storage blocked */ }
      this.events.onOpacity(Number(opacity.value) / 100);
    });
    const toggle = (id: string, fn: (on: boolean) => void) =>
      this.root.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener('change', (e) => fn((e.target as HTMLInputElement).checked));
    toggle('grid', (on) => this.events.onGrid(on));
    toggle('borders', (on) => this.events.onBorders(on));
    toggle('labels', (on) => this.events.onLabels(on));
    toggle('rivers', (on) => this.events.onRivers(on));
    toggle('tilt', (on) => this.events.onTilt(on));
    toggle('models3d', (on) => this.onModels(on));
    {
      const relief = this.root.querySelector<HTMLInputElement>('#relief')!;
      const out = this.root.querySelector<HTMLOutputElement>('#reliefOut')!;
      relief.addEventListener('input', () => {
        out.value = `${relief.value}%`;
        this.events.onRelief(Number(relief.value) / 100);
      });
    }
    const projButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-proj]');
    projButtons.forEach((b) =>
      b.addEventListener('click', () => {
        projButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        this.events.onProjection(b.dataset.proj as 'globe' | 'mercator');
      }),
    );

    this.root.addEventListener('click', (e) => this.onClick(e));
    // map drawer sections fold away to save space; remember which
    for (const d of this.root.querySelectorAll<HTMLDetailsElement>('.drawer-sec[data-sec]')) if (this.secClosed.has(d.dataset.sec!)) d.open = false;
    this.root.addEventListener('toggle', (e) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.matches?.('.drawer-sec[data-sec]')) return;
      if (d.open) this.secClosed.delete(d.dataset.sec!); else this.secClosed.add(d.dataset.sec!);
      try { localStorage.setItem('sov.drawer.closed', JSON.stringify([...this.secClosed])); } catch { /* storage blocked */ }
    }, true);
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'autopilot') this.actions.autopilot(t.checked);
      if (t.id === 'colorBlind') this.actions.setColorBlind(t.checked);
      if (t.id === 'chatChannel') {
        const ch = (t as unknown as HTMLSelectElement).value;
        this.root.querySelector<HTMLElement>('#chatTo')!.hidden = ch !== 'direct';
        this.root.querySelector<HTMLInputElement>('#chatInput')!.placeholder = ch === 'world' ? 'Message everyone in this world' : ch === 'allies' ? 'Message your allies and bloc' : 'Private message';
      }
    });
    this.root.querySelector<HTMLFormElement>('#chatForm')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.root.querySelector<HTMLInputElement>('#chatInput')!;
      const channel = this.root.querySelector<HTMLSelectElement>('#chatChannel')!.value as 'world' | 'allies' | 'direct';
      const to = Number(this.root.querySelector<HTMLSelectElement>('#chatTo')!.value);
      if (input.value.trim()) this.actions.chat(input.value, channel, channel === 'direct' ? to : undefined);
      input.value = '';
    });
  }

  // ---- events ---------------------------------------------------------------
  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    const prov = t.closest<HTMLElement>('[data-province]:not([data-act])'); // action buttons carry a province too
    if (prov) return this.events.onSelectProvince(Number(prov.dataset.province));
    const mod = t.closest<HTMLElement>('[data-module]')?.dataset.module;
    const arms = { army: 'land', navy: 'sea', air: 'air' } as const;
    if (mod === 'army' || mod === 'navy' || mod === 'air') { this.actions.toggleForces(arms[mod]); return; }
    if (mod === 'map' && (this.openPanel === 'army' || this.openPanel === 'navy' || this.openPanel === 'air')) { this.actions.toggleForces(arms[this.openPanel]); return; }
    if (mod === 'diplomacy' || (mod === 'map' && this.openPanel === 'diplomacy')) { this.actions.toggleDiplomacy(); return; }
    if (mod === 'research' || (mod === 'map' && this.openPanel === 'research')) { this.actions.toggleResearch(); return; }
    if (mod === 'rankings' || (mod === 'map' && this.openPanel === 'rankings')) { this.actions.toggleRankings(); return; }
    if (mod === 'politics' || (mod === 'map' && this.openPanel === 'politics')) { this.actions.togglePolitics(); return; }
    if (mod === 'espionage' || (mod === 'map' && this.openPanel === 'espionage')) { this.actions.toggleEspionage(); return; }
    if (mod === 'records' || (mod === 'map' && this.openPanel === 'records')) { this.actions.toggleRecords(); return; }
    if (mod === 'market' || (mod === 'map' && this.openPanel === 'market')) { this.actions.toggleMarket(); return; }
    if (mod === 'economy' || mod === 'map') {
      if (mod === 'economy' || (mod === 'map' && this.openPanel === 'economy')) this.actions.toggleEconomy();
      return;
    }
    const act = t.closest<HTMLElement>('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'claim') this.actions.claim(Number(act.dataset.nation));
      else if (a === 'found') {
        if (act.dataset.confirm === '1') this.actions.found(Number(act.dataset.province));
        else { act.dataset.confirm = '1'; act.textContent = 'Confirm: start a war of independence'; }
      }
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
      else if (a === 'repair') this.actions.order({ kind: 'repair', province: Number(act.dataset.province), building: act.dataset.building as BuildingType });
      else if (a === 'network') this.actions.order({ kind: 'network', target: Number(act.dataset.nation), build: true });
      else if (a === 'autonomy') this.actions.order({ kind: 'autonomy', province: Number(act.dataset.province) });
      else if (a === 'missile') this.actions.missile(Number(act.dataset.province));
      else if (a === 'embargo') this.actions.embargo(Number(act.dataset.nation), act.dataset.on === '1');
      else if (a === 'spy') this.actions.order({ kind: 'spy', target: Number(act.dataset.nation), mission: act.dataset.mission as SpyMission });
      else if (a === 'asat') this.actions.order({ kind: 'asat', target: Number(act.dataset.nation) });
      else if (a === 'invite') this.actions.order({ kind: 'propose', target: Number(act.dataset.nation), deal: { kind: 'bloc' } });
      else if (a === 'puppet') this.actions.propose(Number(act.dataset.nation), { kind: 'peace', terms: 'puppet' });
      else if (a === 'nuke') {
        if (act.dataset.confirm === '1') this.actions.nuke(Number(act.dataset.province));
        else { act.dataset.confirm = '1'; act.textContent = 'Confirm: launch a nuclear strike'; }
      }
      else if (a === 'focus') this.actions.policy({ focus: act.dataset.focus as Focus });
      else if (a === 'signin') this.actions.signIn();
      else if (a === 'signout') this.actions.signOut();
      else if (a === 'guide') this.actions.guide();
      else if (a === 'manual') this.actions.manual();
      else if (a === 'mapdrawer') this.setDrawer(!this.drawerOpen);
      else if (a === 'collapse-left') this.setLeftCollapsed(!document.body.classList.contains('left-collapsed'));
      else if (a === 'music') this.actions.music();
      else if (a === 'worlds') this.actions.worlds();
      else if (a === 'account') this.actions.account();
      else if (a === 'customize') this.actions.customize();
      else if (a === 'admin') this.actions.admin();
      else if (a === 'report') {
        if (act.dataset.done) return;
        act.dataset.done = '1';
        void this.actions.report(act.dataset.from ?? '', act.dataset.text ?? '').then(() => { act.textContent = 'reported'; }, () => { act.textContent = 'failed'; });
      }
      else if (a === 'rally') this.actions.rally(act.dataset.province ? Number(act.dataset.province) : null);
      else if (a === 'alerts') { const on = this.actions.toggleAlerts(); act.textContent = on ? 'Alerts on' : 'Alerts off'; act.setAttribute('aria-pressed', String(on)); }
      else if (a === 'menu' || a === 'info') document.body.classList.toggle(a === 'menu' ? 'show-left' : 'show-right');
      else if (a === 'history') {
        const box = act.parentElement?.querySelector<HTMLElement>('.history-box');
        const id = Number(act.dataset.nation);
        if (box) { box.innerHTML = '<p class="hint">Loading…</p>'; void historyHtml(id, this.pol.nations.get(id)?.name ?? '').then((h) => { box.innerHTML = h; }); }
      }
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

  private openPanel: 'economy' | 'market' | 'army' | 'navy' | 'air' | 'diplomacy' | 'politics' | 'espionage' | 'records' | 'research' | 'rankings' | null = null;

  /** Highlight the module whose window is open (or the map when none is). */
  setOpenPanel(panel: 'economy' | 'market' | 'army' | 'navy' | 'air' | 'diplomacy' | 'politics' | 'espionage' | 'records' | 'research' | 'rankings' | null) {
    this.openPanel = panel;
    this.root.querySelectorAll<HTMLElement>('[data-module]').forEach((b) => {
      const active = b.dataset.module === (panel ?? 'map');
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  /** Where each top-bar figure leads when clicked. */
  private static TOPBAR_GO: Record<string, string> = {
    development: 'mode:development', treasury: 'module:economy', gdp: 'module:economy', stability: 'module:politics', capital: 'module:politics', forces: 'module:army', war: 'module:diplomacy',
    research: 'module:research', defence: 'econ:b-military', fuel: 'market:local:oil', munitions: 'module:army', power: 'market:local:power', support: 'module:politics', reservists: 'module:army',
  };
  private topbarHtml() {
    return topbarChoice().map((id) => {
      const label = TOPBAR_ITEMS.find(([k]) => k === id)![1];
      return `<div data-tip="${attr(RESOURCE_TIPS[id] ?? label)}" data-go="${Hud.TOPBAR_GO[id] ?? ''}"><span>${label.toUpperCase()}</span><b id="res-${id}">—</b></div>`;
    }).join('');
  }

  /** The player changed what the top bar shows. */
  setTopbar(ids: string[]) {
    saveTopbarChoice(ids);
    const el = this.root.querySelector<HTMLElement>('.top .resources');
    if (el) el.innerHTML = this.topbarHtml();
    this.renderResources();
  }

  private lastTreasury: number | undefined;
  /** A little "-$8bn" rising from the treasury figure. */
  private spent(amount: number) {
    const at = this.root.querySelector<HTMLElement>('#res-treasury');
    if (!at) return;
    const tag = document.createElement('span');
    tag.className = 'spent-tag mono';
    tag.textContent = `−${money(amount)}`;
    const r = at.getBoundingClientRect();
    tag.style.left = `${r.left + r.width / 2}px`; tag.style.top = `${r.bottom + 2}px`;
    document.body.appendChild(tag);
    window.setTimeout(() => tag.parentNode?.removeChild(tag), 2600);
  }

  private renderResources() {
    const e = this.game.mine?.econ, mine = this.game.mine;
    const set = (id: string, v: string, cls = '') => {
      const el = this.root.querySelector<HTMLElement>(`#res-${id}`);
      if (!el) return;
      el.innerHTML = v;
      el.className = cls;
    };
    if (!e || !mine) {
      for (const [id] of TOPBAR_ITEMS) set(id, '—');
      return;
    }
    const bal = e.revenue - e.spending;
    // money spent at once (a building, a division, a purchase): show it leaving the treasury
    if (this.lastTreasury !== undefined && this.lastTreasury - e.treasury > Math.max(0.3, Math.abs(bal) / 365 * 4)) this.spent(this.lastTreasury - e.treasury);
    this.lastTreasury = e.treasury;
    set('treasury', `${e.treasury < 0 ? '−' : ''}${money(Math.abs(e.treasury))} <i class="${bal >= 0 ? 'up' : 'down'}">${bal >= 0 ? '+' : '−'}${money(Math.abs(bal))}</i>`, e.treasury < 0 ? 'live warn' : 'live');
    set('stability', `${e.stability.toFixed(0)}%`, e.stability < 40 ? 'live bad' : e.stability < 55 ? 'live warn' : 'live good');
    set('capital', `${Math.floor(mine.politics?.capital ?? 0)}`, 'live');
    const kit = mine.mil?.equipment ?? 0;
    set('forces', `${people(e.reservists).toUpperCase()} · ${kit}`, kit < (mine.mil?.equipmentNeed ?? 0) * 3 ? 'live warn' : 'live');
    const wars = this.game.war.wars.filter((w) => w.a === mine.id || w.b === mine.id);
    if (!wars.length) set('war', 'AT PEACE', 'live good');
    else {
      const scores = wars.map((w) => mine.warScores?.[w.a === mine.id ? w.b : w.a] ?? 0);
      const worst = Math.min(...scores);
      set('war', `${wars.length} · ${worst > 0 ? '+' : ''}${worst}`, worst < -20 ? 'live bad' : 'live warn');
    }
    const r = mine.research, cur = r?.current ? TECHS.find((t) => t.id === r.current) : undefined;
    set('development', `${nationDev(mine.id, this.pol, this.game)}`, 'live');
    set('research', cur ? `${Math.round(((r!.progress ?? 0) / techCost(cur.tier, this.game.settings)) * 100)}% ${esc(cur.name.split(' ')[0].toUpperCase())}` : 'IDLE', cur ? 'live' : 'live warn');
    const cover = e.energy.demand > 0 ? e.energy.supply / e.energy.demand : 1;
    set('power', `${Math.round(Math.min(1, cover) * 100)}%`, cover < 0.99 ? 'live bad' : 'live');
    set('support', mine.politics?.support !== undefined && (mine.politics.legislature === 'parliament' || mine.politics.legislature === 'council') ? `${mine.politics.support}%` : 'DECREE', 'live');
    const g = (x: number) => `<i class="${x >= 0 ? 'up' : 'down'}">${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%</i>`;
    set('gdp', `${money(e.gdp)} ${g(e.growth)}`, 'live');
    set('defence', money(e.defence), 'live');
    set('fuel', `${e.fuelDays} DAYS`, e.fuelDays < 20 ? 'live warn' : 'live');
    set('munitions', `${e.munitions}%`, e.munitions < 40 ? 'live warn' : 'live');
    set('reservists', people(e.reservists).toUpperCase(), 'live');
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
    if (c.has('mine') || c.has('status') || c.has('war')) this.renderResources();
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
      ? `${g.me.admin ? '<button type="button" class="link" data-act="admin">Admin</button>' : ''}${g.me.guest ? '' : '<button type="button" class="link" data-act="account">Account</button>'}<button type="button" class="link" data-act="signout">Log out</button>`
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
    this.root.querySelector<HTMLElement>('#secNation')!.hidden = el.hidden;
    if (!mine || !def) {
      el.innerHTML = '';
      return;
    }
    const stamp = `${mine.id}:${def.name}:${def.color}:${JSON.stringify(def.flag ?? '')}`;
    if (el.dataset.nation !== stamp) {
      el.dataset.nation = stamp;
      el.innerHTML = `
        <div class="row-between"><span class="label">YOUR NATION</span><button type="button" class="link" data-province="${def.capital}">Go to capital</button></div>
        <div class="nation-name">${flagSvg(flagOf(def), 27, def.name)}${esc(def.name)}</div>
        <button type="button" class="link" data-act="customize">Name, colour and flag…</button>
        <span class="label">NATIONAL FOCUS</span>
        <div class="seg focus" id="focusSeg" role="group" aria-label="National focus">
          ${FOCI.map((f) => `<button type="button" data-act="focus" data-focus="${f}" aria-pressed="false" data-tip="${attr(FOCUS_TIPS[f])}">${FOCUS_NAMES[f]}</button>`).join('')}
        </div>
        <div class="slider">
          <label for="tax"><span>TAX RATE</span><output id="taxOut"></output></label>
          <input id="tax" type="range" min="${LIMITS.taxMin}" max="${LIMITS.taxMax}" step="1">
        </div>
        <label class="check plain online-only"><input type="checkbox" id="autopilot">Let advisers govern while I'm away</label>
        <p class="hint offline-only">Advisers can run parts of your nation for you: choose which in <a href="#" class="go" data-go="politics:advisers">Politics</a>.</p>
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
    this.comms.querySelectorAll<HTMLButtonElement>('.comms-tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.commsTab)));
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
            const tag = l.channel === 'allies' ? '<em class="tag">ALLIES</em>' : l.channel === 'direct' ? `<em class="tag">TO ${esc(nationName(l.to) ?? '?')}</em>` : '';
            const report = this.game.me && l.from !== this.game.me.name ? `<button type="button" class="link report" data-act="report" data-from="${esc(l.from)}" data-text="${esc(l.text)}" title="Report this message to the moderators">report</button>` : '';
            return `<li class="${l.channel ?? 'world'}"><time>${new Date(l.at).toTimeString().slice(0, 5)}</time><b>${esc(l.from)}${n ? ` · ${esc(n)}` : ''}</b>${tag}<span>${esc(l.text)} ${report}</span></li>`;
          }).join('')
        : `<li class="empty-row">${this.game.status === 'online' ? 'Nobody has said anything yet.' : 'Sign in to chat with other players.'}</li>`;
      list.scrollTop = list.scrollHeight;
    }
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout(Number(this.toastEl.dataset.timer));
    this.toastEl.dataset.timer = String(window.setTimeout(() => (this.toastEl.hidden = true), 4500));
  }

  private resourceKey = 'farmland';
  diploShown = new Set<DiploCat>(DIPLO_CATS.map(([k]) => k));
  /** The colour strength (0..1) the player chose for a map mode. */
  strength(mode: MapMode) { return this.opacityByMode[mode] / 100; }
  /** Map drawer sections the player folded away (kept between sessions). */
  private secClosed = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('sov.drawer.closed') ?? '[]') as string[]; } catch { return []; } })());

  /** Extra controls for some map modes: which resource, which relationships. */
  private renderModeOptions(mode: MapMode) {
    const el = this.root.querySelector<HTMLElement>('#modeOptions')!;
    el.hidden = mode !== 'resource' && mode !== 'diplomatic';
    if (mode === 'resource') {
      el.innerHTML = `<label class="mode-pick">Show <select id="resPick">${(Object.keys(RESOURCE_NAMES) as ResourceId[]).map((k) => `<option value="${k}"${k === this.resourceKey ? ' selected' : ''}>${RESOURCE_NAMES[k]}</option>`).join('')}
        <option value="specialty"${this.resourceKey === 'specialty' ? ' selected' : ''}>Province specialties</option></select></label>`;
    } else if (mode === 'diplomatic') {
      el.innerHTML = `<details class="drawer-sec" data-sec="show"${this.secClosed.has('show') ? '' : ' open'}><summary class="label">SHOW</summary><div class="diplo-filter">${DIPLO_CATS.map(([k, l, c]) => `<label class="check plain"><input type="checkbox" data-cat="${k}" ${this.diploShown.has(k) ? 'checked' : ''}><i style="background:${c}"></i>${esc(l)}</label>`).join('')}</div></details>`;
    }
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
              : mode === 'development'
                ? DEV_STOPS.map(([v, c]) => [c, `${v} · ${devLabel(v)}`] as [string, string])
              : mode === 'resource'
                ? (this.resourceKey === 'specialty'
                  ? SPECIALTY_LIST.map((s) => [SPECIALTY_COLOURS[s], SPECIALTIES[s].name] as [string, string])
                  : RESOURCE_STOPS.map(([v, c]) => [c, v <= 1 ? 'A little' : v >= 100 ? 'Very rich' : `${v} of 100`] as [string, string]))
                : [];
    this.legend.hidden = items.length === 0;
    this.legend.innerHTML = items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('');
  }

  private tick() {
    const d = this.game.gameNow();
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
    const n = seasonAt(d.getTime(), 45), s = seasonAt(d.getTime(), -45);
    const x = String(Math.round(this.game.speed / 8640));
    const top = maxSpeed(this.game.settings);
    this.root.querySelectorAll<HTMLElement>('[data-act="speed"]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.x === x)); b.hidden = Number(b.dataset.x) > top; });
    this.clock.textContent = `${date} · ${d.toISOString().slice(11, 16)}Z · ${SEASON_NAMES[n!].toUpperCase()} N / ${SEASON_NAMES[s!].toUpperCase()} S`;
    this.clock.title = 'Winter in cold lands: armies move 50% slower and troops on foreign soil lose strength; more electricity is needed. Harvests peak in autumn and fall in winter.';
  }

  // ---- map hover and selection ----------------------------------------------------------
  hover(s: Sample | null, p?: Province) {
    this.readout.hidden = !s;
    if (!s) return;
    const n = this.pol.nationOf(p);
    const where = p ? `${p.name}${n ? ` · ${n.short}` : ''}` : BIOME_INFO[s.biome].name;
    this.readout.textContent = `${formatLatLon(s.lat, s.lon)} · ${where}`;
  }

  /** Open one of the right-hand sections (your nation, or the selected province) and fold the other. */
  showSection(id: 'secNation' | 'secSelection') {
    for (const d of this.root.querySelectorAll<HTMLDetailsElement>('.right .rp-sec')) d.open = d.id === id;
  }

  /** Redraw the province panel (e.g. after the unit selection changed). */
  refreshSelection() {
    if (this.selected) this.inspect(this.selected.p, this.selected.s);
  }

  inspect(p: Province | undefined, s: Sample) {
    if (!p) return;
    // a new place picked: its panel opens, and your nation's folds away (one at a time, so neither is cramped)
    if (this.selected?.p.id !== p.id) this.showSection('secSelection');
    this.selected = { p, s };
    const n = this.pol.nationOf(p);
    this.inspector.innerHTML = p.kind === 'land' ? this.landHtml(p, n, s) : this.seaHtml(p, s);
  }

  private resourcesHtml(p: Province) {
    const entries = Object.entries(p.res ?? {}) as [ResourceId, number][];
    if (!entries.length) return '<p class="hint">No notable resources.</p>';
    return `<div class="bars">${entries
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span>${go(`market:local:${RES_GOOD[k]}`, RESOURCE_NAMES[k], `Open ${RESOURCE_NAMES[k].toLowerCase()} in the Market: output, use, trade and price`)}</span><div class="bar" role="img" aria-label="${RESOURCE_NAMES[k]} ${v} of 100"><i style="width:${v}%"></i></div><span class="mono">${v}</span>`)
      .join('')}</div>`;
  }

  /** What this province is known for, what that does, and how to get it. */
  private specialtyHtml(p: Province, mine: boolean) {
    const sp = specialtyOf(p as never);
    if (!sp) return '';
    const s = SPECIALTIES[sp];
    const held = this.game.mine?.specialties?.own[sp] ?? 0;
    const shared = this.game.mine?.specialties?.shared.includes(sp);
    const how = mine ? `You hold ${held} province${held === 1 ? '' : 's'} with it: each more adds less`
      : shared ? 'Already reaches you through a trade partner (half strength)'
      : s.luxury ? 'Win this province, or sign a trade agreement with its owner to share it at half strength'
      : 'Win this province to gain it';
    const t = tip(s.name, 'Known for it from its climate and place', [s.effect, 'good'], how, 'Click for your specialties in the Market');
    return `<div class="specialty" data-tip="${attr(t)}"><span class="label">SPECIALTY</span>
      ${go('market:local:spec', `<span class="sp-ico">${art(sp)}</span> <b>${s.name}</b>`)} <span class="muted">${esc(s.effect)}</span></div>`;
  }

  private econRows(id: number) {
    const e = this.game.economy.get(id);
    if (!e) return '';
    const rank = [...this.game.economy.values()].filter((x) => x.gdp > e.gdp).length + 1;
    const mine = this.game.mine?.id === id;
    const growth = `${e.growth >= 0 ? '+' : '−'}${Math.abs(e.growth * 100).toFixed(1)}% a year`;
    return `<span>GDP</span><span>${mine ? go('module:economy', money(e.gdp), 'Open Economy: budget, taxes and growth') : money(e.gdp)} · ${go('module:rankings', `#${rank}`, 'Open the rankings')}</span>
      <span>Growth</span><span class="${e.growth >= 0 ? 'up' : 'down'}">${mine ? go('side:focusSeg', growth, 'An Economy focus, trade deals, infrastructure and research raise growth') : growth}</span>
      <span>Per person</span><span>${go('module:rankings', `$${e.gdppc.toLocaleString('en-US')}`, 'Compare nations in the rankings')}</span>
      ${(() => { const dv = nationDev(id, this.pol, this.game); return `<span data-tip="${attr(tip(`Development ${dv} of 100`, devLabel(dv), 'People-weighted average of its provinces: crowding and cities together with wealth per person, and works built', 'Developed nations build faster, recruit a little faster and lean liberal'))}">Development</span><span><span class="dev-bar"><i style="width:${dv}%"></i></span> ${dv} · ${devLabel(dv)}</span>`; })()}`;
  }

  private controllerHtml(n: Nation) {
    const g = this.game;
    const live: NationPublic | undefined = g.nations.get(n.id);
    if (g.status !== 'online' || !live) {
      return `<button type="button" class="claim" data-act="signin">Sign in to lead this nation</button>`;
    }
    const own = g.mine?.id === n.id;
    const gov = live.government ? GOVERNMENT_INFO[live.government].name : '—';
    const focus = `<span>Government</span><span>${own ? go('politics:', gov, 'Open Politics: laws, parliament and reform') : go(`diplo:${n.id}`, gov, 'Open Diplomacy with this nation')}</span>
      <span>Focus</span><span>${own ? go('side:focusSeg', FOCUS_NAMES[live.focus], 'Change your national focus') : FOCUS_NAMES[live.focus]}</span>
      <span>Technologies</span><span>${own ? go('module:research', String(live.techs ?? 0), 'Open Research') : go('module:rankings', String(live.techs ?? 0), 'Compare nations in the rankings')}</span>`;
    if (g.mine?.id === n.id) {
      return `<div class="controller you"><b>You lead this nation.</b></div>
        <div class="kv mono">${focus}</div>
        <button type="button" class="claim danger" data-act="release">Step down</button>`;
    }
    const army = `<span>Army (estimate)</span><span>~${live.army ?? 0} divisions</span>`;
    const op = g.mine?.relations?.[n.id];
    const diplomacy = `${op ? `<div class="kv mono"><span>Their opinion of us</span><span class="${op.total >= 10 ? 'up' : op.total <= -10 ? 'down' : ''}">${go(`diplo:${n.id}`, `${opinionWord(op.total)} ${op.total > 0 ? '+' : ''}${op.total}`, 'Open their Diplomacy page: why, and every deal on offer')}</span></div>` : ''}
      ${g.mine ? `<div class="actions-row"><a href="#" class="claim go-btn primary" data-go="diplo:${n.id}">Diplomacy: pacts, contracts, gifts, demands…</a></div>` : ''}${this.warButtons(n)}`;
    if (live.controller === 'human') {
      const state = live.autopilot ? 'away · advisers in charge' : live.online ? 'online' : 'offline';
      return `<div class="controller human"><b>Led by ${esc(live.player ?? 'a player')}</b><span class="mono">${state}</span></div>
        <div class="kv mono">${focus}${army}</div>${diplomacy}${this.historyButton(n.id)}`;
    }
    return `<div class="controller ai"><b>Run by the AI</b><span class="mono">${PERSONALITY_NAMES[live.personality ?? ''] ?? ''} government</span></div>
      <div class="kv mono">${focus}${army}</div>
      ${g.mine ? diplomacy : `<button type="button" class="claim primary" data-act="claim" data-nation="${n.id}">Take command of this nation</button>${this.revoltHtml(n.id)}`}${this.historyButton(n.id)}`;
  }

  /** What the season means here, now. */
  private seasonHtml(p: Province) {
    const now = this.game.gameNow().getTime(), lat = p.label[1];
    const s = seasonAt(now, lat);
    if (!s) return '';
    const cold = coldLand(p.terrain, lat);
    const effects = s === 'winter' && cold ? 'armies move 50% slower; foreign troops lose strength daily' : s === 'winter' ? 'mild winter: no penalties' : '';
    return `<p class="hint season-note"><b>${SEASON_NAMES[s]}</b>${effects ? ` · ${effects}` : ''} · harvests at ${Math.round(HARVEST[s] * 100)}%</p>`;
  }

  private occupationHtml(p: Province) {
    const unrest = this.game.war.unrest[p.id];
    const mine = this.game.mine, own = !!mine && p.nation === mine.id;
    const auto = !!mine?.autonomy?.includes(p.id);
    const restless = unrest ? `<div class="controller enemy"><b>Unrest ${unrest}%</b><span class="mono">recently conquered · a garrison and welfare calm it${unrest > 60 ? ' · separatists may break away' : ''}</span></div>` : '';
    const autonomy = auto ? '<p class="hint">Self-governing: calmer, but keeps a quarter of its output.</p>'
      : own && unrest ? `<div class="actions-row"><button type="button" class="claim" data-act="autonomy" data-province="${p.id}" data-tip="${attr(tip('Grant autonomy', ['Unrest halves now and falls much faster; no revolts', 'good'], ['The province keeps a quarter of its output', 'bad'], ['Costs 15 political capital', 'bad']))}">Grant autonomy · 15</button></div>` : '';
    return restless + autonomy + this.occupationOnly(p);
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
    const secs = Math.round(r.days * (86_400 / Math.max(1, this.game.speed)));
    return `<button type="button" class="claim primary" data-act="movehere" data-province="${p.id}">Move ${n} selected unit${n > 1 ? "s" : ""} here · ${r.days.toFixed(1)} days (~${secs < 90 ? `${secs} s` : `${Math.round(secs / 60)} min`})</button>`;
  }

  /** Without a nation: found one by leading a revolt in a restless province of an AI nation. */
  private revoltHtml(nation: number) {
    const p = this.selected?.p;
    const e = this.game.economy.get(nation);
    if (!p || p.kind !== 'land' || p.nation !== nation || this.pol.nations.get(nation)?.capital === p.id) return '';
    const restless = (this.game.war.unrest[p.id] ?? 0) >= 20 || (e?.stability ?? 100) < 50;
    return restless
      ? `<button type="button" class="claim" data-act="found" data-province="${p.id}" title="Found a new nation here and two neighbouring provinces, at war with the old rulers">Lead a revolt in ${esc(p.name)}</button>`
      : '<p class="hint">Revolts are possible where stability is under 50% or a province is restless.</p>';
  }

  private historyButton(id: number) {
    return `<div class="history-wrap"><button type="button" class="link" data-act="history" data-nation="${id}">Show this nation's history</button><div class="history-box"></div></div>`;
  }

  /** Spy operations against another nation. */
  private covertHtml(target: number) {
    const mine = this.game.mine;
    if (!mine) return '';
    const busy = (mine.spyOps ?? 0) >= 3;
    const net = mine.spy?.nets[target] ?? 0, building = mine.spy?.building.includes(target);
    return `<details class="covert"><summary>Covert operations · agent network ${Math.round(net)}${building ? ' (recruiting)' : ''}${busy ? ' · 3 under way' : ''}</summary>
      <div class="actions-row">${(Object.keys(SPY_MISSIONS) as SpyMission[]).map((m) => `<button type="button" class="claim" data-act="spy" data-nation="${target}" data-mission="${m}" data-tip="${attr(tip(SPY_MISSIONS[m].name, SPY_MISSIONS[m].text, `Needs a network of ${SPY_MISSIONS[m].need}`, ['$2bn · 5 days', 'bad']))}" ${busy || net < SPY_MISSIONS[m].need ? 'disabled' : ''}>${SPY_MISSIONS[m].name}</button>`).join('')}</div>
      <p class="hint">${building ? '' : `<button type="button" class="link" data-act="network" data-nation="${target}">Recruit agents here</button> · `}Networks, counter-intelligence and reports are in <a href="#" class="go" data-go="module:espionage">Espionage</a> (J).</p></details>`;
  }

  /** Buildings here; build buttons in your own provinces. */
  private buildingsHtml(p: Province) {
    const g = this.game, list = g.war.buildings[p.id] ?? [];
    const mine = !!g.mine && p.nation === g.mine.id && (g.war.occupied[p.id] ?? p.nation) === g.mine.id;
    const nuked = g.war.nuked.includes(p.id);
    if (!list.length && !mine && !nuked) return '';
    const coastal = p.adj.some((q) => this.pol.provinces.get(q)?.kind === 'sea');
    // producers only where there is something to produce (none of the resource: not offered at all)
    const has = (t: BuildingType) => !BUILDINGS[t].needs || ((p.res as Record<string, number> | undefined)?.[BUILDINGS[t].needs!] ?? 0) > 0;
    const missing = BUILDING_TYPES.filter((t) => !list.some((b) => b.type === t) && (!BUILDINGS[t].coastal || coastal) && has(t));
    return `<span class="label">BUILDINGS</span>
      ${nuked ? '<p class="hint down">Struck by a nuclear weapon: a third of its people are gone.</p>' : ''}
      ${list.length ? `<div class="bars">${list.map((b) => b.damaged
        ? `<span class="down">${BUILDINGS[b.type].name}</span><div class="bar dmg"><i style="width:${Math.round((b.repair ?? 0) * 100)}%"></i></div><span class="mono down">${b.repair !== undefined ? `fixing ${Math.round(b.repair * 100)}%` : 'damaged'}</span>`
        : `<span>${BUILDINGS[b.type].name}</span><div class="bar"><i style="width:${Math.round(b.progress * 100)}%"></i></div><span class="mono">${b.progress >= 1 ? 'ready' : `${Math.round(b.progress * 100)}%`}</span>`).join('')}</div>` : '<p class="hint">None yet.</p>'}
      ${mine && list.some((b) => b.damaged && b.repair === undefined) ? `<div class="actions-row">${list.filter((b) => b.damaged && b.repair === undefined).map((b) => `<button type="button" class="claim primary" data-act="repair" data-province="${p.id}" data-building="${b.type}" data-tip="${attr(tip(`Repair the ${BUILDINGS[b.type].name.toLowerCase()}`, ['Damaged by a hurricane: it does nothing until repaired', 'bad'], [`Costs $${(BUILDINGS[b.type].cost * REPAIR_COST_SHARE).toFixed(1)}bn`, 'bad'], `Takes about ${Math.ceil(BUILDINGS[b.type].days * REPAIR_TIME_SHARE)} game days`))}">Repair ${BUILDINGS[b.type].name.toLowerCase()}</button>`).join('')}</div>` : ''}
      ${mine ? `<div class="actions-row">${g.mine?.mil?.rally === p.id ? `<button type="button" class="claim" data-act="rally">Clear rally point</button>` : `<button type="button" class="claim" data-act="rally" data-province="${p.id}" title="New land units march here when they are ready">Set rally point here</button>`}</div>` : ''}
      ${mine && missing.length ? `<div class="build-list">${missing.map((t) => { const info = buildInfo(t, p, g); return `<button type="button" class="claim" data-act="build" data-province="${p.id}" data-building="${t}" ${info.blocked ? 'disabled' : ''} data-tip="${attr(tip(BUILDINGS[t].name, ...effectLines(BUILDINGS[t].text), ...buildTipLines(t, p, g)))}">
        <b>${BUILDINGS[t].name}</b><span class="mono">$${BUILDINGS[t].cost}bn · ${BUILDINGS[t].days} days</span><span>${info.blocked ?? info.output ?? BUILDINGS[t].text}</span></button>`; }).join('')}</div>` : ''}`;
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
      const sats = g.nations.get(n.id)?.satellites ?? 0;
      return `<div class="controller enemy"><b>At war with you</b><span class="mono">we hold ${held} · they hold ${lose}</span></div>
        ${sats && mine.research?.done.includes('hypersonics') ? `<button type="button" class="claim" data-act="asat" data-nation="${n.id}">Shoot down a satellite ($4bn · they have ${sats})</button>` : ''}
        ${white ? `<p class="hint">They offer ${white.kind === 'peace' && white.terms === 'cede' ? `peace if you cede the ${lose} province${lose === 1 ? '' : 's'} they hold` : 'white peace'}. Answer in the Diplomacy window.</p>` : ''}
        ${sent ? '<p class="hint">Your peace proposal awaits their answer.</p>' : `<div class="actions-row">
          <a href="#" class="claim primary go-btn" data-go="peacecon:${n.id}">Peace conference… (war score ${(mine.warScores?.[n.id] ?? 0) > 0 ? '+' : ''}${mine.warScores?.[n.id] ?? 0})</a>
          <button type="button" class="claim" data-act="peace" data-nation="${n.id}">Offer white peace</button></div>`}
        ${this.covertHtml(n.id)}`;
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
      ${(() => {
        const myBloc = g.war.blocs.find((b) => b.leader === mine.id);
        const theirs = g.war.blocs.find((b) => b.members.includes(n.id));
        const lord = g.war.vassals[n.id];
        return `${theirs ? `<p class="hint">Member of ${esc(theirs.name)}.</p>` : ''}
          ${lord !== undefined ? `<p class="hint">Vassal of the ${esc(this.pol.nations.get(lord)?.name ?? '?')}.</p>` : ''}
          ${myBloc && !theirs ? `<div class="actions-row"><button type="button" class="claim" data-act="invite" data-nation="${n.id}">Invite to ${esc(myBloc.name)}</button></div>` : ''}`;
      })()}
      ${this.covertHtml(n.id)}
      ${allied ? '' : `<a href="#" class="claim danger go-btn" data-go="war:${n.id}">Declare war…</a>`}`;
  }

  private landHtml(p: Province, n: Nation | undefined, s: Sample) {
    const t = BIOME_INFO[p.terrain];
    const capital = n?.capital === p.id;
    const mineHere = !!n && this.game.mine?.id === n.id;
    return `
      <div class="row-between"><span class="label">${p.city ? 'CITY' : 'PROVINCE'}${capital ? ' · CAPITAL' : ''}</span><span class="mono coords">${formatLatLon(s.lat, s.lon)}</span></div>
      <div class="place">
        <i style="background:${t.color}" aria-hidden="true"></i>
        <div><div class="name">${esc(p.name.toUpperCase())}</div>
        <div class="muted">${esc(t.name)}${p.coastal ? ' · coastal' : ''}${p.city && p.parent !== undefined ? ` · in ${esc(this.pol.provinces.get(p.parent)?.name ?? '?')} province` : ''}</div></div>
      </div>
      <div class="kv mono">
        <span>Population</span><span>${mineHere ? go('module:economy', people(p.pop ?? 0), 'Grows with prosperity and stability: see Economy') : people(p.pop ?? 0)}</span>
        <span>Area</span><span>${km2(p.area)}</span>
        ${(() => { const fx = terrainEffects(p.terrain); return `<span data-tip="${attr(tip(`Terrain: ${t.name}`, ...fx.map(([x, k]) => (k === 'none' ? x : [x, k] as [string, 'good' | 'bad'])), 'One terrain per province: it shapes every battle and march here'))}">Terrain</span><span>${esc(t.name)} · <span class="muted">${esc(fx.filter(([, k]) => k !== 'none').slice(0, 2).map(([x]) => x).join(', '))}</span></span>`; })()}
        ${(() => { const dv = development({ ...p, gdppc: n ? this.game.economy.get(n.id)?.gdppc : undefined, built: (this.game.war.buildings[p.id] ?? []).filter((b) => b.progress >= 1 && !MILITARY_WORKS.has(b.type)).length }); return `<span data-tip="${attr(tip(`Development ${dv} of 100`, devLabel(dv), [`Building here ${Math.round(buildSpeed(dv) * 100)}% of normal speed`, dv >= 50 ? 'good' : 'bad'], 'Grows with crowding and cities together with the nation\'s wealth per person, and with works built here; developed nations recruit a little faster', dv >= 50 ? 'Cities and crowded country lean liberal and open' : 'The remote countryside leans authoritarian and looks after its own'))}">Development</span><span><span class="dev-bar"><i style="width:${dv}%"></i></span> ${dv} · ${devLabel(dv)}</span>`; })()}
        <span>Mean elevation</span><span>${go('mode:elevation', describeElevation(p.elev), 'Show the elevation map')}</span>
        <span>Highest point</span><span>${go('mode:terrain', describeElevation(p.peak ?? p.elev), 'Show the terrain map')}</span>
        <span>Climate here</span><span>${go('mode:climate', `${s.temperature} °C · ${rainfallWord(s.rainfall)}`, 'Show the temperature map')}</span>
        <span>Rivers</span><span>${go('manual:map', RIVER_NAMES[p.river ?? 0], 'Rivers slow attackers and shape borders: see the manual')}</span>
        ${p.lake ? `<span>Lakes</span><span>${km2(p.lake)}</span>` : ''}
        <span>Movement</span><span>${go('manual:forces', `${movementCost(p.terrain)}${(p.river ?? 0) >= 3 ? ' · river crossing' : ''}`, 'How terrain slows armies: see the manual')}</span>
        ${n ? `<span>Owner</span><span>${go(mineHere ? 'module:economy' : `diplo:${n.id}`, esc(n.name), mineHere ? 'Your nation: open Economy' : 'Open Diplomacy with them')}</span>` : ''}
      </div>
      ${this.specialtyHtml(p, mineHere)}
      ${this.seasonHtml(p)}
      ${this.occupationHtml(p)}
      ${this.moveHereHtml(p)}
      ${this.strikeHtml(p)}
      ${this.buildingsHtml(p)}
      <span class="label">RESOURCES</span>
      ${this.resourcesHtml(p)}
      ${n ? `
      <div class="nation-card">
        <div class="row-between"><span class="label">NATION</span>${capital ? '' : `<button type="button" class="link" data-province="${n.capital}">Go to capital</button>`}</div>
        <div class="nation-name">${flagSvg(flagOf(n), 27, n.name)}${mineHere ? go('module:economy', esc(n.name), 'Your nation: open Economy') : go(`diplo:${n.id}`, esc(n.name), 'Open Diplomacy with this nation')}</div>
        <div class="kv mono">
          ${this.econRows(n.id)}
          <span>Population</span><span>${go('module:rankings', people(this.game.economy.get(n.id)?.pop ?? n.pop), 'Compare nations in the rankings')}</span>
          <span>Provinces</span><span>${mineHere ? go('module:army', String(n.provinces), 'Win more by war or by peace terms: open the Army') : n.provinces}</span>
          <span>Area</span><span>${km2(n.area)}</span>
          <span>Neighbours</span><span>${go('module:diplomacy', String(n.neighbours.length), 'Open Diplomacy')}</span>
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
      <span class="label">OFFSHORE RESOURCES · worked by the nations whose coasts touch it</span>
      ${this.resourcesHtml(p)}
    `;
  }
}
