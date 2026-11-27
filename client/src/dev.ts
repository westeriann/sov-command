// Development as the player sees it: the same formula the server uses
// (shared/development.ts), fed from what the client knows: the owner's wealth
// per person and the works finished in the province.
import { MILITARY_WORKS, development } from '../../shared/development';
import type { Game } from './game';
import type { Political, Province } from './political';

/** A province's development, 0..100 (0 at sea). */
export function provinceDev(p: Province, game: Game) {
  const owner = p.nation;
  const built = (game.war.buildings[p.id] ?? []).filter((b) => b.progress >= 1 && !MILITARY_WORKS.has(b.type)).length;
  return development({ ...p, gdppc: owner !== undefined ? game.economy.get(owner)?.gdppc : undefined, built });
}

/** Every land province's development. */
export function allDev(pol: Political, game: Game) {
  const out = new Map<number, number>();
  for (const p of pol.provinces.values()) if (p.kind === 'land') out.set(p.id, provinceDev(p, game));
  return out;
}

/** A nation's development: its provinces', weighted by people. */
export function nationDev(id: number, pol: Political, game: Game, dev = allDev(pol, game)) {
  let w = 0, t = 0;
  for (const p of pol.provinces.values()) {
    if (p.kind !== 'land' || p.nation !== id) continue;
    const pop = Math.max(1, p.pop ?? 0);
    w += pop; t += pop * (dev.get(p.id) ?? 0);
  }
  return w ? Math.round(t / w) : 0;
}

/** Colours for the development map, low to high. */
export const DEV_STOPS: [number, string][] = [[0, '#2b1d4a'], [20, '#433f8a'], [40, '#2c7a93'], [60, '#2fb27e'], [80, '#9fd84c'], [100, '#fde725']];
