import { DiplomacyPanel } from './diplomacy-panel';
import { ResearchPanel } from './research-panel';
import { Sound, type Cue } from './sound';
import { Tutorial } from './tutorial';
import './styles.css';
import { EconomyPanel } from './economy-panel';
import { Forces } from './forces';
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
    [world, pol] = await Promise.all([World.load(), Political.load()]);
  } catch (err) {
    hudRoot.innerHTML = `<div class="panel fatal"><b>The planet has not been generated yet.</b>
      <p>Run <code>npm run world</code> in the project folder, then reload this page.</p>
      <p class="mono">${String((err as Error).message)}</p></div>`;
    return;
  }

  const game = new Game();
  const conn = new Connection(game);
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
  let tutorial: Tutorial | null = null;
  const hud = new Hud(hudRoot, world, pol, game, {
    onMode: (m, opacity) => gameMap.setMode(m, opacity),
    onOpacity: (v) => gameMap.setOverlayOpacity(v),
    onGrid: (on) => gameMap.setGrid(on),
    onBorders: (on) => gameMap.setBorders(on),
    onLabels: (on) => gameMap.setLabels(on),
    onRivers: (on) => gameMap.setRivers(on),
    onProjection: (p) => gameMap.setProjection(p),
    onSelectProvince: (id) => {
      const p = pol.provinces.get(id);
      if (p) select(p.label[1], p.label[0], true);
    },
  }, {
    claim: (nation) => conn.send({ t: 'claim', nation }),
    release: () => conn.send({ t: 'release' }),
    policy: (policy) => conn.send({ t: 'order', order: { kind: 'policy', policy } }),
    autopilot: (on) => conn.send({ t: 'order', order: { kind: 'autopilot', on } }),
    chat: (text) => conn.send({ t: 'chat', text }),
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
    toggleEconomy: () => {
      forces?.close();
      diplomacy?.close();
      research?.close();
      economy.toggle();
      hud.setOpenPanel(economy.isOpen ? 'economy' : null);
    },
    toggleForces: () => {
      if (!forces) return;
      economy.close();
      diplomacy?.close();
      research?.close();
      forces.toggle();
      hud.setOpenPanel(forces.isOpen ? 'army' : null);
    },
    toggleResearch: () => {
      if (!research) return;
      economy.close();
      forces?.close();
      diplomacy?.close();
      research.toggle();
      hud.setOpenPanel(research.isOpen ? 'research' : null);
    },
    toggleDiplomacy: () => {
      if (!diplomacy) return;
      economy.close();
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
    selection: () => forces?.selected.size ?? 0,
    preview: (p) => forces?.preview(p) ?? null,
  });
  let forces: Forces | null = null;
  let diplomacy: DiplomacyPanel | null = null;
  let research: ResearchPanel | null = null;
  const economy = new EconomyPanel(hudRoot, game, pol, {
    budget: (budget) => conn.send({ t: 'order', order: { kind: 'budget', budget } }),
    tax: (tax) => conn.send({ t: 'order', order: { kind: 'policy', policy: { tax } } }),
    goToNation: (id) => {
      const n = pol.nations.get(id);
      const p = n && pol.provinces.get(n.capital);
      if (p) select(p.label[1], p.label[0], true);
    },
  });
  document.addEventListener('economy-closed', () => hud.setOpenPanel(null));
  document.addEventListener('forces-closed', () => hud.setOpenPanel(null));
  document.addEventListener('diplomacy-closed', () => hud.setOpenPanel(null));
  document.addEventListener('research-closed', () => hud.setOpenPanel(null));
  hud.setSound(sound.on);
  hudRoot.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.module, .claim, [data-r], [data-d]')) sound.play('click'); });
  tutorial = new Tutorial(hudRoot);
  game.on((c) => { if (c.has('me') && game.me) tutorial?.maybeStart(); }); // first visit: after signing in
  research = new ResearchPanel(hudRoot, game, pol, {
    research: (tech) => conn.send({ t: 'order', order: { kind: 'research', tech } }),
    government: (government) => conn.send({ t: 'order', order: { kind: 'government', government } }),
  });
  diplomacy = new DiplomacyPanel(hudRoot, game, pol, {
    propose: (target, deal) => conn.send({ t: 'order', order: { kind: 'propose', target, deal } }),
    answer: (from, deal, accept) => conn.send({ t: 'order', order: { kind: 'answer', from, deal, accept } }),
    cancel: (target, pact) => conn.send({ t: 'order', order: { kind: 'cancel', target, pact } }),
    goToNation: (id) => {
      const n = pol.nations.get(id);
      const p = n && pol.provinces.get(n.capital);
      if (p) select(p.label[1], p.label[0], true);
    },
  });
  login = new LoginDialog(hudRoot, (r) => signedIn(r.token));
  conn.onAuthFailed = () => login.open();

  await gameMap.ready();
  gameMap.setMode('political', 0.3);
  gameMap.addNationLabels();
  let lastHeard: unknown = null;
  game.on((c) => {
    if (c.has('nations') || c.has('mine') || c.has('status')) {
      gameMap.setControllers(new Set(game.humanNations().map((n) => n.id)), game.mine?.id ?? null);
    }
    if (c.has('economy')) {
      gameMap.setWealth(new Map([...game.economy.values()].map((e) => [e.id, e.gdppc])));
    }
    if (c.has('events') && game.mine && game.events.length) {
      // cue sounds for news about our own nation
      const e = game.events[game.events.length - 1];
      const me = pol.nations.get(game.mine.id);
      if (me && e !== lastHeard && (e.nation === me.id || e.text.includes(me.name))) {
        const cue: Partial<Record<string, Cue>> = { war: 'war', peace: 'peace', research: 'research', politics: 'alert', diplomacy: 'notice' };
        const c2 = cue[e.kind];
        if (c2) sound.play(c2);
      }
      lastHeard = e;
    }
    if (c.has('war') && game.mine && game.war.battles.some((p) => game.units.some((u) => u.nation === game.mine!.id && u.province === p))) sound.play('battle');
    if (c.has('war')) {
      const moved = pol.transfer(game.war.owners); // borders changed by treaty
      gameMap.setOccupied(new Map(Object.entries(game.war.occupied).map(([p, n]) => [Number(p), n])), moved);
    }
  });
  const map = gameMap.map;
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
    goToProvince: goTo,
  });
  forces.onSelectionChange = () => hud.refreshSelection();
  // right-click moves the selected units; Escape clears the selection
  map.on('contextmenu', (e) => {
    if (!forces?.selected.size) return;
    e.preventDefault();
    const p = pol.provinceAt(e.lngLat.lat, e.lngLat.wrap().lng);
    if (p) forces.orderAt(p.id); // land or sea: troops and ships move, aircraft fly a mission
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') forces?.clearSelection(); });
  map.on('mousemove', (e) => {
    const lat = e.lngLat.lat, lon = e.lngLat.wrap().lng;
    hud.hover(world.sample(lat, lon), pol.provinceAt(lat, lon));
  });
  map.on('mouseout', () => hud.hover(null));
  map.on('click', (e) => select(e.lngLat.lat, e.lngLat.wrap().lng));

  // join the world if a server is running; otherwise stay in offline preview
  if (await serverAvailable()) {
    const token = loadToken();
    if (token) signedIn(token);
    else login.open();
  }
}

start();
