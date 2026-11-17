# Sovereign Command: architecture

A persistent, real-time grand strategy game in the browser. Many players share
one generated planet, each running a nation, in 2026 and onward. The world
clock never stops; players come and go.

## Decisions so far

| Topic | Decision |
|---|---|
| Era | Starts 1 January 2026, modern weapons and economy |
| Pace | Real time, never paused. `GAME_SPEED` = 8640: a game day every 10 real seconds, a game year every real hour. Economies update daily; AI governments review weekly; charts and world-wide broadcasts are weekly |
| Map | Whole generated planet, shown as a 3D globe or a flat map |
| Terrain look | Real satellite photos (NASA Blue Marble) blended over generated terrain |
| Client | TypeScript, Vite, MapLibre GL (globe, raster tiles), plain DOM panels |
| Players | Mass multiplayer on a website |

## How the parts fit

```
 world generator (offline, Python)          browsers (TypeScript client)
   seed -> elevation, climate, biomes         MapLibre globe + HUD panels
   -> satellite texture -> map tiles  ---->   static tiles from a CDN
   -> provinces + starting nations             |
                                               | WebSocket: orders up,
                                               | state changes down
                                               v
                         world server (Node/TypeScript, one per world)
                           authoritative simulation tick
                           economy, movement, combat, diplomacy, AI
                                               |
                         PostgreSQL: accounts, worlds, nations, units,
                         orders, event log; periodic world snapshots
```

### World generator (`tools/worldgen`, built)
Runs once per world. Everything is reproducible from the seed.
1. `fetch_samples.py` downloads real terrain photos per biome from NASA GIBS.
2. `generate.py` builds elevation (tectonic plates + noise), temperature,
   rainfall, rivers and lakes (`hydrology.py`: priority-flood depression
   filling, flow routing, rainfall-weighted accumulation) and biomes on a
   sphere, then paints the planet with the photos.
3. `tiles.py` cuts Web Mercator tiles (z0 to z6) and a compact lookup grid.
4. `provinces.py` divides land into ~4,000 provinces (denser where land is
   fertile), the sea into ~600 zones, grows ~145 starting nations from
   capitals over the province graph, and assigns population and resources.
   It writes `provinces.json` (records + adjacency), `provinces.bin` (the
   province under every map cell, run-length coded) and `borders.geojson`.

The province graph (`adj`) is what the server simulation will use for
movement, supply and ownership; the map cells only matter for drawing and
clicking.

### Controllers: players and AI on equal terms
Every nation has exactly one controller: `ai`, or `human` (optionally on
autopilot). Both go through `World.submit()`, which validates every order the
same way, and the AI reads other nations only through `publicView()`, the
same data a player receives. Consequences:
- Any AI nation can be taken over by a player at any moment, and handed back.
- Absent players never leave a hole: after `AUTOPILOT_AFTER_HOURS` offline the
  AI governs their nation, and hands it back the moment they reconnect; after
  `RELEASE_AFTER_DAYS` the nation returns to the AI for someone else to claim.
- AI decisions are scheduled per nation about once a game day, spread across
  the day, and capped at `AI_BUDGET` per one-second tick, so load is flat.
  Benchmark (`server/test/bench.ts`): 5,000 AI nations, p99 tick 0.1 ms.
- Each future system (economy, army, diplomacy) adds one module to `ai.ts`
  behind `think()`, and one order kind to `submit()`.

### World server (`server/`, stage 2: running)
Built: HTTP accounts (scrypt passwords, hashed session tokens, guest play,
per-IP limits), WebSocket hub (hello-with-token auth, rate limiting, heartbeat,
origin allow-list), authoritative world with a persisted clock, nation
controllers, AI brains with personalities, inactivity handover, dispatches
(event log) and world chat, all in SQLite. Tests: `npm test`.
- **Authoritative.** Clients only send orders ("move brigade 12 to province
  431"); the server decides what happens. This is what stops cheating.
- **Fixed tick.** The simulation advances in steps (for example one game
  hour, every 150 real seconds at speed 24). Movement is interpolated on the
  client between ticks so units glide.
- **One process per world.** A world holds a few hundred nations. "Mass
  multiplayer" means many worlds running side by side, plus large worlds where
  the server can be split by region later if needed.
- **Fog of war on the server.** Each player only receives what their nation
  can see, so hidden units never reach the browser.
- **Offline players.** Nations keep running while their player is away:
  standing orders, automatic governors for economy and defence, and
  notifications when attacked.
- **Shared code.** Rules (combat maths, movement costs, economy formulas) live
  in a TypeScript package used by both server and client, so the client can
  preview outcomes with the exact same numbers.

### Persistence
PostgreSQL holds accounts and the live state of each world. Every order and
result goes to an append-only event log; the full world state is snapshotted
regularly so a crashed server restarts from the last snapshot plus the log.

### Hosting
Static site and map tiles on a CDN. World servers on ordinary VMs or
containers. A small lobby service lists worlds and assigns players.

## Build stages

1. **Map**: terrain generation, satellite texture, globe client, provinces,
   nations, borders, rivers and lakes, click-to-inspect (done)
2. **Multiplayer server**: accounts, joining a world, claiming a nation,
   AI controllers, live clock, dispatches and chat (done); deployment next
3. **Economy**: production, budget, taxes, trade, resources (done)
4. **Land warfare**: units, production, movement, supply, combat (done)
5. **Navy and air**: fleets, sea control, air wings, strikes (done)
6. **Diplomacy**: trade agreements, defensive alliances, peace terms, annexation (done)
7. **Politics and research**: government, stability, events, tech tree
8. **Polish**: tutorial, sound, balance, load testing

## Open questions
- Players per world and how long a world runs (endless, or seasons with a winner)
- Game speed: 24x is a placeholder; long battles may want slower
- Monetisation, if any (affects design: no pay-to-win is the usual promise)
