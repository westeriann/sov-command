// National economies and the world market. Runs once per game day for every
// nation together, because one shared market sets all prices.
//
// Scale: GDP and goods are calibrated so that day one matches the real world
// of the mid-2020s in total (about $105 trillion GDP, 8.1 billion people,
// 36.5 billion barrels of oil a year), spread unevenly across nations by
// their land, resources and luck.
import { TRADE_DEAL_GROWTH } from '../../shared/diplomacy.ts';
import {
  COMMODITIES, COMMODITY_INFO, DEFAULT_BUDGET,
  type Budget, type Commodity, type CommodityStats, type EconomyPrivate, type EconomyPublic,
  type EnergyStats, type HistoryPoint, type MarketSnapshot,
} from '../../shared/economy.ts';
import type { Focus } from '../../shared/protocol.ts';

export const WORLD_GDP_START = 105_000; // $bn per year
const ADMIN_SHARE = 0.1; // of spending, before the budget split
/** Government spending as a share of GDP. Taxes above it run a surplus, below it a deficit. */
export const SPEND_RATE = 0.24;
const STOCK_TARGET_DAYS = 60;
const STOCK_CAP_DAYS = 365;
/** Chart points are recorded once a game week; 260 weeks = 5 game years (5 real hours at 8640x). */
export const HISTORY_EVERY_DAYS = 7;
const HISTORY_POINTS = 260;
/** Largest price move per game day. Days are short (10 s), so prices move gently. */
const PRICE_STEP = 0.005;
const PRICE_FLOOR = 0.25, PRICE_CEIL = 4; // multiples of the base price
const SHORTAGE_WEIGHT: Record<Commodity, number> = { food: 0.4, timber: 0.06, oil: 0.25, gas: 0.1, coal: 0.08, metals: 0.12, rare_earths: 0.05 };

/** Use per year: food scales with people, everything else with output. */
export function usePerYear(c: Commodity, gdp: number, pop: number) {
  const info = COMMODITY_INFO[c];
  if (c === 'food') return (pop / 8.1e9) * info.worldUse;
  return (gdp / WORLD_GDP_START) * info.worldUse;
}

export interface EconSeed {
  pop: number;
  raw: Record<Commodity, number>; // unscaled resource potential from provinces
  coastal: number; // share of provinces on the coast
  farm: number; // mean farmland score 0..100
}

export interface NationEcon {
  gdp: number;
  pop: number;
  stability: number;
  treasury: number;
  infra: number;
  research: number;
  munitions: number; // $bn of military materiel
  budget: Budget;
  capacity: Record<Commodity, number>; // production per year
  stock: Record<Commodity, number>;
  growth: number;
  shortage: number;
  trade: Record<Commodity, number>; // per year, + exports / - imports
  short: Record<Commodity, number>; // unmet share 0..1
  history: HistoryPoint[];
  grid?: number; // base electricity grid, power units
  blackout?: number; // share of electricity demand unmet, 0..1
}

export interface MarketState {
  day: number; // last simulated game day
  prices: Record<Commodity, number>;
  history: { d: number; p: Record<Commodity, number>; s?: Partial<Record<Commodity, number>>; u?: Partial<Record<Commodity, number>> }[];
}

const zero = () => Object.fromEntries(COMMODITIES.map((c) => [c, 0])) as Record<Commodity, number>;

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

function zscores(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
  return xs.map((x) => (x - m) / sd);
}

/** Starting economies for every nation, calibrated to world totals. */
export function initEconomies(seeds: Map<number, EconSeed>, rand: () => number): Map<number, NationEcon> {
  const ids = [...seeds.keys()];
  const list = ids.map((id) => seeds.get(id)!);
  const richness = list.map((s) => Math.log1p(COMMODITIES.reduce((a, c) => a + s.raw[c] / (COMMODITY_INFO[c].worldUse || 1), 0) * 1e4));
  const zc = zscores(list.map((s) => s.coastal));
  const zr = zscores(richness);
  const zf = zscores(list.map((s) => s.farm));
  // income per person: lognormal, nudged by coast, resources and farmland
  const pcRaw = list.map((_, i) => Math.exp(9.3 + 0.9 * (0.45 * zc[i] + 0.3 * zr[i] + 0.2 * zf[i] + 0.75 * gauss(rand))));
  const rawGdp = list.reduce((a, s, i) => a + s.pop * pcRaw[i], 0) / 1e9;
  const scale = WORLD_GDP_START / rawGdp;

  const econ = new Map<number, NationEcon>();
  ids.forEach((id, i) => {
    const s = list[i];
    const gdppc = Math.min(110_000, Math.max(700, pcRaw[i] * scale));
    const gdp = (s.pop * gdppc) / 1e9;
    econ.set(id, {
      gdp, pop: s.pop, stability: 55 + 10 * rand(), treasury: gdp * 0.05, infra: 0.8 + 0.3 * rand(),
      research: 0, munitions: 0, budget: { ...DEFAULT_BUDGET }, capacity: zero(), stock: zero(),
      growth: 0, shortage: 0, trade: zero(), short: zero(), history: [],
    });
  });
  // production capacity: each good scaled so the world produces 3% more than it uses on day one
  for (const c of COMMODITIES) {
    const use = [...econ.values()].reduce((a, e) => a + usePerYear(c, e.gdp, e.pop), 0);
    const raw = list.reduce((a, s) => a + s.raw[c], 0) || 1;
    ids.forEach((id, i) => {
      const e = econ.get(id)!;
      e.capacity[c] = (list[i].raw[c] / raw) * use * 1.03;
      e.stock[c] = (usePerYear(c, e.gdp, e.pop) * STOCK_TARGET_DAYS) / 365;
    });
  }
  return econ;
}

export function initMarket(): MarketState {
  return { day: 0, prices: Object.fromEntries(COMMODITIES.map((c) => [c, COMMODITY_INFO[c].basePrice])) as Record<Commodity, number>, history: [] };
}

export interface DayInput {
  econ: NationEcon;
  tax: number; // percent
  focus: Focus;
  control?: number; // share of the nation's population not under enemy occupation (1 = none occupied)
  blockade?: number; // share of the coast blockaded by enemy warships (0..1)
  atWar?: boolean;
  tradeDeals?: number; // trade agreements in force
  bonusGrowth?: number; // technology and government
  bonusStability?: number;
  extraUse?: Partial<Record<Commodity, number>>; // per year, on top of normal use: armies' oil, power stations' fuel
  plantPower?: number; // share of electricity demand covered by power stations
  thermalPlants?: number; // the part of that which burns coal or gas
  factoryGrowth?: number; // growth from factories, if they get metals and electricity
  harvest?: number; // seasonal food output factor
  powerDemand?: number; // seasonal electricity demand factor
  foodBonus?: number; // fisheries, breadbaskets, cattle: share more food
  // laws
  spendFactor?: number; // austerity: the government spends less
  shortageFactor?: number; // rationing: shortages hurt less
  stockFactor?: number; // strategic reserves: larger stockpiles
  tradeGrowth?: number; // free trade: trade agreements give more growth
}

/**
 * Advance every economy by one game day: production and use, stock draw,
 * the world market, the budget and its effects, growth.
 */
export function runDay(nations: DayInput[], market: MarketState, day: number) {
  const bids = new Map<Commodity, { n: DayInput; q: number }[]>();
  const offers = new Map<Commodity, { n: DayInput; q: number }[]>();
  for (const c of COMMODITIES) { bids.set(c, []); offers.set(c, []); }

  // prices steer behaviour: producers run harder when goods are dear, buyers economise
  const rel = Object.fromEntries(COMMODITIES.map((c) => [c, market.prices[c] / COMMODITY_INFO[c].basePrice])) as Record<Commodity, number>;
  const utilisation = (c: Commodity) => Math.min(1.12, Math.max(0.55, rel[c] ** 0.6));
  const thrift = (c: Commodity) => Math.min(1.15, Math.max(0.8, rel[c] ** -0.15));

  // 1. production, use, stocks, and what goes to market
  for (const n of nations) {
    const e = n.econ;
    for (const c of COMMODITIES) {
      const use = ((usePerYear(c, e.gdp, e.pop) + (n.extraUse?.[c] ?? 0)) / 365) * thrift(c);
      let net = (e.capacity[c] / 365) * utilisation(c) * (n.control ?? 1) * (c === 'food' ? (n.harvest ?? 1) * (1 + (n.foodBonus ?? 0)) : 1) - use;
      e.trade[c] = 0;
      e.short[c] = 0;
      if (net < 0) {
        const draw = Math.min(e.stock[c], -net);
        e.stock[c] -= draw;
        net += draw;
        // also rebuild depleted reserves a little each day
        const restock = Math.max(0, use * STOCK_TARGET_DAYS * (n.stockFactor ?? 1) - e.stock[c]) * 0.02;
        if (net < 0 || restock > 0) bids.get(c)!.push({ n, q: -Math.min(0, net) + restock });
      } else {
        const fill = Math.min(net, Math.max(0, (use * STOCK_TARGET_DAYS * (n.stockFactor ?? 1)) - e.stock[c]));
        e.stock[c] += fill;
        net -= fill;
        if (net > 0) offers.get(c)!.push({ n, q: net });
      }
    }
  }

  // 2. clear the market for each good at today's price, then move the price
  for (const c of COMMODITIES) {
    const price = market.prices[c];
    const buy = bids.get(c)!, sell = offers.get(c)!;
    // nations deep in debt cannot import
    const able = buy.filter((b) => b.n.econ.treasury > -0.6 * b.n.econ.gdp);
    const demand = able.reduce((a, b) => a + b.q, 0);
    const supply = sell.reduce((a, s) => a + s.q, 0);
    const buyFill = demand > 0 ? Math.min(1, supply / demand) : 0;
    const sellFill = supply > 0 ? Math.min(1, demand / supply) : 0;
    for (const b of buy) {
      const e = b.n.econ;
      const got = able.includes(b) ? b.q * buyFill * (1 - 0.7 * (b.n.blockade ?? 0)) : 0; // blockaded ports get less through
      e.treasury -= got * price;
      e.trade[c] = -got * 365;
      // whatever we could not cover first comes out of the restocking we wanted
      const use = (usePerYear(c, e.gdp, e.pop) + (b.n.extraUse?.[c] ?? 0)) / 365;
      const restock = Math.max(0, use * STOCK_TARGET_DAYS * (b.n.stockFactor ?? 1) - e.stock[c]) * 0.02;
      const unmet = Math.max(0, b.q - got - restock);
      e.stock[c] += Math.max(0, got - (b.q - restock));
      e.short[c] = use > 0 ? unmet / use : 0;
    }
    for (const s of sell) {
      const e = s.n.econ;
      const sold = s.q * sellFill * (1 - 0.7 * (s.n.blockade ?? 0));
      e.treasury += sold * price;
      e.trade[c] = sold * 365;
      const cap = (usePerYear(c, e.gdp, e.pop) * STOCK_CAP_DAYS * (s.n.stockFactor ?? 1)) / 365;
      e.stock[c] = Math.min(cap, e.stock[c] + (s.q - sold)); // unsold output is stored, or wasted once full
    }
    const ratio = (demand + 1e-9) / (supply + 1e-9);
    const base = COMMODITY_INFO[c].basePrice;
    const next = price * Math.min(1 + PRICE_STEP, Math.max(1 - PRICE_STEP, ratio ** 0.04));
    market.prices[c] = Math.min(base * PRICE_CEIL, Math.max(base * PRICE_FLOOR, next));
  }

  // 3. budget, investment and growth
  for (const n of nations) {
    const e = n.econ;
    const control = n.control ?? 1;
    const revenue = (e.gdp * n.tax * control) / 100; // per year; occupied land pays no taxes
    const spending = e.gdp * SPEND_RATE * (n.spendFactor ?? 1);
    e.treasury += (revenue - spending) / 365;
    const spend = spending * (1 - ADMIN_SHARE);
    const share = (k: keyof Budget) => (spend * e.budget[k]) / 100; // $bn per year
    e.shortage = COMMODITIES.reduce((a, c) => a + SHORTAGE_WEIGHT[c] * Math.min(1, e.short[c]), 0) * (n.shortageFactor ?? 1);

    const infraTarget = Math.min(1.6, Math.max(0.4, 0.55 + (share('infrastructure') / e.gdp) * 30));
    e.infra += (infraTarget - e.infra) * 0.006 * (1 - 0.6 * Math.min(1, e.short.timber ?? 0)); // building roads and housing needs timber
    // munitions need metals
    e.munitions = e.munitions * (1 - 0.0005) + (share('military') / 365) * 0.3 * (1 - 0.6 * Math.min(1, e.short.metals));

    // electricity: the base grid comes from coal and gas too, so fuel shortages dim it
    e.grid ??= e.gdp * 1.08;
    const demandE = e.gdp * (n.powerDemand ?? 1);
    const fuelShort = Math.min(1, (e.short.coal + e.short.gas) / 2);
    const supplyE = e.grid * (1 - 0.6 * fuelShort) + demandE * ((n.plantPower ?? 0) - (n.thermalPlants ?? 0) * fuelShort);
    e.blackout = Math.max(0, Math.min(1, 1 - supplyE / Math.max(1, demandE)));

    const gdppc = (e.gdp * 1e9) / e.pop;
    const catchUp = Math.min(0.05, Math.max(0.005, 0.035 - 0.012 * Math.log10(gdppc / 2000)));
    const focus = { economy: 0.006, military: -0.003, research: 0.002, diplomacy: 0.002 }[n.focus];
    const debtRatio = Math.max(0, -e.treasury / e.gdp);
    let g = catchUp + focus
      + (e.infra - 1) * 0.02
      + (e.budget.research / 100) * 0.01
      - Math.max(0, n.tax - 25) * 0.0008
      - e.shortage * 0.08
      - Math.max(0, 50 - e.stability) * 0.0006
      - Math.max(0, debtRatio - 0.6) * 0.02
      - (1 - control) * 0.15
      - (n.atWar ? 0.01 : 0)
      + (n.tradeDeals ?? 0) * TRADE_DEAL_GROWTH * (n.tradeGrowth ?? 1)
      + (n.bonusGrowth ?? 0)
      + (n.factoryGrowth ?? 0) * (1 - Math.min(1, e.short.metals)) * (1 - e.blackout)
      - e.blackout * 0.08; // blackouts stop industry
    g = Math.min(0.12, Math.max(-0.15, g));
    e.growth = g;
    e.gdp *= 1 + g / 365;
    const popGrowth = Math.min(0.03, Math.max(-0.005, 0.022 - 0.006 * Math.log10(gdppc / 1000) + (e.budget.welfare - 35) * 0.0002 - e.short.food * 0.05));
    e.pop *= 1 + popGrowth / 365;
    // output capacity follows the economy and infrastructure
    for (const c of COMMODITIES) e.capacity[c] *= 1 + (0.6 * g + (e.infra - 1) * 0.01) / 365;
    // the grid grows with infrastructure spending, but slower than a booming economy needs
    e.grid *= 1 + (0.4 * Math.max(0, g) + (e.infra - 1) * 0.01 + (e.budget.infrastructure - 30) * 0.0004) / 365;

    if (e.treasury < 0) e.treasury -= (-e.treasury * 0.04) / 365; // interest on debt
    const stabTarget = Math.min(100, Math.max(0,
      50 + (e.budget.welfare - 30) * 0.6 - (n.tax - 25) * 0.9 - e.shortage * 80
      - Math.max(0, debtRatio - 0.6) * 30 + g * 300 + (n.focus === 'diplomacy' ? 3 : 0)
      - (1 - control) * 50 - (n.atWar ? 5 : 0) + (n.bonusStability ?? 0) - e.blackout * 40));
    e.stability += (stabTarget - e.stability) * 0.03;

    if (day % HISTORY_EVERY_DAYS === 0) {
      e.history.push({
        d: day, gdp: round(e.gdp, 1), treasury: round(e.treasury, 1), stability: round(e.stability, 1),
        g: Object.fromEntries(COMMODITIES.map((c) => [c, [round(e.capacity[c], 2), round(usePerYear(c, e.gdp, e.pop), 2), round(e.trade[c], 2)]])),
        e: [round(e.gdp, 0), round((e.grid ?? e.gdp) * (1 - (e.blackout ?? 0)) + e.gdp * (e.blackout ?? 0), 0)],
      });
      if (e.history.length > HISTORY_POINTS) e.history.splice(0, e.history.length - HISTORY_POINTS);
    }
  }

  market.day = day;
  if (day % HISTORY_EVERY_DAYS === 0) {
    const s: Partial<Record<Commodity, number>> = {}, u: Partial<Record<Commodity, number>> = {};
    for (const c of COMMODITIES) {
      s[c] = round(nations.reduce((t, n) => t + n.econ.capacity[c], 0), 1);
      u[c] = round(nations.reduce((t, n) => t + usePerYear(c, n.econ.gdp, n.econ.pop), 0), 1);
    }
    market.history.push({ d: day, p: { ...market.prices }, s, u });
    if (market.history.length > HISTORY_POINTS) market.history.splice(0, market.history.length - HISTORY_POINTS);
  }
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function publicEcon(id: number, e: NationEcon): EconomyPublic {
  return { id, gdp: round(e.gdp, 1), pop: Math.round(e.pop), growth: round(e.growth, 4), gdppc: Math.round((e.gdp * 1e9) / e.pop), stability: Math.round(e.stability), blackout: round(e.blackout ?? 0, 3) };
}

export function privateEcon(e: NationEcon, tax: number, day: number, energy?: EnergyStats): EconomyPrivate {
  const revenue = (e.gdp * tax) / 100;
  const spending = e.gdp * SPEND_RATE;
  const defence = (spending * (1 - ADMIN_SHARE) * e.budget.military) / 100;
  const oilUse = usePerYear('oil', e.gdp, e.pop) / 365;
  const goods = Object.fromEntries(COMMODITIES.map((c) => [c, {
    prod: round(e.capacity[c], 2), use: round(usePerYear(c, e.gdp, e.pop), 2), stock: round(e.stock[c], 2),
    trade: round(e.trade[c], 2), short: round(e.short[c], 3),
  } satisfies CommodityStats])) as Record<Commodity, CommodityStats>;
  return {
    day, gdp: round(e.gdp, 2), growth: round(e.growth, 4), pop: Math.round(e.pop),
    gdppc: Math.round((e.gdp * 1e9) / e.pop), stability: round(e.stability, 1), treasury: round(e.treasury, 2),
    revenue: round(revenue, 2), spending: round(spending, 2), budget: { ...e.budget }, infra: round(e.infra, 3), research: round(e.research, 1),
    defence: round(defence, 2), munitions: Math.round(Math.min(250, (e.munitions / Math.max(1e-6, defence * 0.5)) * 100)),
    reservists: Math.round(e.pop * (0.004 + (0.01 * e.budget.military) / 100)),
    fuelDays: Math.round(oilUse > 0 ? e.stock.oil / oilUse : 999), shortage: round(e.shortage, 3),
    energy: energy ?? { demand: round(e.gdp, 0), supply: round(e.grid ?? e.gdp, 0), grid: round(e.grid ?? e.gdp, 0), plants: 0, blackout: round(e.blackout ?? 0, 3), militaryOil: 0 },
    goods, history: e.history,
  };
}

/** points: how many weekly price points to include (the client appends new ones as they arrive). */
export function marketSnapshot(m: MarketState, points = 104): MarketSnapshot {
  return { day: m.day, prices: { ...m.prices }, history: points > 0 ? m.history.slice(-points) : [] };
}

