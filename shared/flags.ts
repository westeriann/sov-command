// National flags: a pattern, three colours and an emblem. Every nation has one
// (generated from its id and map colour) and players can design their own.

export type FlagPattern = 'solid' | 'bicolor_h' | 'bicolor_v' | 'tricolor_h' | 'tricolor_v' | 'cross' | 'nordic' | 'diagonal' | 'canton' | 'border';
export type FlagEmblem = 'none' | 'star' | 'circle' | 'crescent' | 'diamond' | 'sun' | 'stars3';
export const FLAG_PATTERNS: FlagPattern[] = ['solid', 'bicolor_h', 'bicolor_v', 'tricolor_h', 'tricolor_v', 'cross', 'nordic', 'diagonal', 'canton', 'border'];
export const FLAG_EMBLEMS: FlagEmblem[] = ['none', 'star', 'circle', 'crescent', 'diamond', 'sun', 'stars3'];
export const PATTERN_NAMES: Record<FlagPattern, string> = {
  solid: 'Plain', bicolor_h: 'Two bands', bicolor_v: 'Two stripes', tricolor_h: 'Three bands', tricolor_v: 'Three stripes',
  cross: 'Cross', nordic: 'Nordic cross', diagonal: 'Diagonal', canton: 'Canton', border: 'Border',
};
export const EMBLEM_NAMES: Record<FlagEmblem, string> = {
  none: 'No emblem', star: 'Star', circle: 'Disc', crescent: 'Crescent', diamond: 'Diamond', sun: 'Sun', stars3: 'Three stars',
};

export interface FlagSpec {
  pattern: FlagPattern;
  colors: [string, string, string]; // field, second, emblem
  emblem: FlagEmblem;
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isColor = (c: unknown): c is string => typeof c === 'string' && HEX.test(c);

/** Accept only well-formed flags (they are drawn into other players' pages). */
export function cleanFlag(f: unknown): FlagSpec | null {
  const x = f as FlagSpec;
  if (!x || typeof x !== 'object' || !FLAG_PATTERNS.includes(x.pattern) || !FLAG_EMBLEMS.includes(x.emblem)) return null;
  if (!Array.isArray(x.colors) || x.colors.length !== 3 || !x.colors.every(isColor)) return null;
  return { pattern: x.pattern, colors: [x.colors[0], x.colors[1], x.colors[2]], emblem: x.emblem };
}

const PALETTE = ['#b22234', '#ffffff', '#002868', '#009246', '#ce2b37', '#f4c430', '#000000', '#0055a4', '#ef7f1a', '#5b2a86', '#1e7b4f', '#d52b1e'];

/** A stable default flag for nations nobody has designed one for. */
export function defaultFlag(id: number, color: string): FlagSpec {
  let a = (id * 2654435761) >>> 0;
  const r = () => { a = (a ^ (a << 13)) >>> 0; a = (a ^ (a >>> 17)) >>> 0; a = (a ^ (a << 5)) >>> 0; return a / 4294967296; };
  const pick = () => PALETTE[Math.floor(r() * PALETTE.length)];
  let second = pick();
  if (second.toLowerCase() === color.toLowerCase()) second = '#ffffff';
  const pattern = FLAG_PATTERNS[1 + Math.floor(r() * (FLAG_PATTERNS.length - 1))];
  const emblem = r() < 0.45 ? FLAG_EMBLEMS[1 + Math.floor(r() * (FLAG_EMBLEMS.length - 1))] : 'none';
  return { pattern, colors: [isColor(color) ? color : '#556677', second, pick() === second ? '#ffffff' : pick()], emblem };
}

function emblemSvg(e: FlagEmblem, cx: number, cy: number, s: number, c: string) {
  const star = (x: number, y: number, r: number) => {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
      return `${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`;
    });
    return `<polygon points="${pts.join(' ')}" fill="${c}"/>`;
  };
  switch (e) {
    case 'star': return star(cx, cy, s);
    case 'circle': return `<circle cx="${cx}" cy="${cy}" r="${s * 0.75}" fill="${c}"/>`;
    case 'crescent': return `<circle cx="${cx}" cy="${cy}" r="${s * 0.8}" fill="${c}"/><circle cx="${cx + s * 0.32}" cy="${cy - s * 0.1}" r="${s * 0.68}" fill="var(--flag-bg, #000)" data-cut/>`;
    case 'diamond': return `<polygon points="${cx},${cy - s} ${cx + s * 0.7},${cy} ${cx},${cy + s} ${cx - s * 0.7},${cy}" fill="${c}"/>`;
    case 'sun': return `<circle cx="${cx}" cy="${cy}" r="${s * 0.45}" fill="${c}"/>${Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return `<line x1="${cx + Math.cos(a) * s * 0.6}" y1="${cy + Math.sin(a) * s * 0.6}" x2="${cx + Math.cos(a) * s}" y2="${cy + Math.sin(a) * s}" stroke="${c}" stroke-width="${s * 0.16}"/>`;
    }).join('')}`;
    case 'stars3': return star(cx - s * 1.1, cy, s * 0.5) + star(cx, cy, s * 0.5) + star(cx + s * 1.1, cy, s * 0.5);
    default: return '';
  }
}

/** The flag as an SVG string, 3:2. */
export function flagSvg(f: FlagSpec, width = 24, label = ''): string {
  const W = 30, H = 20, [a, b, c] = f.colors;
  let body = `<rect width="${W}" height="${H}" fill="${a}"/>`;
  let ex = W / 2, ey = H / 2, es = 5, bg = a;
  switch (f.pattern) {
    case 'bicolor_h': body += `<rect y="${H / 2}" width="${W}" height="${H / 2}" fill="${b}"/>`; break;
    case 'bicolor_v': body += `<rect x="${W / 2}" width="${W / 2}" height="${H}" fill="${b}"/>`; break;
    case 'tricolor_h': body += `<rect y="${H / 3}" width="${W}" height="${H / 3}" fill="${b}"/><rect y="${(2 * H) / 3}" width="${W}" height="${H / 3}" fill="${a}"/>`; bg = b; es = 3.6; break;
    case 'tricolor_v': body += `<rect x="${W / 3}" width="${W / 3}" height="${H}" fill="${b}"/>`; bg = b; es = 4; break;
    case 'cross': body += `<rect x="${W / 2 - 2.5}" width="5" height="${H}" fill="${b}"/><rect y="${H / 2 - 2.5}" width="${W}" height="5" fill="${b}"/>`; es = 0; break;
    case 'nordic': body += `<rect x="9" width="4" height="${H}" fill="${b}"/><rect y="${H / 2 - 2}" width="${W}" height="4" fill="${b}"/>`; es = 0; break;
    case 'diagonal': body += `<polygon points="0,${H} ${W},0 ${W},${H}" fill="${b}"/>`; ex = 8; ey = 7; es = 4; break;
    case 'canton': body += `<rect width="${W * 0.45}" height="${H / 2}" fill="${b}"/>`; ex = W * 0.225; ey = H / 4; es = 3.2; bg = b; break;
    case 'border': body += `<rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="${b}"/>`; bg = b; break;
  }
  if (f.emblem !== 'none' && es > 0) body += emblemSvg(f.emblem, ex, ey, es, c).replace('var(--flag-bg, #000)', bg);
  return `<svg class="flag" viewBox="0 0 ${W} ${H}" width="${width}" height="${(width * 2) / 3}" role="img" aria-label="${label ? `Flag of ${label.replace(/"/g, '')}` : 'Flag'}">${body}</svg>`;
}
