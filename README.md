# Sovereign Command

Persistent, real-time grand strategy in the browser. Players run nations on a
generated planet starting in 2026, with army, navy, air force, economy and
diplomacy. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the plan.

## Status

Stage 1 (map) in progress:

- Planet generator: tectonic plates (continents, mountain chains, island
  arcs, rifts), climate and 13 terrain types on a sphere
- Terrain painted with real satellite photos (NASA Blue Marble), with
  fractal coastlines and fine relief at full resolution
- About 4,000 land provinces, 600 sea zones and ~145 starting nations, with
  population and resources (farmland, timber, oil, gas, coal, ore, rare earths)
- Browser client: 3D globe or flat map, political / satellite / terrain /
  elevation / temperature modes, sharp vector borders, nation and province
  names, click a province to inspect it and its nation
- Rivers and lakes from simulated drainage: water flows downhill to the sea,
  basins fill into lakes, rivers grow with rainfall; painted into the terrain
  and drawn as map lines; province borders follow major rivers

Stage 2 (multiplayer server) in progress:

- World server (Node + TypeScript, WebSockets, SQLite): accounts and guest
  play, a world clock that never pauses, live updates, world chat, dispatches
- Every nation has a controller, a player or the AI, using the same orders and
  the same public information; players take over AI nations and step down
- Absent players get AI "advisers" after a day (configurable) and lose the
  nation to the AI after two weeks; players can also switch advisers on
- AI decisions are staggered and capped per tick: 5,000 AI nations cost
  under 2 ms per tick

Stage 3 (economy) done:

- Every nation has GDP, population, taxes, a budget (military, infrastructure,
  welfare, research), stockpiles, stability and growth, calibrated to
  real-world totals on day one ($105T GDP, 8.1bn people)
- Six goods (food, oil, gas, coal, metals, rare earths) produced from province
  resources and traded on one world market whose prices respond to supply
  and demand across all players and AI nations
- AI governments run their economies with the same orders as players
- Economy window, live header figures, Wealth map mode
- npx tsx server/test/simulate.ts 3 fast-forwards three game years

Stage 4 (land forces) done:

- Infantry, mechanized and armored divisions, built over game days from the
  military budget and reservists; upkeep, reinforcement, munitions
- Movement in game days from real distances, unit speed, terrain and river
  crossings (one game day = 10 s); routes and arrival times shown in the client
- War and peace (both sides must agree), daily battles with terrain and river
  defense, retreats, occupation that costs the owner output and stability
- Fog of war on the server; AI recruits, defends, attacks weak points, sues
  for peace, and starts rare wars (new players protected for 2 real hours)

Stage 5 (navy and air) done:

- Destroyer squadrons, submarine flotillas (hidden unless your ships share
  their zone) and carrier strike groups move through the 600 sea zones
- Sea battles, shore support for land battles, and blockades that cut a
  nation's trade with the world market by up to 70%
- Troops cross the sea by transport, slowly, and are mauled if enemy
  warships catch them
- Fighter and strike wings fly missions within their combat radius:
  fighters win air superiority, strike wings back ground battles
- AI builds and uses navies and air forces with the same orders

Stage 6 (diplomacy) done:

- Proposals and answers between any two nations; AI governments answer at
  once by personality and situation, players answer in the Diplomacy window
  (proposals lapse after 30 game days)
- Trade agreements (up to 6): +0.15% GDP growth a year each; war ends them
- Defensive alliances (up to 4): allies may cross each other's land, and when
  a nation is attacked its allies join the war against the aggressor
- Peace terms: white peace, or peace that cedes the provinces the winner
  holds, with their people and output; a nation that loses all its land is
  annexed and its player released
- The map redraws borders as land changes hands

Stage 7 (politics and research) done:

- Technology tree: 12 technologies in 4 branches (economy, land warfare,
  sea and air, society), 3 tiers each, funded by the research budget; each
  gives a permanent bonus (growth, stability, attack, defense, naval and air
  power, reservists, build speed, research speed)
- Governments: democracy, autocracy, military junta and technocracy, each
  with trade-offs; reform takes 30 game days of turmoil, once a game year
- National events (booms, strikes, disasters, scandals, breakthroughs,
  celebrations) and unrest: below 25 stability, coups and revolutions
- AI nations research by personality; R&D window in the client

Stage 8 (polish) done:

- Unit stacks: one marker per nation per province (and per group on the
  move), with silhouette icons, a count, the other unit types present and
  overall strength; click a selected stack again to pick out one type
- Guided tour for new players (Guide in the header brings it back)
- Interface sound synthesised in the browser: cues for war, peace, battles,
  research, unrest and diplomacy involving your nation; Sound on/off
- Balance pass on stability, research pace and AI wars
- Load test: npx tsx test/load.ts 300 60 (in server/) runs 300 bot players
  for a minute: median tick 1.2 ms, worst ~130 ms of a 1,000 ms budget,
  about 3 KB/s per player

Expansion (all done):

- War: supply lines (units cut off from the capital or a port weaken), province
  buildings (forts, air defense, factories, mines, ports, air bases), generals
  who gain skill in battle, strategic bombing, missile strikes, and nuclear
  weapons with severe consequences for whoever uses them
- Economy and map: embargoes, unrest and revolts in conquered provinces,
  droughts and hurricanes
- Diplomacy and politics: blocs, a world council (sanctions, condemnations,
  ceasefires), spy operations, puppet states, elections in democracies
- Online game: seasons with daily scoring, early victory by domination and a
  hall of fame; private and alliance chat; leaderboard and score charts;
  nation histories; map replays; a world lobby (VITE_WORLDS lists worlds)
- Quality of life: browser alerts while the tab is in the background, rally
  points, nation comparison charts, a phone layout, keyboard shortcuts (press
  ?), a colour-blind friendly mode
- Settings: SEASON_DAYS (real days per season, default 28), WORLD_NAME

Depth (each feature changes play):

- Identity: rename your nation, pick its map colour, design its flag; every
  nation has a flag; history pages chart GDP, forces and territory
- Production chains: electricity demand outgrows the grid, so growing nations
  build coal, gas, nuclear or renewable power stations (coal and gas burn
  fuel bought on the market); blackouts cut growth and stability; armies burn
  oil and fight weaker without it; metal shortages slow production, rare-earth
  shortages slow research
- Living world: global crashes, pandemics, oil shocks and booms; refugees flee
  occupation to neighbours with open borders (a policy choice); climate change
  driven by the world's coal and gas floods low coasts and moves farmland
- Goals: three season missions per player (points and cash), achievements
  that unlock flag emblems and badges; AI plans offensives, lands troops by
  sea, and gangs up on a dominant power
- Military: marines (no beachhead penalty), special forces (hidden, never
  out of supply, sabotage), drones, bombers, missile defense, insurgency in
  occupied land, satellites and anti-satellite strikes, cyber operations
- Society: ideology (liberty, openness) that must suit the government,
  factions (military, business, public) with bonuses and penalties,
  propaganda at home or abroad, civil wars that split nations, and players
  founding new nations by leading a revolt
- Weather seasons: spring, summer, autumn and winter each game year (15 real
  minutes each, opposite in the two hemispheres). Winter in cold lands slows
  armies 50%, wears down troops on foreign soil and raises electricity
  demand; harvests peak in autumn; hurricane and gale seasons
- On the map: storms (aircraft grounded, ships battered), shipping lanes that
  enemy warships can raid, a Night lights mode showing power and blackouts,
  port cities on the coast

Single-player test build (no server):

- npm run build:offline writes client/dist-offline: the whole simulation runs
  in a Web Worker in the browser (the same server code, with a small in-memory
  store instead of SQLite), saves to IndexedDB, and pauses while the tab is
  closed. Map tiles are packed into a few bundles. Any static host serves it.
- Production server: STATIC_DIR=client/dist serves the built site from the
  game server's own port

Launch readiness:

- Phones: long-press the map to give orders (the touch version of right-click)
- National borders redraw when land changes hands
- Moderation: set ADMIN_USERS=name1,name2 on the server; admins get an Admin
  window to ban, mute, rename or remove players from their nation, and to
  review chat messages players report
- Accounts: a recovery code is shown once at registration (the way back in
  without email), password change signs out other devices, 8 wrong passwords
  lock an account for 15 minutes
- Backups: the server writes data/backups/world-<time>.db every BACKUP_HOURS
  (default 6) and keeps BACKUP_KEEP (default 28); to restore, stop the server
  and run npm run restore (lists backups) or npm run restore -- <file>
- Next: deployment (a public website and a hosted world server); email alerts
  need a mail service

Desktop edition (3D, single player):

- A desktop app (Windows, macOS, Linux) built with Electron around the
  single-player build: the whole world runs inside the app, saves to the app's
  own storage and needs no server or internet
- 3D map: relief tiles made from the planet's elevation raise the mountains
  (stronger from orbit, gentler up close) and shade the hills under the
  political colours; the camera leans over the map as you zoom in
  (right-drag or Ctrl-drag tilts it by hand). View > Relief (3D) sets the
  height or flattens it, Tilt with zoom turns the automatic lean off
- Command look, in the style of classic grand-strategy games but modern
  (2026): strong flat nation colours over shaded relief, dark seas, ink-dark
  borders and large spaced nation names; graphite steel panels with brass
  trim, a full-width command bar, condensed military lettering, and unit
  counters as squared plates edged in the nation's colour. Fonts are bundled
  (Oswald, Barlow, IBM Plex Mono), so nothing loads from the web
- 3D models once you zoom in (View > 3D models turns them off): troops,
  armour and carriers under their counters, which float above them; squads
  march and vehicles turn toward where they are going, turrets sweep, ships
  roll on the swell with a wake, aircraft circle their base, and battles
  flash with gunfire and shell bursts. City skylines grow with population
  (capitals get a domed seat of government), and every province building has
  a model: factories and power stations with smoke or steam, spinning wind
  turbines, a mine's winding wheel, port cranes, a jet taking off from each
  air base, forts, and air and missile defense with turning radars. All are
  built from simple shapes in code (three.js) and drawn as instances, so a
  whole front costs a few dozen draw calls
- F11 or Alt+Enter: full screen

## Run it

Needs Node 20+ and Python 3.11+.

```bash
npm run setup     # Python venv + client and server packages
npm run world     # photos, planet, map tiles, provinces (~25 min)
npm run server    # world server on :8787 (keep it running)
npm run dev       # client; open the printed address
```

Without the server the client still opens as an offline map preview.

Desktop app (after `npm run world`):

```bash
npm run desktop        # build the game and open it in a desktop window
npm run desktop:dist   # installers for this computer's system in desktop/release/
```

Installers for all three systems: run the Desktop app workflow from the
GitHub Actions tab (or push a tag such as `v0.1.0`); it generates the planet,
builds the game and uploads a Windows installer (.exe), a macOS disk image
(.dmg) and a Linux AppImage. The builds are not code-signed, so Windows
SmartScreen and macOS Gatekeeper warn on first launch (macOS: right-click >
Open).

`npm test` runs the server tests; `npm run check` type-checks everything.

Server settings (environment variables): `PORT`, `WORLD_DIR`, `DB_FILE`,
`GAME_SPEED` (8640 = a game day every 10 s, a game year every hour), `AI_BUDGET` (AI decisions per tick, 25),
`AUTOPILOT_AFTER_HOURS` (1), `RELEASE_AFTER_DAYS` (7), `ALLOWED_ORIGINS`.

Options: `npm run world:generate -- --seed 7 --width 16384 --data-width 8192`
makes a different or more detailed planet (then rerun `npm run world:tiles -- --max-zoom 6`).

## Layout

```
client/            browser game (Vite + TypeScript + MapLibre GL)
tools/worldgen/    planet generator (Python)
server/            world server: accounts, world state, AI, WebSockets
shared/            protocol and clock shared by client and server
docs/              design and architecture
```

## Credits

Terrain photography: NASA Earth Observatory, Blue Marble: Next Generation
(public domain), served by NASA GIBS.
