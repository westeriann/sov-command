// Every window can be resized by dragging its edges or corners. Sizes are
// remembered per window; double-click a window's title bar to reset it.
const KEY = 'sov.windows';
const EDGE = 7; // px from the border that counts as an edge
const MIN_W = 360, MIN_H = 220;
const WINDOWS = '.econ-window:not(.screen)';

type Insets = { left: number; right: number; top: number; bottom: number };

export function installResizable(root: HTMLElement) {
  let saved: Record<string, Insets> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* storage blocked */ }
  const keyOf = (el: HTMLElement) => el.getAttribute('aria-label') ?? el.className;
  const apply = (el: HTMLElement) => {
    const s = saved[keyOf(el)];
    if (!s || window.innerWidth < 760 || el.classList.contains('screen')) return; // phones and screens fill their space
    el.style.left = `${s.left}px`; el.style.right = `${s.right}px`; el.style.top = `${s.top}px`; el.style.bottom = `${s.bottom}px`;
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage blocked */ } };
  const all = () => [...root.querySelectorAll<HTMLElement>(WINDOWS)];
  for (const el of all()) apply(el);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.matches(WINDOWS)) apply(n);
  }).observe(root, { childList: true });

  /** Which edges of the window the pointer is on ('' when none). */
  const edgeAt = (el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    if (x < r.left - 2 || x > r.right + 2 || y < r.top - 2 || y > r.bottom + 2) return '';
    return (y - r.top < EDGE ? 'n' : r.bottom - y < EDGE ? 's' : '') + (x - r.left < EDGE ? 'w' : r.right - x < EDGE ? 'e' : '');
  };
  const CURSOR: Record<string, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

  let drag: { el: HTMLElement; edge: string; start: DOMRect; x: number; y: number } | null = null;
  root.addEventListener('pointermove', (e) => {
    if (drag) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(WINDOWS);
    if (!el) return;
    const edge = edgeAt(el, e.clientX, e.clientY);
    el.style.cursor = edge ? CURSOR[edge] : '';
  });
  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(WINDOWS);
    if (!el || e.button !== 0 || window.innerWidth < 760) return;
    const edge = edgeAt(el, e.clientX, e.clientY);
    if (!edge) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { el, edge, start: el.getBoundingClientRect(), x: e.clientX, y: e.clientY };
    document.body.classList.add('resizing');
    el.setPointerCapture(e.pointerId);
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { el, edge, start } = drag;
    const W = window.innerWidth, H = window.innerHeight;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    let { left, right, top, bottom } = start;
    if (edge.includes('w')) left = Math.min(right - MIN_W, Math.max(0, left + dx));
    if (edge.includes('e')) right = Math.max(left + MIN_W, Math.min(W, right + dx));
    if (edge.includes('n')) top = Math.min(bottom - MIN_H, Math.max(0, top + dy));
    if (edge.includes('s')) bottom = Math.max(top + MIN_H, Math.min(H, bottom + dy));
    el.style.left = `${left}px`; el.style.right = `${W - right}px`; el.style.top = `${top}px`; el.style.bottom = `${H - bottom}px`;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const r = drag.el.getBoundingClientRect();
    saved[keyOf(drag.el)] = { left: r.left, right: window.innerWidth - r.right, top: r.top, bottom: window.innerHeight - r.bottom };
    save();
    document.body.classList.remove('resizing');
    drag = null;
  });
  // double-click the title bar: back to the standard size
  root.addEventListener('dblclick', (e) => {
    const head = (e.target as HTMLElement).closest<HTMLElement>('.econ-head');
    const el = head?.closest<HTMLElement>(WINDOWS);
    if (!el || (e.target as HTMLElement).closest('button, a, input, select')) return;
    delete saved[keyOf(el)];
    save();
    el.style.left = el.style.right = el.style.top = el.style.bottom = '';
  });
}
