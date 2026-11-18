// Economy definitions shared by server and client. Money is in billions of
// US dollars ($bn); production and consumption are per game year; stocks are
// in each good's unit.

export type Commodity = 'food' | 'oil' | 'gas' | 'coal' | 'metals' | 'rare_earths';
export const COMMODITIES: Commodity[] = ['food', 'oil', 'gas', 'coal', 'metals', 'rare_earths'];

export interface CommodityInfo {
  name: string;
  unit: string; // stock unit; rates are per year
  basePrice: number; // $bn per unit at the start of the world
  /** World use per year at the start, matched to real 2020s figures. */
  worldUse: number;
}

export const COMMODITY_INFO: Record<Commodity, CommodityInfo> = {
  food: { name: 'Food', unit: 'Mt', basePrice: 0.3, worldUse: 2_670 }, // $300/t
  oil: { name: 'Oil', unit: 'Mbbl', basePrice: 0.075, worldUse: 36_500 }, // $75/bbl
  gas: { name: 'Natural gas', unit: 'bcm', basePrice: 0.3, worldUse: 4_000 }, // $300 per 1000 m³
  coal: { name: 'Coal', unit: 'Mt', basePrice: 0.12, worldUse: 8_500 }, // $120/t
  metals: { name: 'Metals', unit: 'Mt', basePrice: 0.11, worldUse: 2_500 }, // $110/t
  rare_earths: { name: 'Rare earths', unit: 'kt', basePrice: 0.05, worldUse: 300 }, // $50k/t
};

/** Shares of government spending, in percent; always sums to 100. */
export interface Budget {
  military: number;
  infrastructure: number;
  welfare: number;
  research: number;
}
export const BUDGET_KEYS: (keyof Budget)[] = ['military', 'infrastructure', 'welfare', 'research'];
export const DEFAULT_BUDGET: Budget = { military: 20, infrastructure: 30, welfare: 35, research: 15 };
export const BUDGET_MAX_SHARE = 70;

/** Clamp each share to 0..BUDGET_MAX_SHARE and rescale so they sum to 100. */
export function normalizeBudget(input: Partial<Budget>, prev: Budget): Budget {
  const raw = { ...prev };
  for (const k of BUDGET_KEYS) {
    const v = input[k];
    if (typeof v === 'number' && Number.isFinite(v)) raw[k] = Math.min(BUDGET_MAX_SHARE, Math.max(0, v));
  }
  const sum = BUDGET_KEYS.reduce((s, k) => s + raw[k], 0);
  if (sum <= 0) return { ...DEFAULT_BUDGET };
  const out = {} as Budget;
  let acc = 0;
  BUDGET_KEYS.forEach((k, i) => {
    out[k] = i === BUDGET_KEYS.length - 1 ? 100 - acc : Math.round((raw[k] / sum) * 100);
    acc += out[k];
  });
  return out;
}

export interface CommodityStats {
  prod: number; // per year
  use: number; // per year
  stock: number; // units held
  trade: number; // per year; positive = exports, negative = imports
  short: number; // share of use that went unmet, 0..1
}

export interface HistoryPoint {
  d: number; // game day index since the world opened
  gdp: number;
  treasury: number;
  stability: number;
}

/** Everything a player sees about their own economy. */
/** Electricity: demand follows the economy, the grid does not keep up on its own. */
export interface EnergyStats {
  demand: number; // power units (1 per $bn of GDP)
  supply: number; // what the grid can deliver today, after any fuel shortage
  grid: number; // base grid
  plants: number; // from power stations
  blackout: number; // share of demand not met, 0..1
  militaryOil: number; // bn barrels a year burned by the armed forces
}

export interface MigrationStats { refugeesIn: number; refugeesOut: number } // people, last game year

export interface EconomyPrivate {
  day: number;
  gdp: number; // $bn per year
  growth: number; // annual rate, e.g. 0.023
  pop: number;
  gdppc: number; // $ per person per year
  stability: number; // 0..100
  treasury: number; // $bn; negative = debt
  revenue: number; // $bn per year
  spending: number; // $bn per year; revenue minus spending is the budget balance
  budget: Budget;
  infra: number; // infrastructure index, 1 = adequate
  research: number; // research points banked (used in stage 7)
  defence: number; // military spending, $bn per year
  munitions: number; // stock as % of a full war reserve
  reservists: number;
  fuelDays: number; // oil in storage, days of use
  shortage: number; // weighted unmet need, 0..1
  energy: EnergyStats;
  migration?: MigrationStats;
  goods: Record<Commodity, CommodityStats>;
  history: HistoryPoint[];
}

/** What everyone can see about any nation's economy. */
export interface EconomyPublic {
  id: number;
  gdp: number;
  pop: number;
  growth: number;
  gdppc: number;
  stability: number; // public approval, 0..100
  blackout: number; // share of electricity demand unmet (it shows from space)
}

export interface MarketSnapshot {
  day: number;
  prices: Record<Commodity, number>; // $bn per unit
  history: { d: number; p: Record<Commodity, number> }[];
}

export function money(bn: number) {
  const a = Math.abs(bn);
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10_000 ? 1 : 2)}T` : a >= 1 ? `$${a.toFixed(a >= 100 ? 0 : 1)}B` : `$${(a * 1000).toFixed(0)}M`;
  return bn < 0 ? `−${s}` : s;
}
