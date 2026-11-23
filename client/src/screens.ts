// Full screens for the left-hand tabs, in the Orbital layout: the window's
// headline figures on a glass wing to the left, a working centrepiece standing
// on a projector in the middle, and the window's own controls on a wing to the
// right. The panels keep drawing their HTML as before; each time one redraws,
// its figures and body are moved into the wings and the centrepiece (which
// lives on between redraws) is told to update.

export interface Piece {
  el: HTMLElement;
  /** The window just redrew: refresh from the game (and read the window if needed). */
  update(win: HTMLElement): void;
  caption?: string;
}

/** Click the window's own control that a centrepiece stands in for (or show it if it can't be used). */
export function proxy(win: HTMLElement, selector: string) {
  const el = win.querySelector<HTMLElement>(selector);
  if (!el) return false;
  if ((el as HTMLButtonElement).disabled) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.closest<HTMLElement>('.recruit, .tech, .war-row, .spy-row, .law-row, section')?.classList.add('glow');
    window.setTimeout(() => document.querySelectorAll('.glow').forEach((g) => g.classList.remove('glow')), 2600);
    return false;
  }
  el.click();
  return true;
}

/** Bring a part of the right-hand wing into view and make it glow. */
export function reveal(win: HTMLElement, selector: string) {
  const el = win.querySelector<HTMLElement>(selector);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.classList.add('glow');
  window.setTimeout(() => el.classList.remove('glow'), 2600);
}

export function installScreens(root: HTMLElement, defs: { sel: string; make: () => Piece }[]) {
  const wired = new WeakSet<HTMLElement>();
  const stages = new WeakMap<HTMLElement, { stage: HTMLElement; piece: Piece }>();

  const syncOpen = () => {
    const open = [...root.querySelectorAll<HTMLElement>('.econ-window.screen')].some((w) => !w.hidden);
    document.body.classList.toggle('screen-open', open);
  };

  const restructure = (win: HTMLElement) => {
    if (win.querySelector(':scope > .scr-grid')) return;
    const kids = [...win.children] as HTMLElement[];
    const head = kids.find((k) => k.classList.contains('econ-head'));
    const body = kids.find((k) => k.classList.contains('econ-body'));
    if (!body) return;
    const st = stages.get(win)!;
    const scroll = body.scrollTop;
    const grid = document.createElement('div');
    grid.className = 'scr-grid';
    const left = document.createElement('div');
    left.className = 'scr-wing scr-left';
    const right = document.createElement('div');
    right.className = 'scr-wing scr-right';
    const kpis = body.querySelector<HTMLElement>(':scope > .econ-kpis');
    if (kpis) left.append(kpis); else grid.classList.add('no-left');
    for (const k of kids) if (k !== head) right.append(k);
    grid.append(left, st.stage, right);
    win.append(grid);
    body.scrollTop = scroll;
    try { st.piece.update(win); } catch (e) { console.error('screen centrepiece', e); }
  };

  const wire = (win: HTMLElement, make: () => Piece) => {
    if (wired.has(win)) return;
    wired.add(win);
    win.classList.add('screen');
    const piece = make();
    const stage = document.createElement('div');
    stage.className = 'scr-stage';
    const holder = document.createElement('div');
    holder.className = 'scr-piece';
    holder.append(piece.el);
    stage.append(holder, Object.assign(document.createElement('i'), { className: 'scr-base' }));
    if (piece.caption) stage.append(Object.assign(document.createElement('p'), { className: 'scr-caption', textContent: piece.caption }));
    stages.set(win, { stage, piece });
    new MutationObserver((list) => {
      if (list.some((m) => m.type === 'attributes')) syncOpen();
      if (list.some((m) => m.type === 'childList')) restructure(win);
    }).observe(win, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    restructure(win);
    syncOpen();
  };

  const scan = () => {
    for (const d of defs) {
      const win = root.querySelector<HTMLElement>(d.sel);
      if (win) wire(win, d.make);
    }
  };
  scan();
  new MutationObserver(scan).observe(root, { childList: true });
}
