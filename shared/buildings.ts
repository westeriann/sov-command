// Province buildings: built from the national treasury (and goods from the national
// stocks) over game days. Some produce the goods every society runs on.
import { COMMODITY_INFO, type Commodity } from './economy';

export type BuildingType = 'fort' | 'air_defense' | 'factory' | 'mine' | 'port' | 'airbase' | 'coal_plant' | 'gas_plant' | 'nuclear_plant' | 'renewables' | 'missile_defense' | 'depot'
  | 'farm' | 'logging_camp' | 'oil_well' | 'gas_well' | 'coal_mine' | 'rare_earth_mine';
export const BUILDING_TYPES: BuildingType[] = ['farm', 'logging_camp', 'mine', 'coal_mine', 'oil_well', 'gas_well', 'rare_earth_mine', 'factory', 'coal_plant', 'gas_plant', 'nuclear_plant', 'renewables',
  'port', 'depot', 'fort', 'air_defense', 'airbase', 'missile_defense'];

/** A province resource (its score, 0..100, in the province data). */
export type ResourceKey = 'farmland' | 'timber' | 'oil' | 'gas' | 'coal' | 'ore' | 'rare_earths';

export interface BuildingSpec {
  name: string;
  cost: number; // $bn
  days: number;
  text: string;
  coastal?: boolean;
  /** What it is built of, as shares of a tenth of its money cost in goods (see buildGoods). */
  goods: Partial<Record<Commodity, number>>;
  /** Produces this good: it needs the province resource of the same kind. */
  produces?: Commodity;
  needs?: ResourceKey;
}
export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  farm: { name: 'Farms', cost: 2, days: 30, text: 'Grows food: more the better the farmland', goods: { timber: 0.6, metals: 0.4 }, produces: 'food', needs: 'farmland' },
  logging_camp: { name: 'Logging camp', cost: 2, days: 25, text: 'Cuts timber: more the richer the forest', goods: { metals: 0.5, oil: 0.5 }, produces: 'timber', needs: 'timber' },
  mine: { name: 'Metal mine and smelter', cost: 6, days: 50, text: 'Mines and smelts metals: more the richer the ore', goods: { timber: 0.4, metals: 0.3, coal: 0.3 }, produces: 'metals', needs: 'ore' },
  coal_mine: { name: 'Coal mine', cost: 4, days: 40, text: 'Digs coal: more the richer the seam', goods: { timber: 0.5, metals: 0.5 }, produces: 'coal', needs: 'coal' },
  oil_well: { name: 'Oil field', cost: 5, days: 45, text: 'Pumps oil: more the richer the field', goods: { metals: 0.8, timber: 0.2 }, produces: 'oil', needs: 'oil' },
  gas_well: { name: 'Gas field', cost: 5, days: 45, text: 'Draws natural gas: more the richer the field', goods: { metals: 0.8, timber: 0.2 }, produces: 'gas', needs: 'gas' },
  rare_earth_mine: { name: 'Rare earth mine', cost: 6, days: 55, text: 'Mines rare earths: more the richer the deposit', goods: { metals: 0.6, oil: 0.4 }, produces: 'rare_earths', needs: 'rare_earths' },
  fort: { name: 'Fortifications', cost: 3, days: 40, text: 'Defenders fight 50% harder here', goods: { metals: 0.6, timber: 0.4 } },
  air_defense: { name: 'Air defense site', cost: 4, days: 35, text: 'Halves enemy air power here, wears down raiders, may intercept missiles', goods: { metals: 0.7, rare_earths: 0.3 } },
  factory: { name: 'Factory complex', cost: 8, days: 60, text: '+0.08% growth a year (up to 10), +1.5 equipment a day; needs metals and electricity', goods: { metals: 0.8, timber: 0.2 } },
  port: { name: 'Naval port', cost: 5, days: 45, text: 'A supply hub for armies; needs a coast', coastal: true, goods: { metals: 0.5, timber: 0.5 } },
  airbase: { name: 'Air base', cost: 4, days: 30, text: 'Wings based here fly 30% farther', goods: { metals: 0.5, oil: 0.5 } },
  depot: { name: 'Supply depot', cost: 3, days: 25, text: 'A supply hub: armies within 3 provinces beyond your own land stay supplied', goods: { metals: 0.6, timber: 0.4 } },
  coal_plant: { name: 'Coal power station', cost: 5, days: 50, text: 'Electricity for 5% of the economy; burns coal', goods: { metals: 0.7, coal: 0.3 } },
  gas_plant: { name: 'Gas power station', cost: 6, days: 40, text: 'Electricity for 5% of the economy; burns gas', goods: { metals: 0.7, gas: 0.3 } },
  nuclear_plant: { name: 'Nuclear power station', cost: 22, days: 140, text: 'Electricity for 9% of the economy; no fuel', goods: { metals: 0.8, rare_earths: 0.2 } },
  renewables: { name: 'Wind and solar farm', cost: 4, days: 35, text: 'Electricity for 2.5% of the economy; no fuel', goods: { metals: 0.4, rare_earths: 0.6 } },
  missile_defense: { name: 'Missile defense battery', cost: 12, days: 70, text: 'Within 600 km: shoots down 80% of missiles and 40% of nuclear warheads', goods: { metals: 0.5, rare_earths: 0.5 } },
};

/** Goods a building takes: worth a tenth of its money cost at base prices, split by its shares. */
export function buildGoods(t: BuildingType): Partial<Record<Commodity, number>> {
  const spec = BUILDINGS[t], out: Partial<Record<Commodity, number>> = {};
  for (const [c, share] of Object.entries(spec.goods) as [Commodity, number][]) out[c] = Math.round(((spec.cost * 0.1 * share) / COMMODITY_INFO[c].basePrice) * 10) / 10;
  return out;
}

/** The least resource score a producing building needs in its province. */
export const MIN_RESOURCE = 15;

/** What a producing building makes a year (in the good's own units), by the province's resource score. */
export function buildingOutput(t: BuildingType, score: number) {
  const g = BUILDINGS[t].produces;
  if (!g) return 0;
  return COMMODITY_INFO[g].worldUse * 0.0003 * (0.5 + Math.min(100, Math.max(0, score)) / 100);
}

export const MISSILE_SHIELD_KM = 600;
/** Share of national electricity demand each power station covers, and the fuel it burns. */
export const POWER_SHARE: Partial<Record<BuildingType, number>> = { coal_plant: 0.05, gas_plant: 0.05, nuclear_plant: 0.09, renewables: 0.025 };
export const POWER_FUEL: Partial<Record<BuildingType, 'coal' | 'gas'>> = { coal_plant: 'coal', gas_plant: 'gas' };
export const MAX_CONSTRUCTION = 4; // projects under way per nation
export const FACTORY_GROWTH = 0.0008;
export const MAX_FACTORIES = 10;

export interface BuildingState {
  type: BuildingType;
  progress: number; // 0..1; 1 = finished
  damaged?: boolean; // hit by a hurricane: it does nothing until repaired
  repair?: number; // 0..1 while being repaired
}
/** Repairing a damaged building costs this share of building it, and this share of its build time. */
export const REPAIR_COST_SHARE = 0.4;
export const REPAIR_TIME_SHARE = 0.33;
