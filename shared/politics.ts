// Domestic politics: political capital, laws, and the people a government must
// carry with it. Democracies pass laws through parliament and must keep its
// support (it also has to back wars and steep taxes); technocracies answer to a
// council of experts; autocracies and juntas rule by decree, cheaper in capital
// but hard on the public, and a junta cannot act against its own officers.
import type { Effects } from './research';
import type { Faction } from './society';

export type LawId =
  | 'conscription' | 'free_trade' | 'tariffs' | 'research_grants' | 'infrastructure_act' | 'emergency_powers'
  | 'austerity' | 'rationing' | 'press_freedom' | 'censorship' | 'green_energy' | 'strategic_reserves';

export interface LawSpec {
  name: string;
  text: string; // what it does, for players
  cost: number; // political capital to pass (decrees cost less)
  /** How each group feels about it: +1 for, -1 against. Decides votes, and moves the groups' mood while in force. */
  lean: Partial<Record<Faction, number>>;
  effects: Partial<Effects>;
  upkeep?: number; // share of GDP a year from the treasury
  excludes?: LawId[];
  liberty?: number; // drift of the people's beliefs a year (+ liberal, - authoritarian)
}

export const LAWS: Record<LawId, LawSpec> = {
  conscription: { name: 'Conscription', text: '+30% reservists, units built 10% faster; the public resents it', cost: 30, lean: { military: 1, public: -1 }, effects: { manpower: 0.3, build: 0.1, stability: -2 } },
  free_trade: { name: 'Free trade act', text: 'trade agreements give 50% more growth; trade partners like you more', cost: 25, lean: { business: 1, public: -0.3 }, effects: { growth: 0.001 }, excludes: ['tariffs'] },
  tariffs: { name: 'Protective tariffs', text: 'import duties raise 2% of the value of imports... and +2 stability from protected jobs; −0.2% growth, trade partners like you less', cost: 20, lean: { public: 1, business: -1 }, effects: { growth: -0.002, stability: 2 }, excludes: ['free_trade'] },
  research_grants: { name: 'Research grants', text: 'research 15% faster; costs 0.2% of GDP a year', cost: 25, lean: { business: 0.5 }, effects: { research: 0.15 }, upkeep: 0.002 },
  infrastructure_act: { name: 'Infrastructure act', text: '+0.25% growth and a faster-growing power grid; costs 0.3% of GDP a year', cost: 30, lean: { business: 1, public: 0.5 }, effects: { growth: 0.0025 }, upkeep: 0.003 },
  emergency_powers: { name: 'Emergency powers', text: 'laws pass without a vote and wars need no parliament; +3 stability now, but liberties erode and the public sours', cost: 45, lean: { military: 1, public: -1, business: -0.5 }, effects: { stability: 3 }, liberty: -0.15 },
  austerity: { name: 'Austerity', text: 'government spends 10% less, paying down debt; −4 stability', cost: 20, lean: { business: 1, public: -1 }, effects: { stability: -4 } },
  rationing: { name: 'Rationing', text: 'goods shortages hurt growth and stability half as much; −0.2% growth', cost: 15, lean: { public: 0.5, business: -1 }, effects: { growth: -0.002 } },
  press_freedom: { name: 'Press freedom', text: 'research 5% faster, +0.1% growth; scandals bite harder (−1 stability)', cost: 20, lean: { public: 1, military: -0.5 }, effects: { research: 0.05, growth: 0.001, stability: -1 }, excludes: ['censorship'], liberty: 0.1 },
  censorship: { name: 'Censorship', text: '+3 stability; research 5% slower; liberties erode', cost: 15, lean: { military: 0.5, public: -1 }, effects: { stability: 3, research: -0.05 }, excludes: ['press_freedom'], liberty: -0.1 },
  green_energy: { name: 'Green energy act', text: 'wind and solar farms cost half; coal and gas stations burn 15% less fuel', cost: 25, lean: { public: 1, business: -0.5 }, effects: {} },
  strategic_reserves: { name: 'Strategic reserves', text: 'stockpiles of every good are kept 50% larger; costs 0.15% of GDP a year', cost: 20, lean: { military: 1 }, effects: {}, upkeep: 0.0015 },
};
export const LAW_IDS = Object.keys(LAWS) as LawId[];

/** Who must agree to a law. */
export type Legislature = 'parliament' | 'council' | 'decree' | 'junta';
export const LEGISLATURE: Record<string, Legislature> = { democracy: 'parliament', technocracy: 'council', autocracy: 'decree', junta: 'junta' };
export const LEGISLATURE_TEXT: Record<Legislature, string> = {
  parliament: 'Parliament votes on every law, must back a war of choice, and must agree to taxes above 32%. Its support follows the public, business and stability, and rises when you meet its demands.',
  council: 'A council of experts reviews every law. It listens most to business and to results: growth and stability.',
  decree: 'You rule by decree: laws pass at once and cost less capital, but each one the public dislikes costs stability and public goodwill.',
  junta: 'The officers rule with you: decrees pass at once, but nothing passes against the military, and an unhappy army means coups.',
};

/** Decrees are cheaper than votes. */
export const DECREE_DISCOUNT = 0.7;
export const MAX_CAPITAL = 200;
export const WAR_SUPPORT = 40; // parliament support needed for a war of choice
export const HIGH_TAX = 32; // taxes above this need parliament support...
export const HIGH_TAX_SUPPORT = 55; // ...of at least this

/** What parliament (or the elites, under authoritarian rule) asks of the government. */
export type DemandKind = 'welfare' | 'peace' | 'lower_tax' | 'trade' | 'research' | 'defence' | 'infrastructure';
export interface Demand { kind: DemandKind; text: string; target?: number; since: number; until: number; by: 'parliament' | 'military' | 'business' | 'public' }

export interface PoliticsPrivate {
  capital: number; // political capital
  gain: number; // per game day
  legislature: Legislature;
  support?: number; // parliament or council support, 0..100
  laws: LawId[];
  demand?: Demand;
  claims: number[]; // nations we hold a claim on (a refused demand): wars on them are justified
  emergencyUntil?: number; // game day
}
