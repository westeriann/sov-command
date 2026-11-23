// Peace conferences: the winner picks terms and pays for them with war score.
// War score runs -100..100 for each side: land held of the other's people,
// battles won and units destroyed. Terms that match the declared war goal cost half.
import type { Government } from './research';
import type { WarGoal } from './military';

export interface PeaceTreaty {
  provinces: number[]; // the loser's provinces handed to the winner
  reparations: number; // share of the loser's GDP paid each year for REPARATION_YEARS (0..0.05)
  demilitarize: boolean; // no loser troops in its provinces on the winner's border for DEMIL_YEARS
  regime?: Government; // the loser adopts this form of government
  puppet?: boolean; // the loser becomes the winner's vassal
}

export const REPARATION_YEARS = 5;
export const DEMIL_YEARS = 5;
export const MAX_REPARATIONS = 0.05;

/** War-score cost of each term. A province costs by its share of the loser's people. */
export const PEACE_COST = {
  province: (popShare: number) => 4 + popShare * 120,
  reparationsPerPct: 8, // per 1% of GDP a year
  demilitarize: 12,
  regime: 30,
  puppet: 60,
};

/** What a treaty costs, given the loser's population per province and the declared goal. */
export function treatyCost(t: PeaceTreaty, popShare: (p: number) => number, goal?: WarGoal) {
  const half = (g: WarGoal) => (goal === g ? 0.5 : 1);
  let c = t.provinces.reduce((s, p) => s + PEACE_COST.province(popShare(p)), 0) * half('conquest');
  c += t.reparations * 100 * PEACE_COST.reparationsPerPct * half('reparations');
  if (t.demilitarize) c += PEACE_COST.demilitarize * half('humiliate');
  if (t.regime) c += PEACE_COST.regime * half('regime');
  if (t.puppet) c += PEACE_COST.puppet * half('subjugate');
  return Math.round(c);
}

export function treatyText(t: PeaceTreaty) {
  const parts: string[] = [];
  if (t.provinces.length) parts.push(`${t.provinces.length} province${t.provinces.length > 1 ? 's' : ''}`);
  if (t.reparations > 0) parts.push(`reparations of ${(t.reparations * 100).toFixed(1)}% of GDP a year for ${REPARATION_YEARS} years`);
  if (t.demilitarize) parts.push('a demilitarised border');
  if (t.regime) parts.push(`a new ${t.regime} government`);
  if (t.puppet) parts.push('vassalage');
  return parts.length ? parts.join(', ') : 'peace on these terms';
}
