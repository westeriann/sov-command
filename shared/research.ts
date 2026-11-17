// Research and government: shared by server and client.

export type Branch = 'economy' | 'land' | 'sea_air' | 'society';
export const BRANCHES: Branch[] = ['economy', 'land', 'sea_air', 'society'];
export const BRANCH_NAMES: Record<Branch, string> = { economy: 'Economy', land: 'Land warfare', sea_air: 'Sea and air', society: 'Society' };

/** Bonuses from technology and government. All additive shares (0.1 = +10%). */
export interface Effects {
  growth: number; // added to annual GDP growth (0.002 = +0.2 points)
  stability: number; // added to the stability target (points)
  landAttack: number;
  landDefense: number;
  naval: number; // ships' attack and defense
  air: number; // wings' attack and defense
  manpower: number; // reservists
  build: number; // unit production speed
  research: number; // research speed
}
export const NO_EFFECTS: Effects = { growth: 0, stability: 0, landAttack: 0, landDefense: 0, naval: 0, air: 0, manpower: 0, build: 0, research: 0 };

export type TechId =
  | 'automation' | 'logistics_ai' | 'fusion_grid'
  | 'drones' | 'active_armor' | 'robotic_infantry'
  | 'hypersonics' | 'stealth' | 'orbital_recon' | 'nuclear'
  | 'digital_state' | 'healthcare' | 'social_cohesion';

export interface Tech {
  id: TechId;
  name: string;
  branch: Branch;
  tier: 1 | 2 | 3 | 4;
  effects: Partial<Effects>;
  text: string;
}

/** Research points per tier. At the default 15% research budget a tier-1 tech takes about 2 game months (10 real minutes). */
export const TIER_COST = { 1: 2000, 2: 4500, 3: 9000, 4: 15000 } as const;

export const TECHS: Tech[] = [
  { id: 'automation', name: 'Industrial automation', branch: 'economy', tier: 1, effects: { growth: 0.002 }, text: '+0.2% growth a year' },
  { id: 'logistics_ai', name: 'AI logistics', branch: 'economy', tier: 2, effects: { growth: 0.003, build: 0.15 }, text: '+0.3% growth, units built 15% faster' },
  { id: 'fusion_grid', name: 'Fusion power grid', branch: 'economy', tier: 3, effects: { growth: 0.005 }, text: '+0.5% growth a year' },
  { id: 'drones', name: 'Battlefield drones', branch: 'land', tier: 1, effects: { landAttack: 0.08 }, text: '+8% land attack' },
  { id: 'active_armor', name: 'Active protection', branch: 'land', tier: 2, effects: { landDefense: 0.12 }, text: '+12% land defense' },
  { id: 'robotic_infantry', name: 'Robotic infantry', branch: 'land', tier: 3, effects: { landAttack: 0.12, manpower: 0.2 }, text: '+12% land attack, +20% reservists' },
  { id: 'hypersonics', name: 'Hypersonic missiles', branch: 'sea_air', tier: 1, effects: { naval: 0.1 }, text: '+10% naval power' },
  { id: 'stealth', name: 'Stealth airframes', branch: 'sea_air', tier: 2, effects: { air: 0.15 }, text: '+15% air power' },
  { id: 'orbital_recon', name: 'Orbital reconnaissance', branch: 'sea_air', tier: 3, effects: { naval: 0.1, air: 0.1 }, text: '+10% naval and air power' },
  { id: 'nuclear', name: 'Nuclear deterrent', branch: 'sea_air', tier: 4, effects: {}, text: 'Lets you build nuclear warheads ($40bn each)' },
  { id: 'digital_state', name: 'Digital government', branch: 'society', tier: 1, effects: { stability: 2, research: 0.1 }, text: '+2 stability, research 10% faster' },
  { id: 'healthcare', name: 'Universal genomics', branch: 'society', tier: 2, effects: { stability: 3, manpower: 0.1 }, text: '+3 stability, +10% reservists' },
  { id: 'social_cohesion', name: 'Civic renewal', branch: 'society', tier: 3, effects: { stability: 4, growth: 0.002 }, text: '+4 stability, +0.2% growth' },
];
export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

/** A tech needs the one before it in its branch. */
export function prerequisite(t: Tech): Tech | undefined {
  return TECHS.find((x) => x.branch === t.branch && x.tier === t.tier - 1);
}

export type Government = 'democracy' | 'autocracy' | 'junta' | 'technocracy';
export const GOVERNMENTS: Government[] = ['democracy', 'autocracy', 'junta', 'technocracy'];
export const GOVERNMENT_INFO: Record<Government, { name: string; effects: Partial<Effects>; text: string }> = {
  democracy: { name: 'Democracy', effects: { growth: 0.003, stability: 3 }, text: '+0.3% growth, +3 stability; wars cost 5 more stability' },
  autocracy: { name: 'Autocracy', effects: { growth: -0.002, stability: 2, manpower: 0.2 }, text: '+2 stability, +20% reservists, −0.2% growth' },
  junta: { name: 'Military junta', effects: { growth: -0.005, stability: -4, landAttack: 0.1, manpower: 0.35, build: 0.1 }, text: '+10% land attack, +35% reservists, faster builds; −0.5% growth, −4 stability' },
  technocracy: { name: 'Technocracy', effects: { growth: 0.002, stability: -2, research: 0.3 }, text: 'Research 30% faster, +0.2% growth, −2 stability' },
};
/** Changing government: a month of turmoil, at most once a game year. */
export const REFORM_DAYS = 30;
export const REFORM_COOLDOWN_DAYS = 365;
export const REFORM_STABILITY = -10;

export interface ResearchPrivate {
  current?: TechId;
  progress: number; // points into the current tech
  rate: number; // points per game day right now
  done: TechId[];
  government: Government;
  reformUntil?: number; // game day the current reform ends
  reformedAt?: number; // game day of the last reform
  nextElection?: number; // game day (democracies)
  oppositionUntil?: number; // game day: lost an election, no wars of choice until then
}

/** Sum effects of a government and a set of techs. */
export function effectsOf(gov: Government, done: TechId[], reforming = false): Effects {
  const e = { ...NO_EFFECTS };
  const add = (x: Partial<Effects>) => { for (const k of Object.keys(x) as (keyof Effects)[]) e[k] += x[k] ?? 0; };
  add(GOVERNMENT_INFO[gov].effects);
  for (const id of done) add(TECH_BY_ID.get(id)?.effects ?? {});
  if (reforming) e.stability += REFORM_STABILITY;
  return e;
}
