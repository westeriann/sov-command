// Development: how built-up and connected a province is, 0..100. It follows how
// many people live there for its size, and cities count for a great deal. It
// speeds building there a lot, speeds recruiting a little (by the nation's
// average), and leans politics: developed, urban nations drift liberal and
// open; underdeveloped, rural ones toward authority and looking after their own.

export interface DevInput { pop?: number; area?: number; city?: boolean; kind?: string }

/** A province's development, 0..100. */
export function development(p: DevInput) {
  if (p.kind && p.kind !== 'land') return 0;
  const density = (p.pop ?? 0) / Math.max(50, p.area ?? 10_000); // people per km2
  const base = 8 + 24 * Math.log10(1 + density);                  // ~10 empty, ~40 at 15/km2, ~60 at 100/km2
  return Math.round(Math.max(0, Math.min(100, base + (p.city ? 30 : 0))));
}

/** How fast things are built in a province of this development: x0.5 (none) to x1.5 (full). */
export const buildSpeed = (dev: number) => 0.5 + dev / 100;

/** How fast a nation recruits, by its people-weighted average development: x0.9 to x1.1. */
export const recruitSpeed = (avgDev: number) => 0.9 + (0.2 * avgDev) / 100;

/** A daily drift in a nation's politics from its average development (+ liberal/open, - authoritarian/nationalist). */
export const devLean = (avgDev: number) => ((avgDev - 45) / 55) * 0.0007;

/** Words for a development level. */
export const devLabel = (dev: number) => (dev >= 75 ? 'Highly developed' : dev >= 55 ? 'Developed' : dev >= 35 ? 'Developing' : dev >= 18 ? 'Rural' : 'Remote');
