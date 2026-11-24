// Roads: drawn by a player across their own provinces. A finished road speeds
// troops (and with them supplies) along it; it is built over some days and paid
// for up front. Its drawn line is kept so the map shows it where it was dragged.

/** One road: the provinces it joins in order, the line as drawn, and how far built it is. */
export interface RoadState {
  id: number;
  owner: number;
  path: number[]; // provinces, each next to the one before
  pts: [number, number][]; // lon, lat of the line as drawn
  progress: number; // 0..1
}

export const ROAD = {
  costPerLeg: 0.35, // $bn for each province-to-province stretch
  daysBase: 8, // game days to build, plus daysPerLeg for each stretch
  daysPerLeg: 3,
  maxLegs: 24,
  maxPts: 240,
  speed: 0.6, // a leg along a finished road takes this share of the time
  maxProjects: 3, // roads under construction at once
};

export const roadCost = (legs: number) => Math.round(ROAD.costPerLeg * legs * 100) / 100;
export const roadDays = (legs: number) => ROAD.daysBase + ROAD.daysPerLeg * legs;
export const roadKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
