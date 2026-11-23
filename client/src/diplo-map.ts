// The diplomatic map mode: every nation coloured by how it stands with you.
// Each nation takes the first relationship (in this order) that applies and is
// switched on in the filter; with "others by opinion" on, the rest shade from
// red (hostile) through grey to green (friendly).
import type { Game } from './game';
import type { Political } from './political';

export type DiploCat = 'self' | 'war' | 'truce' | 'vassal' | 'alliance' | 'guarantee' | 'trade' | 'nap' | 'access' | 'research' | 'contract' | 'embargo' | 'claim' | 'opinion';
export const DIPLO_CATS: [DiploCat, string, string][] = [
  ['self', 'Your nation', '#e6c65a'],
  ['war', 'At war with you', '#d8443a'],
  ['truce', 'Truce', '#e89a3a'],
  ['vassal', 'Vassal or overlord', '#9a6ad6'],
  ['alliance', 'Allies and bloc', '#3a7ad8'],
  ['guarantee', 'Guarantees', '#5ac0e0'],
  ['trade', 'Trade agreement', '#4caf50'],
  ['nap', 'Non-aggression pact', '#9ccc65'],
  ['access', 'Military access', '#80cbc4'],
  ['research', 'Research cooperation', '#b39ddb'],
  ['contract', 'Supply contract', '#d4e157'],
  ['embargo', 'Embargo', '#8d6e63'],
  ['claim', 'You claim them', '#ff8a65'],
  ['opinion', 'Others, by their opinion of you', 'linear-gradient(90deg, #b8433a, #6a6e73, #4f9a52)'],
];

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Each nation's colour, given which relationships are shown. */
export function diploColours(game: Game, pol: Political, shown: Set<DiploCat>) {
  const out = new Map<number, [number, number, number]>();
  const mine = game.mine;
  if (!mine) return out;
  const me = mine.id, w = game.war;
  const pact = (k: string, id: number) => w.treaties.some((t) => t.kind === k && ((t.a === me && t.b === id) || (t.a === id && t.b === me)));
  const colour = Object.fromEntries(DIPLO_CATS.map(([k, , c]) => [k, c])) as Record<DiploCat, string>;
  for (const n of pol.nations.values()) {
    const id = n.id;
    if (game.nations.get(id)?.annexedBy) continue;
    const bloc = w.blocs.find((b) => b.members.includes(me));
    const tests: [DiploCat, boolean][] = [
      ['self', id === me],
      ['war', game.atWar(me, id) && !game.truce(me, id)],
      ['truce', !!game.truce(me, id)],
      ['vassal', w.vassals[id] === me || w.vassals[me] === id],
      ['alliance', pact('alliance', id) || !!bloc?.members.includes(id)],
      ['guarantee', pact('guarantee', id)],
      ['trade', pact('trade', id)],
      ['nap', pact('nap', id)],
      ['access', pact('access', id)],
      ['research', pact('research', id)],
      ['contract', (mine.contracts ?? []).some((c) => c.seller === id || c.buyer === id)],
      ['embargo', w.embargoes.some((e) => (e.from === me && e.to === id) || (e.from === id && e.to === me))],
      ['claim', !!mine.politics?.claims.includes(id)],
    ];
    const hit = tests.find(([k, yes]) => yes && shown.has(k));
    if (hit) { out.set(id, rgb(colour[hit[0]])); continue; }
    if (shown.has('opinion')) {
      const o = (mine.relations?.[id]?.total ?? 0) / 100; // -1..1
      const a = rgb('#6a6e73'), b = rgb(o < 0 ? '#b8433a' : '#4f9a52'), f = Math.min(1, Math.abs(o) * 1.6);
      out.set(id, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    }
  }
  return out;
}
