// What building something takes and gives, in words, for the build menus: its
// goods (from your stocks, any shortfall bought abroad), what the province must
// have for a farm, field or mine, and what that one would produce here.
import { BUILDINGS, MIN_RESOURCE, buildGoods, buildingOutput, type BuildingType } from '../../shared/buildings';
import { COMMODITY_INFO, type Commodity } from '../../shared/economy';
import type { Game } from './game';
import type { Province } from './political';

const RES_WORD: Record<string, string> = { farmland: 'good farmland', timber: 'forest', oil: 'oil', gas: 'natural gas', coal: 'coal', ore: 'metal ore', rare_earths: 'rare earths' };
const fmt = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(0) : v.toFixed(1));

export interface BuildInfo {
  /** "1.8 Mt metals, 0.4 Mm³ timber" */
  goods: string;
  /** The extra money spent buying goods you lack, $bn. */
  buy: number;
  /** Set when this province cannot have it: why. */
  blocked?: string;
  /** What it would produce here, a year. */
  output?: string;
}

export function buildInfo(t: BuildingType, p: Province, game: Game): BuildInfo {
  const spec = BUILDINGS[t], goods = buildGoods(t);
  const stock = game.mine?.econ?.goods;
  let buy = 0;
  const parts = (Object.entries(goods) as [Commodity, number][]).map(([c, q]) => {
    const have = stock?.[c]?.stock ?? 0;
    buy += Math.max(0, q - have) * (game.market?.prices[c] ?? COMMODITY_INFO[c].basePrice);
    return `${fmt(q)} ${COMMODITY_INFO[c].unit} ${COMMODITY_INFO[c].name.toLowerCase()}`;
  });
  const info: BuildInfo = { goods: parts.join(', '), buy: Math.round(buy * 100) / 100 };
  if (spec.needs && spec.produces) {
    const score = (p.res as Record<string, number> | undefined)?.[spec.needs] ?? 0;
    if (score < MIN_RESOURCE) info.blocked = `Needs ${RES_WORD[spec.needs]} (this province: ${score} of 100)`;
    else info.output = `+${fmt(buildingOutput(t, score))} ${COMMODITY_INFO[spec.produces].unit} of ${COMMODITY_INFO[spec.produces].name.toLowerCase()} a year`;
  }
  return info;
}

/** Tooltip lines for a building: cost in money and goods, time, and output or what it lacks. */
export function buildTipLines(t: BuildingType, p: Province, game: Game): (string | [string, 'good' | 'bad'])[] {
  const spec = BUILDINGS[t], i = buildInfo(t, p, game);
  return [
    [`Costs $${spec.cost}bn${i.buy > 0 ? `, plus $${i.buy.toFixed(1)}bn of goods bought abroad` : ''}`, 'bad'],
    `Built of ${i.goods} (from your stocks)`,
    `Takes ${spec.days} game days to build`,
    ...(i.output ? [[i.output, 'good'] as [string, 'good']] : []),
    ...(i.blocked ? [[i.blocked, 'bad'] as [string, 'bad']] : []),
  ];
}
