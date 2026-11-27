// What a people believes, who holds power inside a nation, and propaganda.

export interface Ideology {
  liberty: number; // -1 authoritarian .. +1 liberal
  openness: number; // -1 nationalist .. +1 internationalist
}
export type Faction = 'military' | 'business' | 'public';
/** The three pillars a government stands on, in the order they are shown: Business, People, Military. */
export const FACTIONS: Faction[] = ['business', 'public', 'military'];
export const FACTION_INFO: Record<Faction, { name: string; wants: string; happy: string; angry: string; revolt: string }> = {
  business: { name: 'Business', wants: 'growth, low taxes, trade deals and reliable power', happy: '+0.3% growth', angry: '−0.6% growth', revolt: 'capital flight and a business-backed putsch' },
  public: { name: 'People', wants: 'welfare, stability, peace and electricity', happy: '+2 more stability', angry: '−4 more stability', revolt: 'a popular uprising' },
  military: { name: 'Military', wants: 'a big defence budget and victories; hates lost land', happy: 'units build 10% faster', angry: 'land forces fight 10% weaker', revolt: 'a coup' },
};

// The three relationships to balance. Mostly moved by events and how you answer them; policies
// pull on them slowly. 50 and above: no harm. 75 and above: a bonus. Below 50, stability suffers
// more the lower it goes. Below 25 the group may rise against you; with all three below 25 the
// government can fall without a fight.
export const PILLAR_CONTENT = 50;
export const PILLAR_LOYAL = 75;
export const PILLAR_REVOLT = 25;
/** Daily chance that a group below 25 rises against the government. */
export const PILLAR_REVOLT_CHANCE = 1 / 180;
/** Daily chance that the government falls without a fight when all three are below 25. */
export const PILLAR_COLLAPSE_CHANCE = 1 / 25;

/** A group's effect on stability: +3 when loyal, 0 when content, down to −6 when angry, −8 below 25. */
export function pillarStability(v: number) {
  if (v >= PILLAR_LOYAL) return 3;
  if (v >= PILLAR_CONTENT) return 0;
  if (v >= PILLAR_REVOLT) return -Math.round(((PILLAR_CONTENT - v) / (PILLAR_CONTENT - PILLAR_REVOLT)) * 6 * 10) / 10;
  return -8;
}

/** In words: how a group stands, for its bar. */
export function pillarState(v: number): { label: string; level: 'good' | 'ok' | 'warn' | 'bad' } {
  if (v >= PILLAR_LOYAL) return { label: 'Loyal', level: 'good' };
  if (v >= PILLAR_CONTENT) return { label: 'Content', level: 'ok' };
  if (v >= PILLAR_REVOLT) return { label: 'Uneasy', level: 'warn' };
  return { label: 'Ready to revolt', level: 'bad' };
}
export type PropagandaMode = 'off' | 'home' | 'abroad';
export const PROPAGANDA_COST = 0.003; // share of GDP a year
/** Where each government stands, and where its people drift under it. */
export const GOV_LIBERTY: Record<string, number> = { democracy: 0.7, technocracy: 0.2, autocracy: -0.5, junta: -0.8 };

export interface SocietyPrivate {
  ideology: Ideology;
  factions: Record<Faction, number>; // 0..100
  propaganda: { mode: PropagandaMode; target?: number };
  fit: number; // stability effect of how well the government suits the people
}

/** Distance between two peoples' beliefs, 0 (same) .. ~2.8 (opposites). */
export const ideologyGap = (a: Ideology, b: Ideology) => Math.hypot(a.liberty - b.liberty, a.openness - b.openness);
