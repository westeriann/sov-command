// Two-step buttons ("Refuse" → "Confirm: refuse") arm themselves by setting
// data-confirm="1" and new text. Windows redraw every game day, which used to
// throw that state away before the player could click again. This keeps any armed
// button armed across redraws (matched by its data attributes) for a few seconds,
// until it is clicked or the time runs out.
const KEEP_MS = 8000;

export function installConfirmKeeper(root: HTMLElement) {
  const armed = new Map<string, { text: string; until: number }>();
  const sig = (el: Element) => el.tagName + [...el.attributes]
    .filter((a) => a.name.startsWith('data-') && a.name !== 'data-confirm' && a.name !== 'data-tip')
    .map((a) => `${a.name}=${a.value}`).sort().join('|');
  let applying = false;
  const reapply = () => {
    if (!armed.size || applying) return;
    applying = true;
    const now = Date.now();
    for (const [k, v] of armed) if (v.until < now) armed.delete(k);
    for (const el of root.querySelectorAll<HTMLElement>('button, a')) {
      if (el.dataset.confirm === '1' || !el.attributes.length) continue;
      const a = armed.get(sig(el));
      if (a) { el.dataset.confirm = '1'; el.textContent = a.text; }
    }
    applying = false;
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes' && m.attributeName === 'data-confirm') {
        const el = m.target as HTMLElement;
        // the button armed itself: remember it (its text is set in the same task)
        if (el.dataset.confirm === '1' && !applying) queueMicrotask(() => armed.set(sig(el), { text: el.textContent ?? '', until: Date.now() + KEEP_MS }));
        else if (el.dataset.confirm !== '1') armed.delete(sig(el));
      }
    }
    if (list.some((m) => m.type === 'childList')) reapply();
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-confirm'] });
  // the second click carries the action out: forget the button
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-confirm="1"]');
    if (el) armed.delete(sig(el));
  }, true);
}
