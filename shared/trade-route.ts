// How goods travel between two nations: by sea where they can, overland where
// they must. Ships leave from a nation's main port (or, landlocked, its capital)
// and sail sea zone to sea zone. Where the way runs over land, the two trading
// nations' own land costs nothing extra (their own roads and railways); anyone
// else's land is crossed by caravan, for a fee on the goods' value, unless a canal
// there lets ships through. Land of a nation at war with either trader is closed.
// The server charges the fee on every sale and supply contract; the client works
// out the same route to show the fee before you trade and to draw the route.

export interface RouteProvince { id: number; kind: 'land' | 'sea'; adj: number[]; owner?: number; label: [number, number] }

/** Share of the goods' value paid for each foreign province crossed by caravan. */
export const CARAVAN_FEE = 0.015;
/** The most a caravan journey can add. */
export const MAX_CARAVAN_FEE = 0.12;

export interface TradeRoute {
  /** Province ids from the seller's port (or capital) to the buyer's. */
  path: number[];
  /** Foreign land crossed by caravan (each adds CARAVAN_FEE). */
  caravan: number[];
  /** Foreign land crossed by canal. */
  canals: number[];
  /** The fee, as a share of the goods' value. */
  fee: number;
}

export interface RouteWorld {
  get(id: number): RouteProvince | undefined;
  /** Where a nation's goods set out: a sea zone off its main port, or its capital when landlocked. */
  start(nation: number): number | undefined;
  /** A canal is finished in this province. */
  canal(id: number): boolean;
  /** This nation is at war with either trader: its land is closed. */
  closed(owner: number): boolean;
}

const COST_SEA = 1, COST_OWN = 1, COST_CANAL = 1.2, COST_CARAVAN = 3.5;

/** The cheapest way between two nations (Dijkstra over provinces and sea zones), or null if there is none. */
export function tradeRoute(w: RouteWorld, a: number, b: number): TradeRoute | null {
  const from = w.start(a), to = w.start(b);
  if (from === undefined || to === undefined) return null;
  const cost = new Map<number, number>([[from, 0]]), prev = new Map<number, number>();
  const heap: [number, number][] = [[0, from]];
  const push = (c: number, id: number) => {
    heap.push([c, id]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  let steps = 0;
  while (heap.length && steps++ < 60_000) {
    const [c, id] = pop();
    if (id === to) break;
    if (c > (cost.get(id) ?? Infinity)) continue;
    const p = w.get(id);
    if (!p) continue;
    for (const q of p.adj) {
      const n = w.get(q);
      if (!n) continue;
      let step: number;
      if (n.kind === 'sea') step = COST_SEA;
      else if (n.owner === a || n.owner === b) step = COST_OWN;
      else if (n.owner !== undefined && w.closed(n.owner)) continue;
      else step = w.canal(q) ? COST_CANAL : COST_CARAVAN;
      const nc = c + step;
      if (nc < (cost.get(q) ?? Infinity)) { cost.set(q, nc); prev.set(q, id); push(nc, q); }
    }
  }
  if (!cost.has(to)) return null;
  const path: number[] = [];
  for (let id: number | undefined = to; id !== undefined; id = prev.get(id)) { path.push(id); if (id === from) break; }
  path.reverse();
  const caravan: number[] = [], canals: number[] = [];
  for (const id of path) {
    const p = w.get(id);
    if (!p || p.kind !== 'land' || p.owner === a || p.owner === b) continue;
    (w.canal(id) ? canals : caravan).push(id);
  }
  return { path, caravan, canals, fee: Math.min(MAX_CARAVAN_FEE, caravan.length * CARAVAN_FEE) };
}
