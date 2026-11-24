// The Threat Stack: three glass layers in 3D at the top of the Espionage window.
// Bottom: your agent networks abroad, each a tile raised by its strength.
// Middle: the operations under way, linked out to the networks they run through.
// Top: the threat at home: foreign agents (red) inside your counter-intelligence shield.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface StackInput {
  nets: [number, number][]; // nation, strength 0..100, strongest first
  building: number[];
  ops: number;
  maxOps: number;
  counter: number; // 0..3
  foreign: number; // 0..100
  name: (id: number) => string;
}

export function threatStackHtml(s: StackInput) {
  const cells = s.nets.slice(0, 12);
  const pos = (i: number): [number, number] => [18 + (i % 4) * 66, 18 + Math.floor(i / 4) * 66];
  const tiles = cells.map(([id, v], i) => {
    const [x, y] = pos(i);
    const h = Math.max(4, v * 0.9);
    return `<div class="ts-tile${s.building.includes(id) ? ' growing' : ''}" style="left:${x}px;top:${y}px" title="${esc(s.name(id))}: network ${Math.round(v)}">
      <i class="ts-foot"></i><b class="ts-top" style="transform:translateZ(${h}px)">${Math.round(v)}</b></div>`;
  }).join('');
  const links = cells.filter(([, v]) => v >= 10).map((_, i) => {
    const [x, y] = pos(i);
    return `<line x1="150" y1="150" x2="${x + 24}" y2="${y + 24}"></line><circle cx="${x + 24}" cy="${y + 24}" r="4"></circle>`;
  }).join('');
  const beacons = Array.from({ length: s.maxOps }, (_, i) => {
    const a = (i / s.maxOps) * Math.PI * 2 - Math.PI / 2;
    const on = i < s.ops;
    return `<circle class="beacon${on ? ' on' : ''}" cx="${(150 + 70 * Math.cos(a)).toFixed(1)}" cy="${(150 + 70 * Math.sin(a)).toFixed(1)}" r="${on ? 9 : 5}"></circle>`;
  }).join('');
  const threat = Math.max(6, s.foreign * 0.9);
  const shields = Array.from({ length: s.counter }, (_, i) => `<circle class="shield" cx="150" cy="150" r="${70 + i * 22}"></circle>`).join('');
  const names = cells.slice(0, 6).map(([id]) => esc(s.name(id))).join(' · ');
  return `<div class="threat-stack" aria-label="Threat stack: ${cells.length} networks abroad, ${s.ops} operations under way, foreign agents at ${s.foreign} of 100 at home">
    <div class="ts-scene"><div class="ts-rig">
      <div class="ts-plane ts-l1" data-ts="nets" title="Networks abroad: open them below">${tiles || '<span class="ts-empty">no networks</span>'}</div>
      <div class="ts-plane ts-l2" data-ts="ops" title="Operations: run them from a network below"><svg viewBox="0 0 300 300" aria-hidden="true">${links}<circle class="hub" cx="150" cy="150" r="8"></circle>${beacons}</svg></div>
      <div class="ts-plane ts-l3" data-ts="home" title="At home: counter-intelligence below"><svg viewBox="0 0 300 300" aria-hidden="true">${shields}
        <circle class="threat" cx="150" cy="150" r="${(threat * 0.45).toFixed(1)}"></circle><circle class="threat-ring" cx="150" cy="150" r="${(threat * 0.75).toFixed(1)}"></circle></svg></div>
    </div></div>
    <ul class="ts-keys">
      <li class="k3" data-ts="home" tabindex="0"><b>L3 · At home</b><span>foreign agents ${s.foreign}/100 · counter-intelligence ${['off', 'low', 'medium', 'high'][s.counter] ?? s.counter}</span></li>
      <li class="k2" data-ts="ops" tabindex="0"><b>L2 · Operations</b><span>${s.ops} of ${s.maxOps} under way</span></li>
      <li class="k1" data-ts="nets" tabindex="0"><b>L1 · Networks abroad</b><span>${cells.length ? names : 'none yet: start one below'}</span></li>
    </ul>
  </div>`;
}
