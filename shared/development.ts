// Development: how built-up and connected a province is, 0..100. Crowding alone
// does not make a place developed: a packed city in a poor nation is still poor.
// So it weighs how urban the province is (people per km2, and whether it is a
// city) together with the owner's wealth per person, most of all the two at
// once, plus a little for finished works there (factories, ports, plants...).
// It speeds building there a lot, speeds recruiting a little (by the nation's
// average), and leans politics: developed, urban nations drift liberal and
// open; underdeveloped, rural ones toward authority and looking after their own.

export interface DevInput {
  pop?: number; area?: number; city?: boolean; kind?: string;
  /** The owner's GDP per person, $ a year (unknown: a middling $8,000). */
  gdppc?: number;
  /** Finished civilian works in the province. */
  built?: number;
}

/** Works that do not count toward development. */
export const MILITARY_WORKS = new Set<string>(['fort', 'air_defense', 'missile_defense', 'airbase', 'depot']);

/** How urban a province is, 0..1: ~0.3 at 10 people/km2, ~0.66 at 100, full in a big crowded city. */
export const urbanity = (p: DevInput) => {
  const density = (p.pop ?? 0) / Math.max(50, p.area ?? 10_000);
  return Math.min(1, Math.log10(1 + density) / 3 + (p.city ? 0.25 : 0));
};

/** How rich, 0..1 by GDP per person on a log scale: $1,000 none, ~$10,000 half, $60,000+ full. */
export const wealth = (gdppc = 8000) => Math.min(1, Math.max(0, (Math.log10(Math.max(1, gdppc)) - 3) / 1.78));

/** A province's development, 0..100. A rich city ~95; a poor megacity ~35; rich farmland ~30; poor backcountry ~10. */
export function development(p: DevInput) {
  if (p.kind && p.kind !== 'land') return 0;
  const u = urbanity(p), w = wealth(p.gdppc);
  const works = Math.min(10, 2.5 * (p.built ?? 0));
  return Math.round(Math.max(0, Math.min(100, 3 + 22 * u + 18 * w + 55 * u * w + works)));
}

/** How fast things are built in a province of this development: x0.5 (none) to x1.5 (full). */
export const buildSpeed = (dev: number) => 0.5 + dev / 100;

/** How fast a nation recruits, by its people-weighted average development: x0.9 to x1.1. */
export const recruitSpeed = (avgDev: number) => 0.9 + (0.2 * avgDev) / 100;

/** A daily drift in a nation's politics from its average development (+ liberal/open, - authoritarian/nationalist). */
export const devLean = (avgDev: number) => ((avgDev - 45) / 55) * 0.0007;

/** Words for a development level. */
export const devLabel = (dev: number) => (dev >= 75 ? 'Highly developed' : dev >= 55 ? 'Developed' : dev >= 35 ? 'Developing' : dev >= 18 ? 'Rural' : 'Remote');
