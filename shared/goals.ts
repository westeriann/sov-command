// Missions (three per player at a time, sized to their nation) and achievements
// (kept by the account for good, each unlocking flag emblems).

export type GoalKind = 'grow' | 'industry' | 'power' | 'bloc' | 'trade' | 'tech' | 'territory' | 'stability' | 'navy' | 'allies';
export interface SeasonMission {
  kind: GoalKind;
  target: number;
  base: number; // the value when the mission was given
  done?: boolean;
  text: string;
}
export const MISSION_KINDS: GoalKind[] = ['grow', 'industry', 'power', 'bloc', 'trade', 'tech', 'territory', 'stability', 'navy', 'allies'];
/** A completed mission is worth this many game days of the nation's own scoring, and a little cash. */
export const MISSION_REWARD_DAYS = 60;
export const MISSION_CASH = 0.02; // share of GDP

export type AchievementKey = 'first_victory' | 'bloc_founder' | 'nuclear_power' | 'top10' | 'full_tree' | 'empire' | 'missions' | 'champion';
export const ACHIEVEMENTS: Record<AchievementKey, { name: string; text: string; emblem?: string }> = {
  first_victory: { name: 'Victor', text: 'Won territory in a peace treaty', emblem: 'laurel' },
  bloc_founder: { name: 'Founder', text: 'Led a bloc of five or more nations', emblem: 'shield' },
  nuclear_power: { name: 'Deterrent', text: 'Built a nuclear arsenal', emblem: 'atom' },
  top10: { name: 'Contender', text: 'Led the world when a match was won' },
  full_tree: { name: 'Polymath', text: 'Researched every technology' },
  empire: { name: 'Imperial', text: 'Held 60 provinces at once', emblem: 'crown' },
  missions: { name: 'Dutiful', text: 'Completed nine missions' },
  champion: { name: 'Champion', text: 'Won a match by domination', emblem: 'eagle' },
};
