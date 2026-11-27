// Development: how built-up and connected a province is, 0..100. Crowding alone
// does not make a place developed: a packed city in a poor nation is still poor,
// and rich farmland with no city (and no lights at night) is still rural. So it
// weighs how urban the province is (above all whether it is a city, or the
// country around one, then people per km2) together with the owner's wealth per
// person, most of all the two at once, plus a little for finished works there.
// It speeds building there a lot, speeds recruiting a little (by the nation's
// average), and leans politics: developed, urban nations drift liberal and
// open; underdeveloped, rural ones toward authority and looking after their own.

export interface DevInput {
  pop?: number; area?: number; city?: boolean; kind?: string;
  /** The owner's GDP per person, $ a year (unknown: a middling $8,000). */
  gdppc?: number;
  /** Finished civilian works in the province. */
  built?: number;
  /** A city stands in this province (it is the country around a city). */
  hub?: boolean;
  /** The owner's blackout, 0..1: a city whose lights are out is less developed. */
  blackout?: number;
}

/** Works that do not count toward development. */
export const MILITARY_WORKS = new Set<string>(['fort', 'air_defense', 'missile_defense', 'airbase', 'depot']);

/** How urban a province is, 0..1. Cities (where the night lights are) count most: a city ~0.9-1,
 * the country around one 0.3-0.55, and country with no city at most 0.3 however crowded. */
export const urbanity = (p: DevInput) => {
  const density = (p.pop ?? 0) / Math.max(50, p.area ?? 10_000);
  const crowd = Math.min(1, Math.log10(1 + density) / 3); // ~0.33 at 10 people/km2, ~0.67 at 100
  if (p.city) return Math.min(1, 0.55 + 0.45 * crowd);
  if (p.hub) return 0.2 + 0.35 * crowd;
  return 0.3 * crowd;
};

/** How rich, 0..1 by GDP per person on a log scale: $1,000 none, ~$10,000 half, $60,000+ full. */
export const wealth = (gdppc = 8000) => Math.min(1, Math.max(0, (Math.log10(Math.max(1, gdppc)) - 3) / 1.78));

/** A province's development, 0..100. A rich city ~95; a poor megacity ~40; a rich city's
 * hinterland ~50; rich farmland with no city ~30; poor backcountry ~5. */
export function development(p: DevInput) {
  if (p.kind && p.kind !== 'land') return 0;
  const u = urbanity(p) * (1 - 0.5 * Math.min(1, p.blackout ?? 0)), w = wealth(p.gdppc);
  const works = Math.min(8, 2 * (p.built ?? 0));
  return Math.round(Math.max(0, Math.min(100, 3 + 22 * u + 12 * w + 60 * u * w + works)));
}

/** The provinces a city stands in. */
export function cityHubs(provinces: Iterable<{ city?: boolean; parent?: number }>) {
  const out = new Set<number>();
  for (const p of provinces) if (p.city && p.parent !== undefined) out.add(p.parent);
  return out;
}

/** The development where nothing is sped up or slowed down. */
export const DEV_BASELINE = 40;
/** Below the baseline slows, above it speeds up gradually: lo at 0, 1 at 40, hi at 100. */
const aroundBaseline = (dev: number, lo: number, hi: number) =>
  dev < DEV_BASELINE ? lo + (1 - lo) * (dev / DEV_BASELINE) : 1 + (hi - 1) * ((dev - DEV_BASELINE) / (100 - DEV_BASELINE));

/** How fast things are built in a province of this development: x0.6 (none), x1 at 40, x1.6 (full). */
export const buildSpeed = (dev: number) => aroundBaseline(dev, 0.6, 1.6);

/** A nation's population growth by its average development: x0.5 (none), x1 at 40, x1.5 (full). */
export const popGrowthSpeed = (avgDev: number) => aroundBaseline(avgDev, 0.5, 1.5);

/** A nation's development from its provinces': half weighted by people, half by province, so
 * a nation of few cities and much empty country is not judged by its cities alone. */
export function nationDevelopment(list: Iterable<{ dev: number; pop: number }>) {
  let w = 0, t = 0, n = 0, s = 0;
  for (const x of list) { const pop = Math.max(1, x.pop); w += pop; t += pop * x.dev; n++; s += x.dev; }
  return n ? 0.5 * (t / w) + 0.5 * (s / n) : 0;
}

/** How fast a nation recruits, by its people-weighted average development: x0.9 to x1.1. */
export const recruitSpeed = (avgDev: number) => 0.9 + (0.2 * avgDev) / 100;

/** A daily drift in a nation's politics from its average development (+ liberal/open, - authoritarian/nationalist). */
export const devLean = (avgDev: number) => ((avgDev - 45) / 55) * 0.0007;

/** Words for a development level. */
export const devLabel = (dev: number) => (dev >= 75 ? 'Highly developed' : dev >= 55 ? 'Developed' : dev >= 35 ? 'Developing' : dev >= 18 ? 'Rural' : 'Remote');
