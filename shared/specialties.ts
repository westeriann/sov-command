// Every land province has one specialty: something its climate and place are
// known for, decided from its terrain, latitude, height, coast and rivers.
// Holding provinces with a specialty gives the nation a bonus (more provinces,
// more bonus, with diminishing returns); luxuries also reach trade partners at
// half strength, so trade agreements are worth seeking out.

export type Specialty =
  | 'fish' | 'cattle' | 'wine' | 'spices' | 'coffee' | 'cotton' | 'rubber' | 'furs'
  | 'gold' | 'gems' | 'uranium' | 'lithium' | 'marble' | 'geothermal' | 'salt' | 'resorts' | 'grain';

export interface SpecialtySpec {
  name: string;
  /** What owning it does (shown to players; the server applies the matching effect). */
  effect: string;
  /** A luxury people anywhere want: trade partners share it at half strength. */
  luxury?: boolean;
  /** Effect per province held (diminishing). */
  per: Partial<SpecialtyBonus>;
}

export const SPECIALTIES: Record<Specialty, SpecialtySpec> = {
  fish: { name: 'Fisheries', effect: '+3% food output', per: { food: 0.03 } },
  grain: { name: 'Breadbasket', effect: '+3% food output', per: { food: 0.03 } },
  cattle: { name: 'Cattle ranges', effect: '+2% food output, +0.5 stability', per: { food: 0.02, stability: 0.5 } },
  wine: { name: 'Vineyards', effect: '+1.5 stability (luxury)', luxury: true, per: { stability: 1.5 } },
  spices: { name: 'Spice gardens', effect: '+1 stability, +0.05% growth (luxury)', luxury: true, per: { stability: 1, growth: 0.0005 } },
  coffee: { name: 'Coffee and tea', effect: '+1 stability, research 2% faster (luxury)', luxury: true, per: { stability: 1, research: 0.02 } },
  furs: { name: 'Fur trapping', effect: '+1 stability (luxury)', luxury: true, per: { stability: 1 } },
  gems: { name: 'Gem mines', effect: '+1 stability (luxury), +0.05% of GDP a year to the treasury', luxury: true, per: { stability: 1, treasury: 0.0005 } },
  cotton: { name: 'Cotton fields', effect: '+0.1% growth (textiles)', per: { growth: 0.001 } },
  rubber: { name: 'Rubber plantations', effect: 'units built 4% faster', per: { build: 0.04 } },
  gold: { name: 'Gold fields', effect: '+0.1% of GDP a year to the treasury', per: { treasury: 0.001 } },
  uranium: { name: 'Uranium', effect: 'nuclear power stations cost 40% less; nuclear warheads need it (or a trade partner with it)', per: {} },
  lithium: { name: 'Lithium flats', effect: 'research 3% faster; wind and solar farms give 50% more power', per: { research: 0.03 } },
  marble: { name: 'Stone quarries', effect: 'buildings and repairs 5% faster', per: { construct: 0.05 } },
  geothermal: { name: 'Geothermal springs', effect: '+2% electricity supply', per: { power: 0.02 } },
  salt: { name: 'Salt works', effect: 'food shortages hurt stability less', per: { stability: 0.5 } },
  resorts: { name: 'Resorts', effect: '+0.08% growth (tourism)', per: { growth: 0.0008 } },
};
export const SPECIALTY_LIST = Object.keys(SPECIALTIES) as Specialty[];

/** The bonuses a nation draws from its specialties (shares, points of stability, shares of GDP). */
export interface SpecialtyBonus { stability: number; growth: number; research: number; build: number; construct: number; food: number; treasury: number; power: number }
export const NO_SPECIALTY_BONUS: SpecialtyBonus = { stability: 0, growth: 0, research: 0, build: 0, construct: 0, food: 0, treasury: 0, power: 0 };

/** Sum the bonuses of the specialties held (counts of provinces), and of luxuries shared by trade partners. */
export function specialtyBonus(own: Partial<Record<Specialty, number>>, shared: Specialty[]): SpecialtyBonus {
  const b = { ...NO_SPECIALTY_BONUS };
  const add = (s: Specialty, w: number) => { for (const [k, v] of Object.entries(SPECIALTIES[s].per)) b[k as keyof SpecialtyBonus] += (v as number) * w; };
  for (const [s, n] of Object.entries(own)) add(s as Specialty, specialtyWeight(n ?? 0));
  for (const s of shared) if (!own[s]) add(s, 0.5);
  return b;
}

/** What decides a specialty: fields every province carries, on the server and in the client. */
export interface SpecialtyPlace {
  id: number;
  kind: 'land' | 'sea';
  terrain: string;
  label: [number, number];
  elev?: number;
  coastal?: boolean;
  river?: number;
}

/** A small stable hash, so the same province always gets the same pick among its candidates. */
function pick<T>(id: number, list: T[]): T {
  let h = (id * 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return list[h % list.length];
}

/** The province's specialty, from its climate and place; null for sea zones. */
export function specialtyOf(p: SpecialtyPlace): Specialty | null {
  if (p.kind !== 'land') return null;
  const lat = Math.abs(p.label[1]);
  const t = p.terrain, h = p.elev ?? 0;
  const c: Specialty[] = [];
  const mountain = t.startsWith('mountain') || h > 1500;
  if (p.coastal) c.push('fish', 'fish');
  if (p.coastal && lat < 32 && t !== 'rainforest') c.push('resorts');
  if (p.coastal && (t === 'desert_sand' || t === 'desert_rock' || t === 'shrubland')) c.push('salt');
  if (mountain) c.push('marble', 'gold', 'gems', 'geothermal');
  if (mountain && (t === 'mountain_dry' || lat < 40)) c.push('uranium');
  if (t === 'desert_rock' || t === 'desert_sand') c.push('lithium', 'salt', t === 'desert_rock' ? 'uranium' : 'gold');
  if (t === 'rainforest') c.push('rubber', 'spices', 'spices');
  if (t === 'savanna') c.push('spices', 'cattle', 'cotton');
  if ((t === 'rainforest' || t === 'savanna' || t === 'temperate_forest') && lat < 25 && h > 700) c.push('coffee', 'coffee');
  if (t === 'shrubland' && lat >= 28 && lat <= 50) c.push('wine', 'wine');
  if (t === 'shrubland' && lat < 35) c.push('cotton');
  if (t === 'grassland') c.push('grain', 'grain', 'cattle', lat >= 32 && lat <= 50 ? 'wine' : 'grain');
  if (t === 'steppe') c.push('cattle', 'cattle', 'grain');
  if (t === 'temperate_forest') c.push('furs', 'grain', 'marble');
  if (t === 'boreal' || t === 'tundra') c.push('furs', 'furs', lat > 60 ? 'gold' : 'furs');
  if (t === 'ice') c.push('furs', 'uranium');
  if ((p.river ?? 0) >= 3 && lat < 45) c.push('cotton', 'grain');
  if (!c.length) c.push(lat > 55 ? 'furs' : lat < 25 ? 'spices' : 'grain');
  return pick(p.id, c);
}

/** Diminishing returns: the first province counts fully, then half, a quarter... (at most ~2x). */
export const specialtyWeight = (count: number) => (count <= 0 ? 0 : 2 * (1 - 0.5 ** count));
