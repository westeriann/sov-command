// Research and government: shared by server and client. The tree itself is in tech-tree.ts.

import { BRANCHES, BRANCH_NAMES, BRANCH_SHORT, ERA_NAMES, MAX_TIER, TECH_DEFS, TIER_COST, type Branch, type TechDef } from './tech-tree';
export { BRANCHES, BRANCH_NAMES, BRANCH_SHORT, ERA_NAMES, MAX_TIER, TIER_COST, type Branch };
import { MODE_INFO, type GameSettings } from './settings';

/** Research points a technology of this tier costs under a game's settings (Dash: half; unknown: the full Marathon pace). */
export const techCost = (tier: number, settings?: Pick<GameSettings, 'mode'> | null) => Math.round(TIER_COST[tier] * (settings ? MODE_INFO[settings.mode]?.research ?? 1 : 1));

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
  construct: number; // buildings and repairs go up faster
  food: number; // food output
  treasury: number; // a share of GDP paid into the treasury each year
  power: number; // added electricity supply (share of demand)
  spy: number; // agents' chance of success
}
export const NO_EFFECTS: Effects = { growth: 0, stability: 0, landAttack: 0, landDefense: 0, naval: 0, air: 0, manpower: 0, build: 0, research: 0, construct: 0, food: 0, treasury: 0, power: 0, spy: 0 };

export type TechId = string;

export interface Tech extends TechDef {
  /** Its bonuses and what it unlocks, in words. */
  text: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** A set of bonuses in words, e.g. "+8% land attack, research 5% faster". */
export function effectText(e: Partial<Effects>): string[] {
  const out: string[] = [];
  const v = (k: keyof Effects) => e[k] ?? 0;
  if (v('growth')) out.push(`+${(v('growth') * 100).toFixed(2).replace(/0$/, '')}% growth a year`);
  if (v('stability')) out.push(`+${Math.round(v('stability') * 2) / 2} stability`);
  if (v('landAttack')) out.push(`+${pct(v('landAttack'))} land attack`);
  if (v('landDefense')) out.push(`+${pct(v('landDefense'))} land defense`);
  if (v('naval')) out.push(`+${pct(v('naval'))} naval power`);
  if (v('air')) out.push(`+${pct(v('air'))} air power`);
  if (v('manpower')) out.push(`+${pct(v('manpower'))} reservists`);
  if (v('build')) out.push(`units built ${pct(v('build'))} faster`);
  if (v('research')) out.push(`research ${pct(v('research'))} faster`);
  if (v('construct')) out.push(`buildings go up ${pct(v('construct'))} faster`);
  if (v('food')) out.push(`+${pct(v('food'))} food output`);
  if (v('treasury')) out.push(`+${(v('treasury') * 100).toFixed(2)}% of GDP a year to the treasury`);
  if (v('power')) out.push(`+${(v('power') * 100).toFixed(1).replace(/\.0$/, '')}% electricity supply`);
  if (v('spy')) out.push(`agents ${pct(v('spy'))} likelier to succeed`);
  return out;
}

/** Technologies a nation can line up after the current one. */
export const MAX_RESEARCH_QUEUE = 20;

const sentence = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
export const TECHS: Tech[] = TECH_DEFS.map((d) => ({ ...d, text: sentence([effectText(d.effects).join(', '), d.unlock ?? ''].filter(Boolean).join('; ')) || 'No bonus' }));
export const TECH_BY_ID = new Map<string, Tech>(TECHS.map((t) => [t.id, t]));

/** The technologies a technology needs. */
export function prerequisites(t: Tech): Tech[] {
  return t.needs.map((id) => TECH_BY_ID.get(id)!).filter(Boolean);
}
/** Whether every prerequisite is in the set (known, or known-or-lined-up). */
export function ready(t: Tech, have: { has(id: string): boolean }) {
  return t.needs.every((id) => have.has(id));
}
/** The first prerequisite not in the set, for "Research X first". */
export function missing(t: Tech, have: { has(id: string): boolean }): Tech | undefined {
  return prerequisites(t).find((p) => !have.has(p.id));
}
/**
 * Everything still to research to reach a technology, its prerequisites first
 * (the technology last), leaving out what is already in the set.
 */
export function pathTo(t: Tech, have: { has(id: string): boolean }): Tech[] {
  const out: Tech[] = [], seen = new Set<string>();
  const visit = (x: Tech) => {
    if (seen.has(x.id) || have.has(x.id)) return;
    seen.add(x.id);
    for (const p of prerequisites(x)) visit(p);
    out.push(x);
  };
  visit(t);
  return out;
}
/** Research points still to spend on a list of technologies. */
export const pathCost = (ts: Tech[], settings?: Pick<GameSettings, 'mode'> | null) => ts.reduce((a, t) => a + techCost(t.tier, settings), 0);

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
  queue?: TechId[]; // next in line, in order
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
