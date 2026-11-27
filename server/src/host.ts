// Entry point when the desktop app hosts a multiplayer world: run by the
// app's own Node (ELECTRON_RUN_AS_NODE), configured through the environment,
// reporting its port on stdout so the app can open the game in its window.
import { start } from './index.ts';
import { normalizeSettings } from '../../shared/settings.ts';

// the create-game screen's choices, passed on by the app (a world already made keeps its map and mode)
const settings = (() => { try { return normalizeSettings(JSON.parse(process.env.GAME_SETTINGS ?? '{}')); } catch { return normalizeSettings({}); } })();
/** Minutes or days from the environment; 0 means never. */
const after = (v: string | undefined, unit: number, d: number) => { const x = Number(v ?? d); return x > 0 ? x * unit : 1e15; };

const app = start({
  port: Number(process.env.PORT ?? 8787),
  worldDir: process.env.WORLD_DIR!,
  dbFile: process.env.DB_FILE!,
  speed: Number(process.env.GAME_SPEED ?? 8640),
  aiBudgetPerTick: 60,
  autopilotAfterMs: after(process.env.AUTOPILOT_MIN, 60_000, 60),
  releaseAfterMs: after(process.env.RELEASE_DAYS, 86_400_000, 7),
  settings,
  seasonMs: 28 * 86_400_000,
  allowedOrigins: [],
  backupHours: 6,
  backupKeep: 8,
  staticDir: process.env.STATIC_DIR!,
});
void app.ready.then((port) => console.log(`SOV_READY ${port}`));
const stop = () => void app.stop().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('disconnect', stop); // the app closed
