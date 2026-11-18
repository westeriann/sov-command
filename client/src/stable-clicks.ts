// Windows and markers redraw as the world changes, sometimes between a mouse
// press and its release. Browsers drop a click whose button was replaced in
// between. This makes such clicks go through: if the press and the release land
// on the same control (same kind, same data), even a freshly redrawn one, it is clicked.
const ACTIONABLE = 'button, a, [role="menuitem"], [data-act], [data-f], [data-d], [data-r], [data-k], [data-pick], [data-module], [data-goto], [data-tour], [data-acct], [data-adm], [data-borders], [data-cz], [data-w]';

export function stableClicks(root: Document) {
  let down: { sig: string; at: number; touch: boolean } | null = null;
  let clicked = false;
  const actionable = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(ACTIONABLE) : null);
  const sig = (el: HTMLElement) => `${el.tagName}|${el.id}|${JSON.stringify({ ...el.dataset, confirm: undefined })}|${el.getAttribute('aria-label') ?? ''}`;
  root.addEventListener('pointerdown', (e) => {
    clicked = false;
    if (e.button !== 0) { down = null; return; }
    const el = actionable(e.target);
    down = el ? { sig: sig(el), at: Date.now(), touch: e.pointerType === 'touch' } : null;
  }, true);
  root.addEventListener('click', () => { clicked = true; }, true);
  root.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || e.button !== 0 || Date.now() - d.at > 1500) return;
    const el = actionable(document.elementFromPoint(e.clientX, e.clientY));
    if (!el || sig(el) !== d.sig || (el as HTMLButtonElement).disabled) return;
    // a normal click follows at once (mouse) or shortly (touch); only step in if it did not
    setTimeout(() => { if (!clicked && el.isConnected) el.click(); }, d.touch ? 450 : 0);
  }, true);
}
