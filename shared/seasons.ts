// The weather seasons of the game year: spring, summer, autumn and winter,
// opposite in the two hemispheres. At the default speed each lasts 15 real minutes.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_NAMES: Record<Season, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

/** Season at a latitude on a game date. The tropics (within 23°) have none. */
export function seasonAt(gameMs: number, lat: number): Season | null {
  if (Math.abs(lat) < 23) return null;
  const month = new Date(gameMs).getUTCMonth(); // 0 = January
  const north: Season = month <= 1 || month === 11 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'autumn';
  if (lat >= 0) return north;
  return ({ winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' } as const)[north];
}

const COLD_TERRAIN = ['boreal', 'tundra', 'ice', 'mountain_wet', 'mountain_dry'];
/** Lands where winter bites: high latitudes, and cold or mountain country. */
export const coldLand = (terrain: string, lat: number) => Math.abs(lat) >= 40 || (Math.abs(lat) >= 23 && COLD_TERRAIN.includes(terrain));

/** Winter in cold lands: armies move this much slower. */
export const WINTER_SLOW = 1.5;
/** Daily strength lost by troops wintering on foreign soil. */
export const WINTER_ATTRITION = 1;
/** Food output by season outside the tropics (averages about 1 over the year). */
export const HARVEST: Record<Season, number> = { spring: 0.9, summer: 1.05, autumn: 1.25, winter: 0.8 };
/** Electricity demand in winter (heating). */
export const WINTER_POWER = 1.1;

/** How much longer a leg into this province takes at this moment. */
export function seasonSlow(gameMs: number, terrain: string, lat: number) {
  return seasonAt(gameMs, lat) === 'winter' && coldLand(terrain, lat) ? WINTER_SLOW : 1;
}
