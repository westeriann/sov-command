// Development as the player sees it: the same formula the server uses
// (shared/development.ts), fed from what the client knows: the owner's wealth
// per person and the works finished in the province.
import { MILITARY_WORKS, cityHubs, development, nationDevelopment } from '../../shared/development';
import type { Game } from './game';
import type { Political, Province } from './political';

/** A province's development, 0..100 (0 at sea). */
export function provinceDev(p: Province, game: Game, hubs = hubsOf(game)) {
  const owner = p.nation;
  const built = (game.war.buildings[p.id] ?? []).filter((b) => b.progress >= 1 && !MILITARY_WORKS.has(b.type)).length;
  const e = owner !== undefined ? game.economy.get(owner) : undefined;
  return development({ ...p, gdppc: e?.gdppc, built, hub: hubs.has(p.id), blackout: e?.blackout });
}

let hubCache: Set<number> | undefined;
/** The provinces a city stands in (set once from the map). */
export function hubsOf(_game?: Game, pol?: Political) {
  if (!hubCache && pol) hubCache = cityHubs(pol.provinces.values());
  return hubCache ?? new Set<number>();
}
export function initHubs(pol: Political) { hubCache = cityHubs(pol.provinces.values()); }

/** Every land province's development. */
export function allDev(pol: Political, game: Game) {
  const out = new Map<number, number>();
  const hubs = hubsOf(game, pol);
  for (const p of pol.provinces.values()) if (p.kind === 'land') out.set(p.id, provinceDev(p, game, hubs));
  return out;
}

/** A nation's development: its provinces', weighted by people. */
export function nationDev(id: number, pol: Political, game: Game, dev = allDev(pol, game)) {
  const list: { dev: number; pop: number }[] = [];
  for (const p of pol.provinces.values()) if (p.kind === 'land' && p.nation === id) list.push({ dev: dev.get(p.id) ?? 0, pop: p.pop ?? 0 });
  return Math.round(nationDevelopment(list));
}

/** Colours for the development map, low to high. */
export const DEV_STOPS: [number, string][] = [[0, '#2b1d4a'], [20, '#433f8a'], [40, '#2c7a93'], [60, '#2fb27e'], [80, '#9fd84c'], [100, '#fde725']];
