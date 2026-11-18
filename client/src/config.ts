// Shared game settings. In the multiplayer build these come from the server.

/**
 * The world clock never pauses. GAME_SPEED game seconds pass per real second:
 * at 8640, one game day passes every 10 real seconds and a game year every
 * real hour. The server's value wins once connected.
 */
export const GAME_SPEED = 8640;

/** Real moment the world opened, and the in-game date it opened on. */
export const WORLD_OPENED_REAL = Date.UTC(2026, 10, 17, 0, 0, 0);
export const WORLD_OPENED_GAME = Date.UTC(2026, 0, 1, 0, 0, 0);

export function gameNow(realNow = Date.now()) {
  return new Date(WORLD_OPENED_GAME + (realNow - WORLD_OPENED_REAL) * GAME_SPEED);
}

/** Single-player test build: the world runs in this browser tab, no server. */
export const OFFLINE = import.meta.env.VITE_OFFLINE === '1';
/** Where the website's files live (the page may be served from a sub-folder). */
export const ASSET_BASE = new URL(import.meta.env.BASE_URL, location.href).href;
/** Some static hosts only serve known file types: the single-player build ships binary data as .bin.wasm. */
export const bin = (name: string) => (OFFLINE ? `${name}.wasm` : name);
