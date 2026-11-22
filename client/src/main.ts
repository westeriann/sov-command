import type { AuthResponse } from '../../shared/protocol';
import { DiplomacyPanel } from './diplomacy-panel';
import { ASSET_BASE, OFFLINE } from './config';
import { LocalConnection, startWorld } from './offline/local';
import { Cities } from './cities';
import { Presence } from './presence';
import { AccountDialog } from './account';
import { AdminPanel } from './admin';
import { CustomizeDialog } from './customize';
import { ContextMenu } from './context-menu';
import { stableClicks } from './stable-clicks';
import { ResearchPanel } from './research-panel';
import { RankingsPanel } from './rankings-panel';
import { Lobby } from './lobby';
import { Sound } from './sound';
import { Tutorial } from './tutorial';
import { installTooltips } from './tooltip';
import { Notices } from './notices';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import './theme-command.css';
import { EconomyPanel } from './economy-panel';
import { MarketPanel } from './market-panel';
import { Forces } from './forces';
import { Models3D } from './models3d';
import { UnitCard } from './unit-card';
import { Game } from './game';
import { LoginDialog } from './login';
import { GameMap } from './map';
import { clearToken, Connection, loadToken, logout, saveToken, serverAvailable } from './net';
import { Political } from './political';
import { Hud } from './ui';
import { World } from './world';

async function start() {
  const hudRoot = document.getElementById('hud')!;
  let world: World;
  let pol: Political;
  try {
    [world, pol] = await Promise.all([World.load(`${ASSET_BASE}world`), Political.load(`${ASSET_BASE}world`)]);
  } catch (err) {
    hudRoot.innerHTML = `<div class="panel fatal"><b>The planet has not been generated yet.</b>
      <p>Run <code>npm run world</code> in the project folder, then reload this page.</p>
      <p class="mono">${String((err as Error).message)}</p></div>`;
    return;
  }

  stableClicks(document);
  installTooltips(document);
  const game = new Game();
  let localWorld: Worker | null = null;
  if (OFFLINE) {
    document.body.classList.add('offline');
    try { localWorld = await startWorld(ASSET_BASE); } catch (err) {
      hudRoot.innerHTML = `<div class="panel fatal"><b>The world could not start in this browser.</b><p class="mono">${String((err as Error).message ?? err)}</p></div>`;
      return;
    }
  }
  const conn = localWorld ? new LocalConnection(game, localWorld) : new Connection(game);
  const gameMap = new GameMap(document.getElementById('map')!, world, pol);

  const select = (lat: number, lon: number, fly = false) => {
    const p = pol.provinceAt(lat, lon);
    gameMap.pin(lat, lon);
    gameMap.select(p?.id ?? null);
    hud.inspect(p, world.sample(lat, lon));
    if (fly) gameMap.map.flyTo({ center: [lon, lat], zoom: Math.max(gameMap.map.getZoom(), 3.6) });
  };

  const signedIn = (token: string) => {
    saveToken(token);
    conn.connect(token);
  };
  let login: LoginDialog;

  const sound = new Sound();
  let alerts = false;
  try { alerts = localStorage.getItem('sov.alerts') === 'on'; } catch { /* storage blocked */ }
  let tutorial: Tutorial | null = null;
  let citiesRef: Cities | null = null;
  const hud = new Hud(hudRoot, world, pol, game, {
    onMode: (m, opacity) => { gameMap.setMode(m, opacity); citiesRef?.setLights(m === 'lights'); },
    onOpacity: (v) => gameMap.setOverlayOpacity(v),
    onGrid: (on) => gameMap.setGrid(on),
    onBorders: (on) => gameMap.setBorders(on),
    onLabels: (on) => gameMap.setLabels(on),
    onRivers: (on) => gameMap.setRivers(on),
    onProjection: (p) => gameMap.setProjection(p),
    onRelief: (v) => gameMap.setRelief(v),
    onTilt: (on) => gameMap.setAutoTilt(on),
    onSelectProvince: (id) => {
      const p = pol.provinces.get(id);
      if (p) select(p.label[1], p.label[0], true);
    },
  }, {
    claim: (nation) => conn.send({ t: 'claim', nation }),
    found: (province) => conn.send({ t: 'found', province }),
    release: () => conn.send({ t: 'release' }),
    policy: (policy) => conn.send({ t: 'order', order: { kind: 'policy', policy } }),
    autopilot: (on) => conn.send({ t: 'order', order: { kind: 'autopilot', on } }),
    chat: (text, channel, to) => conn.send({ t: 'chat', text, channel, to }),
    signIn: () => login.open(),
    signOut: () => {
      const token = loadToken();
      conn.stop();
      clearToken();
      if (token) void logout(token);
      game.reset();
      game.setStatus('offline');
    },
    guide: () => tutorial?.start(),
    toggleSound: () => { sound.toggle(); return sound.on; },
    toggleMarket: () => {
      rankings?.close();
      forces?.close();
      diplomacy?.close();
      research?.close();
      economy.close();
      market.toggle();
      hud.setOpenPanel(market.isOpen ? 'market' : null);
    },
    toggleEconomy: () => {
      market.close();
      rankings?.close();
      forces?.close();
      diplomacy?.close();
      research?.close();
      economy.toggle();
      hud.setOpenPanel(economy.isOpen ? 'economy' : null);
    },
    toggleForces: (view = 'land') => {
      if (!forces) return;
      economy.close();
      market.close();
      diplomacy?.close();
      research?.close();
      rankings?.close();
      forces.toggle(view);
      hud.setOpenPanel(forces.isOpen ? ({ land: 'army', sea: 'navy', air: 'air' } as const)[forces.view] : null);
    },
    worlds: () => void lobby?.open(),
    account: () => account.openChangePassword(),
    customize: () => { const n = game.mine && pol.nations.get(game.mine.id); if (n) customize.open(n, game.me?.achievements ?? []); },
    admin: () => adminPanel?.toggle(),
    report: async (from, text) => {
      const r = await fetch('/api/report', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${loadToken() ?? ''}` },
        body: JSON.stringify({ target: from, text, reason: 'chat' }),
      });
      if (!r.ok) throw new Error('report failed');
    },
    rally: (province) => conn.send({ t: 'order', order: { kind: 'rally', province } }),
    toggleAlerts: () => {
      alerts = !alerts;
      if (alerts && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
      try { localStorage.setItem('sov.alerts', alerts ? 'on' : 'off'); } catch { /* storage blocked */ }
      return alerts;
    },
    setColorBlind: (on) => {
      document.body.classList.toggle('cb', on);
      gameMap.setColorBlind(on);
      try { localStorage.setItem('sov.cb', on ? 'on' : 'off'); } catch { /* storage blocked */ }
    },
    toggleRankings: () => {
      if (!rankings) return;
      economy.close();
      market.close();
      forces?.close();
      diplomacy?.close();
      research?.close();
      rankings.toggle();
      hud.setOpenPanel(rankings.isOpen ? 'rankings' : null);
    },
    toggleResearch: () => {
      rankings?.close();
      if (!research) return;
      economy.close();
      market.close();
      forces?.close();
      diplomacy?.close();
      research.toggle();
      hud.setOpenPanel(research.isOpen ? 'research' : null);
    },
    toggleDiplomacy: () => {
      if (!diplomacy) return;
      rankings?.close();
      economy.close();
      market.close();
      forces?.close();
      research?.close();
      diplomacy.toggle();
      hud.setOpenPanel(diplomacy.isOpen ? 'diplomacy' : null);
    },
    propose: (target, deal) => conn.send({ t: 'order', order: { kind: 'propose', target, deal } }),
    cancel: (target, pact) => conn.send({ t: 'order', order: { kind: 'cancel', target, pact } }),
    war: (target) => conn.send({ t: 'order', order: { kind: 'war', target } }),
    peace: (target) => conn.send({ t: 'order', order: { kind: 'peace', target } }),
    moveHere: (p) => forces?.moveSelectedTo(p),
    build: (province, building) => conn.send({ t: 'order', order: { kind: 'build', province, building } }),
    missile: (province) => conn.send({ t: 'order', order: { kind: 'missile', province } }),
    nuke: (province) => conn.send({ t: 'order', order: { kind: 'nuke', province } }),
    embargo: (target, on) => conn.send({ t: 'order', order: { kind: 'embargo', target, on } }),
    order: (order) => conn.send({ t: 'order', order }),
    selection: () => forces?.selected.size ?? 0,
    preview: (p) => forces?.preview(p) ?? null,
  });
  let forces: Forces | null = null;
  let diplomacy: DiplomacyPanel | null = null;
  let research: ResearchPanel | null = null;
  let rankings: RankingsPanel | null = null;
  let lobby: Lobby | null = null;
  const market = new MarketPanel(hudRoot, game);
  const economy = new EconomyPanel(hudRoot, game, pol, {
    budget: (budget) => conn.send({ t: 'order', order: { kind: 'budget', budget } }),
    tax: (tax) => conn.send({ t: 'order', order: { kind: 'policy', policy: { tax } } }),
    borders: (open) => conn.send({ t: 'order', order: { kind: 'borders', open } }),
    buildAt: (id) => buildAt(id),
    goToNation: (id) => {
      const n = pol.nations.get(id);
      const p = n && pol.provinces.get(n.capital);
      if (p) select(p.label[1], p.label[0], true);
    },
  });
  document.addEventListener('economy-closed', () => hud.setOpenPanel(null));
  document.addEventListener('market-closed', () => hud.setOpenPanel(null));
  document.addEventListener('open-market', () => { if (!market.isOpen) hudRoot.querySelector<HTMLElement>('.left [data-module="market"]')?.click(); });
  document.addEventListener('forces-closed', () => hud.setOpenPanel(null));
  document.addEventListener('diplomacy-closed', () => hud.setOpenPanel(null));
  document.addEventListener('research-closed', () => hud.setOpenPanel(null));
  document.addEventListener('rankings-closed', () => hud.setOpenPanel(null));
  lobby = new Lobby(hudRoot);
  rankings = new RankingsPanel(hudRoot, game, pol, {
    goToNation: (id) => {
      const n = pol.nations.get(id);
      const p = n && pol.provinces.get(n.capital);
      if (p) select(p.label[1], p.label[0], true);
    },
    showTerritory: (frame) => {
      const live = new Map(Object.entries(game.war.occupied).map(([p, n]) => [Number(p), n]));
      if (!frame) { gameMap.setOccupied(live, true); return; }
      // colour each province by who held it then (owner by treaty, or occupier), relative to today's map
      const shown = new Map<number, number>();
      for (const [id, orig] of pol.original) {
        const then = frame.x[id] ?? frame.o[id] ?? orig;
        if (then !== pol.provinces.get(id)?.nation) shown.set(id, then);
      }
      gameMap.setOccupied(shown, true);
    },
  });
  hud.setSound(sound.on);
  {
    const b = hudRoot.querySelector<HTMLElement>('#alertsBtn');
    if (b) { b.textContent = alerts ? 'Alerts on' : 'Alerts off'; b.setAttribute('aria-pressed', String(alerts)); }
    let cb = false;
    try { cb = localStorage.getItem('sov.cb') === 'on'; } catch { /* storage blocked */ }
    if (cb) { document.body.classList.add('cb'); gameMap.setColorBlind(true); (hudRoot.querySelector('#colorBlind') as HTMLInputElement | null)?.setAttribute('checked', ''); }
  }
  // keyboard shortcuts (ignored while typing)
  const keys: Record<string, string> = { e: 'economy', x: 'market', f: 'army', n: 'navy', b: 'air', p: 'diplomacy', r: 'research', k: 'rankings', m: 'map' };
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || (ev.target as HTMLElement).closest('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea')) return;
    const mod = keys[ev.key.toLowerCase()];
    if (mod) { hudRoot.querySelector<HTMLElement>(`[data-module="${mod}"]`)?.click(); ev.preventDefault(); }
    else if (ev.key.toLowerCase() === 'c') hudRoot.querySelector<HTMLElement>('[data-open="chat"]')?.click();
    else if (ev.key.toLowerCase() === 'g') tutorial?.start();
    else if (ev.key === '?') shortcuts.hidden = !shortcuts.hidden;
    else if (ev.key === 'Escape') { shortcuts.hidden = true; economy.close(); market.close(); forces?.close(); diplomacy?.close(); research?.close(); rankings?.close(); hud.setOpenPanel(null); }
  });
  const shortcuts = document.createElement('section');
  shortcuts.className = 'panel shortcuts';
  shortcuts.hidden = true;
  shortcuts.setAttribute('aria-label', 'Keyboard shortcuts');
  shortcuts.innerHTML = `<span class="label">KEYBOARD</span><dl>
    <dt>W A S D</dt><dd>Move the camera (Shift: faster)</dd><dt>E</dt><dd>Economy</dd><dt>X</dt><dd>Market</dd><dt>F</dt><dd>Ground forces</dd><dt>N</dt><dd>Naval ops</dd><dt>B</dt><dd>Air command</dd><dt>P</dt><dd>Diplomacy</dd><dt>R</dt><dd>Research &amp; government</dd>
    <dt>K</dt><dd>Rankings</dd><dt>M</dt><dd>Map (close windows)</dd><dt>C</dt><dd>Chat</dd><dt>G</dt><dd>Guide</dd>
    <dt>Q</dt><dd>Selected units: give an order, then click a province</dd><dt>H T L U</dt><dd>Selected units: halt, go to, appoint a general, stand down aircraft</dd><dt>Tab</dt><dd>Next army, fleet or air wing (Shift: back)</dd><dt>Esc</dt><dd>Cancel an order, close windows, clear selection</dd><dt>Arrows, + −</dt><dd>Pan and zoom (map focused)</dd><dt>?</dt><dd>This list</dd></dl>`;
  hudRoot.appendChild(shortcuts);
  hudRoot.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.module, .claim, [data-r], [data-d]')) sound.play('click'); });
  // phones: picking a module closes the menu sheet
  hudRoot.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-module]')) document.body.classList.remove('show-left'); });
  tutorial = new Tutorial(hudRoot);
  game.on((c) => { if (c.has('me') && game.me) tutorial?.maybeStart(); }); // first visit: after signing in
  research = new ResearchPanel(hudRoot, game, pol, {
    research: (tech) => conn.send({ t: 'order', order: { kind: 'research', tech } }),
    queue: (tech, remove) => conn.send({ t: 'order', order: { kind: 'research_queue', tech, remove } }),
    government: (government) => conn.send({ t: 'order', order: { kind: 'government', government } }),
    propaganda: (mode, target) => conn.send({ t: 'order', order: { kind: 'propaganda', mode, target } }),
  });
  diplomacy = new DiplomacyPanel(hudRoot, game, pol, {
    propose: (target, deal) => conn.send({ t: 'order', order: { kind: 'propose', target, deal } }),
    answer: (from, deal, accept) => conn.send({ t: 'order', order: { kind: 'answer', from, deal, accept } }),
    cancel: (target, pact) => conn.send({ t: 'order', order: { kind: 'cancel', target, pact } }),
    order: (order) => conn.send({ t: 'order', order }),
    goToNation: (id) => {
      const n = pol.nations.get(id);
      const p = n && pol.provinces.get(n.capital);
      if (p) select(p.label[1], p.label[0], true);
    },
  });
  const afterAuth = (r: AuthResponse) => { signedIn(r.token); if (r.recovery) account.showRecovery(r.recovery); };
  const account = new AccountDialog(hudRoot, (r) => { conn.stop(); signedIn(r.token); });
  login = new LoginDialog(hudRoot, afterAuth, (name) => account.openRecover(name));
  const adminPanel: AdminPanel | null = new AdminPanel(hudRoot, pol);
  const customize = new CustomizeDialog(hudRoot, (order) => conn.send({ t: 'order', order }));
  conn.onAuthFailed = () => login.open();

  await gameMap.ready();
  const cities = new Cities(gameMap.map, pol, game);
  citiesRef = cities;
  new Presence(gameMap.map, game, pol);
  game.on((c) => { if (c.has('economy') && gameMap.mode === 'lights') cities.setLights(true); });
  gameMap.setMode('political', 0.72);
  gameMap.addNationLabels();
  /** Browser notifications while the tab is in the background (opt-in). */
  const notify = (title: string, body: string) => {
    if (!alerts || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, tag: 'sovereign' }); } catch { /* not allowed here */ }
  };
  new Notices(hudRoot, game, pol, sound, {
    openModule: (id) => { if (!hudRoot.querySelector(`.left [data-module="${id}"].active`)) hudRoot.querySelector<HTMLElement>(`.left [data-module="${id}"]`)?.click(); },
    goToNation: (id) => { const n = pol.nations.get(id); const p = n && pol.provinces.get(n.capital); if (p) select(p.label[1], p.label[0], true); },
    goToProvince: (id) => { const p = pol.provinces.get(id); if (p) select(p.label[1], p.label[0], true); },
  }, notify);
  game.on((c) => {
    if (c.has('nations')) {
      for (const id of pol.addBorn(game.nations.values())) gameMap.addNationLabel(id);
      const renamed = pol.applyCustom(game.nations.values());
      if (renamed.length) gameMap.refreshNations(renamed);
    }
    if (c.has('nations') || c.has('mine') || c.has('status')) {
      gameMap.setControllers(new Set(game.humanNations().map((n) => n.id)), game.mine?.id ?? null);
    }
    if (c.has('economy')) {
      gameMap.setWealth(new Map([...game.economy.values()].map((e) => [e.id, e.gdppc])));
    }
    // news about our own nation: the Notices list plays its sounds and raises alerts
    if (c.has('war') && game.mine && game.war.battles.some((p) => game.units.some((u) => u.nation === game.mine!.id && u.province === p))) sound.play('battle');
    if (c.has('war')) {
      const moved = pol.transfer(game.war.owners); // borders changed by treaty
      if (moved) void gameMap.refreshBorders();
      gameMap.setOccupied(new Map(Object.entries(game.war.occupied).map(([p, n]) => [Number(p), n])), moved);
    }
  });
  const map = gameMap.map;
  // ?debug in the address: expose the map and game state for tests and troubleshooting
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { sovDebug: { map, pol, game } });
  const goTo = (id: number) => {
    const p = pol.provinces.get(id);
    if (p) select(p.label[1], p.label[0], true);
  };
  forces = new Forces(map, game, pol, hudRoot, {
    move: (units, to) => conn.send({ t: 'order', order: { kind: 'move', units, to } }),
    halt: (units) => conn.send({ t: 'order', order: { kind: 'halt', units } }),
    mission: (units, mission) => conn.send({ t: 'order', order: { kind: 'mission', units, mission } }),
    recruit: (unit) => conn.send({ t: 'order', order: { kind: 'recruit', unit } }),
    peace: (target) => conn.send({ t: 'order', order: { kind: 'peace', target } }),
    general: (unit) => conn.send({ t: 'order', order: { kind: 'general', unit } }),
    warhead: () => conn.send({ t: 'order', order: { kind: 'warhead' } }),
    satellite: () => conn.send({ t: 'order', order: { kind: 'satellite' } }),
    goToProvince: goTo,
  });
  const card = new UnitCard(hudRoot, map, game, pol, forces, {
    halt: (units) => conn.send({ t: 'order', order: { kind: 'halt', units } }),
    standDown: (units) => conn.send({ t: 'order', order: { kind: 'mission', units, mission: null } }),
    general: (unit) => conn.send({ t: 'order', order: { kind: 'general', unit } }),
    toast: (text) => hud.toast(text),
  });
  forces.onSelectionChange = () => { hud.refreshSelection(); card.render(); };
  // 3D troops, cities and buildings once zoomed in; counters float above their models
  const models = new Models3D(map, game, pol, forces, cities.shapes);
  models.onSize = (px) => { forces?.setLift(px ? px * 0.8 + 12 : 0); map.setLayoutProperty('buildings', 'visibility', px && models3dOn ? 'none' : 'visible'); };
  let models3dOn = true;
  try { models3dOn = localStorage.getItem('sov.models') !== 'off'; } catch { /* storage blocked */ }
  map.addLayer(models);
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { sovDebug: { map, pol, game, models } });
  models.setEnabled(models3dOn);
  hud.onModels = (on) => {
    models3dOn = on;
    models.setEnabled(on);
    try { localStorage.setItem('sov.models', on ? 'on' : 'off'); } catch { /* storage blocked */ }
  };
  hud.setModels(models3dOn);
  const goToProvince = (p: { label: [number, number] }) => select(p.label[1], p.label[0], true);
  const buildAt = (id: number) => {
    const p = pol.provinces.get(id);
    if (!p) return;
    economy.close(); hud.setOpenPanel(null);
    goToProvince(p);
    setTimeout(() => document.querySelector('#inspector .build-list, #inspector [data-act="build"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  };
  const menu = new ContextMenu(hudRoot, game, pol, {
    inspect: (p) => goToProvince(p),
    build: (p) => buildAt(p.id),
    rally: (p) => conn.send({ t: 'order', order: { kind: 'rally', province: game.mine?.mil?.rally === p.id ? null : p.id } }),
    selectUnits: (p) => forces?.selectAt(p.id),
    openModule: (id) => {
      const already = hudRoot.querySelector(`[data-module="${id}"].active`);
      if (!already) hudRoot.querySelector<HTMLElement>(`[data-module="${id}"]`)?.click();
    },
  });
  // right-click moves the selected units; Escape clears the selection
  let press: { timer: number; x: number; y: number } | null = null;
  let pressedAt = 0; // a long press already gave this order (some phones also send a right-click)
  const ordered = (p: { id: number; name: string }) => {
    const n = forces?.selected.size ?? 0;
    const r = forces?.preview(p.id);
    forces?.orderAt(p.id);
    hud.toast(r ? `${n} unit${n > 1 ? 's' : ''} ordered to ${p.name} · about ${Math.max(1, Math.round(r.days))} days` : `Orders sent to ${n} unit${n > 1 ? 's' : ''}: ${p.name}`);
  };
  map.on('contextmenu', (e) => {
    e.preventDefault();
    if (!forces?.selected.size) {
      // nothing selected: a menu of what to do here
      const p = pol.provinceAt(e.lngLat.lat, e.lngLat.wrap().lng);
      const ev = e.originalEvent as MouseEvent;
      if (p) menu.open(p, ev.clientX, ev.clientY);
      return;
    }
    if (Date.now() - pressedAt < 1500) return;
    pressedAt = Date.now();
    if (press) { window.clearTimeout(press.timer); press = null; } // the phone's own long-press menu got here first
    const p = pol.provinceAt(e.lngLat.lat, e.lngLat.wrap().lng);
    if (p) ordered(p); // land or sea: troops and ships move, aircraft fly a mission
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') forces?.clearSelection(); });
  // touch screens have no right-click: a long press gives the order instead
  map.on('touchstart', (e) => {
    if (press) window.clearTimeout(press.timer);
    press = null;
    if (e.points.length !== 1) return;
    const at = e.lngLat, pt = e.point;
    press = {
      x: pt.x, y: pt.y,
      timer: window.setTimeout(() => {
        press = null;
        const p = pol.provinceAt(at.lat, at.wrap().lng);
        if (!p || !forces || Date.now() - pressedAt <= 1500) return;
        pressedAt = Date.now();
        navigator.vibrate?.(30);
        if (forces.selected.size) ordered(p);
        else menu.open(p, (e.originalEvent as TouchEvent).touches?.[0]?.clientX ?? pt.x, (e.originalEvent as TouchEvent).touches?.[0]?.clientY ?? pt.y);
      }, 550),
    };
  });
  map.on('touchmove', (e) => { if (press && Math.hypot(e.point.x - press.x, e.point.y - press.y) > 12) { window.clearTimeout(press.timer); press = null; } });
  map.on('touchend', () => { if (press) { window.clearTimeout(press.timer); press = null; } });
  map.on('mousemove', (e) => {
    const lat = e.lngLat.lat, lon = e.lngLat.wrap().lng;
    hud.hover(world.sample(lat, lon), pol.provinceAt(lat, lon));
  });
  map.on('mouseout', () => hud.hover(null));
  map.on('click', (e) => {
    // an armed order (Q on the command card) goes where you click
    if (card.mapClick(pol.provinceAt(e.lngLat.lat, e.lngLat.wrap().lng) ?? null)) return;
    select(e.lngLat.lat, e.lngLat.wrap().lng);
  });

  // join the world if a server is running; otherwise stay in offline preview
  if (localWorld) {
    conn.connect('local');
    const w = localWorld;
    hudRoot.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act="speed"]');
      if (b) w.postMessage({ t: 'speed', x: Number(b.dataset.x) });
    });
    hudRoot.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act="newgame"]');
      if (!b) return;
      // pages in some viewers cannot show confirm(): ask on the button itself
      if (b.dataset.confirm === '1') { (conn as LocalConnection).newGame(); return; }
      b.dataset.confirm = '1';
      b.textContent = 'Click again to delete this world';
      setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'New game'; }, 5000);
    });
  } else if (await serverAvailable()) {
    const token = loadToken();
    if (token) signedIn(token);
    else login.open();
  }
}

start();
