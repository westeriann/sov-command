// What a people believes, who holds power inside a nation, and propaganda.

export interface Ideology {
  liberty: number; // -1 authoritarian .. +1 liberal
  openness: number; // -1 nationalist .. +1 internationalist
}
export type Faction = 'military' | 'business' | 'public';
export const FACTIONS: Faction[] = ['military', 'business', 'public'];
export const FACTION_INFO: Record<Faction, { name: string; wants: string; happy: string; angry: string }> = {
  military: { name: 'The military', wants: 'a big defence budget and victories; hates lost land', happy: 'units build 10% faster', angry: 'land forces fight 10% weaker; coups more likely' },
  business: { name: 'Business', wants: 'growth, low taxes, trade deals and reliable power', happy: '+0.3% growth', angry: '−0.6% growth' },
  public: { name: 'The public', wants: 'welfare, stability, peace and electricity', happy: '+4 stability', angry: '−8 stability' },
};
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
