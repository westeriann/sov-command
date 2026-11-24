// The legislature drawn as a chamber: every dot a member, coloured by party.
// Its shape follows the form of government:
//   democracy   a hemicycle of elected members
//   technocracy a horseshoe council of experts
//   autocracy   a rubber-stamp assembly in rows facing the leader's podium
//   junta       a round table of officers
import type { Government } from '../../shared/research';

export interface Bloc { name: string; colour: string; seats: number; gov?: boolean } // seats: a share (0..1)

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const CHAMBER: Record<Government, { name: string; seats: number; text: string }> = {
  democracy: { name: 'Parliament', seats: 151, text: 'an elected hemicycle' },
  technocracy: { name: 'Council of experts', seats: 61, text: 'a horseshoe council' },
  autocracy: { name: 'National assembly', seats: 120, text: 'a rubber-stamp assembly facing the leader' },
  junta: { name: 'Military council', seats: 13, text: 'officers round a table' },
};

/** Whole seats per bloc, by largest remainder, in the order given. */
function allocate(blocs: Bloc[], total: number) {
  const sum = blocs.reduce((t, b) => t + b.seats, 0) || 1;
  const raw = blocs.map((b) => (b.seats / sum) * total);
  const seats = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; seats.reduce((t, x) => t + x, 0) < total; k++) seats[order[k % order.length][1]]++;
  return seats;
}

/** Seat positions for each shape, ordered so each party sits together (left to right, or round the table). */
function layout(shape: Government, n: number): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number; k: number }[] = [];
  if (shape === 'democracy' || shape === 'technocracy') {
    // rows of arcs; seats per row in proportion to its length
    const horseshoe = shape === 'technocracy';
    const span = horseshoe ? Math.PI * 1.45 : Math.PI, start = horseshoe ? Math.PI + (Math.PI * 1.45 - Math.PI) / 2 : Math.PI;
    const rows = horseshoe ? 4 : 7, r0 = horseshoe ? 34 : 38, r1 = horseshoe ? 70 : 92, cx = 150, cy = horseshoe ? 86 : 112;
    const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
    const len = radii.reduce((t, r) => t + r, 0);
    const per = radii.map((r) => Math.max(3, Math.round((n * r) / len)));
    while (per.reduce((t, x) => t + x, 0) > n) per[per.indexOf(Math.max(...per))]--;
    while (per.reduce((t, x) => t + x, 0) < n) per[per.length - 1]++;
    const dot = Math.min(4.6, ((r1 - r0) / rows) * 0.42);
    radii.forEach((R, i) => {
      for (let j = 0; j < per[i]; j++) {
        const a = start - (span * j) / Math.max(1, per[i] - 1);
        out.push({ x: cx + R * Math.cos(a), y: cy - R * Math.sin(a), r: dot, k: -a });
      }
    });
  } else if (shape === 'autocracy') {
    // rows facing a podium: fill column by column so parties form blocks
    const cols = 15, rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const c = Math.floor(i / rows), r = i % rows;
      out.push({ x: 52 + c * 14, y: 56 + r * 12, r: 4.2, k: i });
    }
  } else {
    // a round table, with the head of the table (top) left to the leader's star
    const gap = 0.55, span = Math.PI * 2 - gap * 2;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + gap + (span * (i + 0.5)) / n;
      out.push({ x: 150 + 78 * Math.cos(a), y: 82 + 44 * Math.sin(a), r: 7, k: i });
    }
  }
  return out.sort((a, b) => a.k - b.k);
}

/**
 * The chamber as SVG. `blocs` in seating order (left to right); `leader` colours
 * the podium or head of the table.
 */
export function chamberSvg(gov: Government, blocs: Bloc[], leader = '#d9b45a', label = '') {
  const spec = CHAMBER[gov];
  const n = spec.seats;
  const seats = allocate(blocs.length ? blocs : [{ name: '', colour: '#8a8f96', seats: 1 }], n);
  const pos = layout(gov, n);
  let i = 0;
  const dots = seats.flatMap((count, b) => Array.from({ length: count }, () => {
    const k = i, p = pos[i++], bl = blocs[b];
    return `<circle class="seat" data-s="${k}" data-b="${b}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${bl?.colour ?? '#8a8f96'}"${bl?.gov ? '' : ' fill-opacity="0.55"'}><title>${esc(bl?.name ?? '')}</title></circle>`;
  })).join('');
  const furniture = gov === 'democracy'
    ? `<rect x="138" y="114" width="24" height="9" rx="1" fill="${leader}" opacity="0.85"/><path d="M60 128H240" stroke="#4b4234" stroke-width="1.5"/>`
    : gov === 'technocracy'
      ? `<rect x="134" y="80" width="32" height="12" rx="2" fill="#2c3238" stroke="#4b4234"/><circle cx="150" cy="86" r="4" fill="${leader}"/>`
      : gov === 'autocracy'
        ? `<rect x="112" y="14" width="76" height="22" rx="2" fill="#2c3238" stroke="${leader}"/><circle cx="150" cy="25" r="7" fill="${leader}"/><path d="M40 46H260" stroke="#4b4234" stroke-width="1"/>`
        : `<ellipse cx="150" cy="82" rx="58" ry="26" fill="#3a3326" stroke="#6b5a36"/><path class="head" d="M150 24l4.2 8.4 9.3 1.4-6.7 6.5 1.6 9.2-8.4-4.4-8.4 4.4 1.6-9.2-6.7-6.5 9.3-1.4z" fill="${leader}"><title>Head of the council</title></path>`;
  const h = gov === 'autocracy' ? 56 + Math.ceil(n / 15) * 12 + 6 : gov === 'junta' ? 140 : gov === 'technocracy' ? 132 : 132;
  return `<svg class="chamber ${gov}" viewBox="0 0 300 ${h}" role="img" aria-label="${esc(label || `${spec.name}: ${spec.text}`)}">${furniture}${dots}</svg>`;
}

/** The blocs to seat for a government: parties by their position (liberals left), or the regime's own benches. */
export function blocsFor(gov: Government, parties: { name: string; colour: string; seats: number; gov?: boolean; liberty?: number }[] | undefined, colour: string): Bloc[] {
  if ((gov === 'democracy' || gov === 'technocracy') && parties?.length) {
    return [...parties].sort((a, b) => (b.liberty ?? 0) - (a.liberty ?? 0)).map((p) => ({ name: p.name, colour: p.colour, seats: p.seats, gov: p.gov }));
  }
  if (gov === 'junta') return [
    { name: 'Army', colour: '#6b7a3a', seats: 5, gov: true }, { name: 'Navy', colour: '#2f4f7a', seats: 3, gov: true },
    { name: 'Air force', colour: '#7aa6c8', seats: 3, gov: true }, { name: 'Security services', colour: '#5a5a5a', seats: 2, gov: true },
  ];
  if (gov === 'autocracy') return [{ name: 'Ruling party', colour: colour, seats: 0.88, gov: true }, { name: 'Tolerated opposition', colour: '#8a8f96', seats: 0.12 }];
  return [{ name: 'Members', colour: colour, seats: 1, gov: true }];
}

/** A legend: each bloc's colour, name and seats. */
export function chamberLegend(gov: Government, blocs: Bloc[]) {
  const n = CHAMBER[gov].seats, sum = blocs.reduce((t, b) => t + b.seats, 0) || 1;
  return `<div class="chamber-legend">${blocs.map((b) => `<span class="${b.gov ? 'gov' : ''}"><i style="background:${b.colour}"></i>${esc(b.name)} <b class="mono">${Math.round((b.seats / sum) * n)}</b></span>`).join('')}</div>`;
}

// ---- members: a name for every seat, the same each time for the same nation and seat ----
const FIRST = ['Ana', 'Bela', 'Cora', 'Dario', 'Elin', 'Farid', 'Galen', 'Hana', 'Ilya', 'Jonas', 'Kira', 'Leon', 'Mira', 'Nils',
  'Oren', 'Petra', 'Quin', 'Rosa', 'Soren', 'Tamar', 'Ugo', 'Vera', 'Wim', 'Xena', 'Yara', 'Zoran', 'Adil', 'Bruna', 'Cyril', 'Dana',
  'Emre', 'Fiona', 'Goran', 'Ines', 'Jarek', 'Lena', 'Marek', 'Nadia', 'Otto', 'Paula', 'Rafael', 'Selin', 'Tomas', 'Una', 'Viktor'];
const SYL = ['ka', 'ro', 'vel', 'man', 'dri', 'sto', 'len', 'bar', 'ov', 'ic', 'ter', 'sa', 'mir', 'gal', 'den', 'rin', 'tos', 'na',
  'hol', 'ber', 'ski', 'lu', 'var', 'el', 'son', 'ard', 'ez', 'ko', 'mel', 'dor'];

function hash(a: number, b: number) {
  let h = (Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** A member's name for a seat (stable for the same nation and seat). */
export function memberName(nation: number, seat: number) {
  const h = hash(nation, seat), h2 = hash(seat, nation);
  const last = SYL[h % SYL.length] + SYL[(h >>> 8) % SYL.length] + ((h >>> 16) % 3 === 0 ? SYL[(h >>> 20) % SYL.length] : '');
  return `${FIRST[h2 % FIRST.length]} ${last[0].toUpperCase()}${last.slice(1)}`;
}

/** Pick one of a list for a seat, stably (e.g. the area a member sits for). */
export function memberPick<T>(nation: number, seat: number, list: T[]) {
  return list.length ? list[hash(seat * 7 + 3, nation) % list.length] : undefined;
}
