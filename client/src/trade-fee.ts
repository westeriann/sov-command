// The caravan fee between two nations, as the server works it out (shared/trade-route.ts),
// so the trade menu can show the price with it before you offer a deal.
import { tradeRoute, type TradeRoute } from '../../shared/trade-route';
import type { Game } from './game';
import type { Political } from './political';

const cache = new Map<string, { at: number; r: TradeRoute | null }>();

export function routeBetween(game: Game, pol: Political, a: number, b: number): TradeRoute | null {
  const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
  const day = game.market?.day ?? 0;
  const hit = cache.get(key);
  if (hit && day - hit.at < 7) return hit.r;
  const owner = (id: number) => { const p = pol.provinces.get(id); return p?.kind === 'land' ? game.war.occupied[id] ?? p.nation : undefined; };
  const canal = (id: number) => (game.war.buildings[id] ?? []).some((x) => x.type === 'canal' && x.progress >= 1);
  const atWar = (x: number, y: number) => game.war.wars.some((w) => (w.a === x && w.b === y) || (w.a === y && w.b === x));
  const portZone = (n: number) => {
    const cap = pol.provinces.get(pol.nations.get(n)?.capital ?? -1)?.label;
    let best: number | undefined, bestD = Infinity;
    for (const p of pol.provinces.values()) {
      if (p.kind !== 'land' || owner(p.id) !== n) continue;
      const zone = p.adj.find((q) => pol.provinces.get(q)?.kind === 'sea');
      if (zone === undefined) continue;
      const port = (game.war.buildings[p.id] ?? []).some((x) => x.type === 'port' && x.progress >= 1);
      const d = (port ? 0 : 1) * 1e6 + (cap ? Math.hypot(cap[0] - p.label[0], cap[1] - p.label[1]) * 111 : 0);
      if (d < bestD) { bestD = d; best = zone; }
    }
    return best;
  };
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const r = tradeRoute({
    get: (id) => { const p = pol.provinces.get(id); return p ? { id: p.id, kind: p.kind, adj: p.adj, owner: owner(id), label: p.label } : undefined; },
    start: (n) => portZone(n) ?? pol.nations.get(n)?.capital,
    canal,
    closed: (o) => atWar(o, lo) || atWar(o, hi),
  }, lo, hi);
  cache.set(key, { at: day, r });
  return r;
}
