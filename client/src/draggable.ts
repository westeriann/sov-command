// Every other window moves too: drag its title bar. (Ordinary windows move and
// resize in resizable.ts; this covers the full screens, branch windows, the
// manual, nation and unit cards and dialogs.) Each is shifted with the CSS
// `translate` property, so their own layout and transforms stay as they are;
// the shift is remembered per window, and a double-click on the title bar
// puts it back.
const KEY = 'sov.window-shift';
const HANDLES = '.econ-head, .nc-head, .uc-head';
const SKIP = '.econ-window:not(.screen)'; // resizable.ts moves these
const INTERACTIVE = 'button, a, input, select, textarea, label, [role=tab], summary';

export function installDraggable(root: HTMLElement) {
  let saved: Record<string, [number, number]> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* storage blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage blocked */ } };
  const keyOf = (el: HTMLElement) => el.getAttribute('aria-label') ?? [...el.classList].filter((c) => c !== 'panel' && c !== 'screen').join('.');
  const windowOf = (t: HTMLElement) => {
    const head = t.closest<HTMLElement>(HANDLES);
    const el = head?.closest<HTMLElement>('.panel');
    return el && !el.matches(SKIP) ? el : null;
  };
  const place = (el: HTMLElement, [x, y]: [number, number]) => { el.style.translate = x || y ? `${x}px ${y}px` : ''; };
  const restore = (el: HTMLElement) => { const s = saved[keyOf(el)]; if (s && window.innerWidth >= 760) place(el, s); };
  for (const el of root.querySelectorAll<HTMLElement>('.panel')) restore(el);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('panel')) restore(n);
  }).observe(root, { childList: true, subtree: true });

  let drag: { el: HTMLElement; x: number; y: number; from: [number, number]; rect: DOMRect } | null = null;
  root.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || window.innerWidth < 760 || t.closest(INTERACTIVE)) return;
    const el = windowOf(t);
    if (!el) return;
    e.preventDefault();
    drag = { el, x: e.clientX, y: e.clientY, from: saved[keyOf(el)] ?? [0, 0], rect: el.getBoundingClientRect() };
    document.body.classList.add('moving-window');
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { el, from, rect } = drag;
    // keep the title bar reachable: at least 120px across and the top edge on screen
    const dx = Math.min(window.innerWidth - 120 - rect.left, Math.max(120 - rect.right, e.clientX - drag.x));
    const dy = Math.min(window.innerHeight - 48 - rect.top, Math.max(-rect.top, e.clientY - drag.y));
    const at: [number, number] = [from[0] + dx, from[1] + dy];
    place(el, at);
    saved[keyOf(el)] = at;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('moving-window');
    save();
  });
  root.addEventListener('dblclick', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(INTERACTIVE)) return;
    const el = windowOf(t);
    if (!el) return;
    delete saved[keyOf(el)];
    save();
    place(el, [0, 0]);
  });
}
