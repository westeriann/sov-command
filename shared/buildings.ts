// Province buildings: built from the national treasury over game days.

export type BuildingType = 'fort' | 'air_defense' | 'factory' | 'mine' | 'port' | 'airbase' | 'coal_plant' | 'gas_plant' | 'nuclear_plant' | 'renewables';
export const BUILDING_TYPES: BuildingType[] = ['fort', 'air_defense', 'factory', 'mine', 'port', 'airbase', 'coal_plant', 'gas_plant', 'nuclear_plant', 'renewables'];

export interface BuildingSpec { name: string; cost: number; days: number; text: string; coastal?: boolean }
export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  fort: { name: 'Fortifications', cost: 3, days: 40, text: 'Defenders fight 50% harder here' },
  air_defense: { name: 'Air defense site', cost: 4, days: 35, text: 'Halves enemy air power here, wears down raiders, may intercept missiles' },
  factory: { name: 'Factory complex', cost: 8, days: 60, text: '+0.08% growth a year (up to 10); needs metals and electricity' },
  mine: { name: 'Mine and refinery', cost: 6, days: 50, text: '+4% output of the nation’s main raw material' },
  port: { name: 'Naval port', cost: 5, days: 45, text: 'A supply hub for armies; needs a coast', coastal: true },
  airbase: { name: 'Air base', cost: 4, days: 30, text: 'Wings based here fly 30% farther' },
  coal_plant: { name: 'Coal power station', cost: 5, days: 50, text: 'Electricity for 5% of the economy; burns coal' },
  gas_plant: { name: 'Gas power station', cost: 6, days: 40, text: 'Electricity for 5% of the economy; burns gas' },
  nuclear_plant: { name: 'Nuclear power station', cost: 22, days: 140, text: 'Electricity for 9% of the economy; no fuel' },
  renewables: { name: 'Wind and solar farm', cost: 4, days: 35, text: 'Electricity for 2.5% of the economy; no fuel' },
};
/** Share of national electricity demand each power station covers, and the fuel it burns. */
export const POWER_SHARE: Partial<Record<BuildingType, number>> = { coal_plant: 0.05, gas_plant: 0.05, nuclear_plant: 0.09, renewables: 0.025 };
export const POWER_FUEL: Partial<Record<BuildingType, 'coal' | 'gas'>> = { coal_plant: 'coal', gas_plant: 'gas' };
export const MAX_CONSTRUCTION = 4; // projects under way per nation
export const FACTORY_GROWTH = 0.0008;
export const MAX_FACTORIES = 10;

export interface BuildingState { type: BuildingType; progress: number } // progress 0..1; 1 = finished
