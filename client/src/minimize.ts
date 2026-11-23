// Ctrl-click (Cmd-click on a Mac) anything in the top bar to shrink it to a
// small tab and free up space; click the tab (or Ctrl-click it) to bring it back.
// What is shrunk is remembered between sessions.
const KEY = 'sov.minimized';
/** The pieces of the top bar that can be shrunk, each on its own. */
const ITEMS = '.top .brand, .top .resources > div, .top .alert-icons, .top .clock > *';

export function installMinimize(root: HTMLElement) {
  let mini = new Set<string>();
  try { mini = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { /* storage blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...mini])); } catch { /* storage blocked */ } };
  const items = () => [...root.querySelectorAll<HTMLElement>(ITEMS)];
  // a stable name for each piece: its id, its action, the figure it shows, or its class
  const keyOf = (el: HTMLElement) => el.id || el.dataset.act || el.querySelector('[id]')?.id || el.classList[0] || '';
  const apply = () => {
    for (const el of items()) {
      const on = mini.has(keyOf(el));
      if (el.classList.contains('mini') === on) continue;
      el.classList.toggle('mini', on);
      if (on) { el.dataset.miniTitle = el.title; el.title = 'Shrunk: click to restore'; }
      else { el.title = el.dataset.miniTitle ?? ''; delete el.dataset.miniTitle; }
    }
  };
  root.addEventListener('click', (e) => {
    const el = items().find((x) => x.contains(e.target as Node));
    if (!el) return;
    const shrunk = el.classList.contains('mini');
    if (!(e.ctrlKey || e.metaKey) && !shrunk) return;
    // Ctrl-click shrinks or restores; a plain click on a shrunk tab restores it
    e.preventDefault();
    e.stopImmediatePropagation();
    const k = keyOf(el);
    if (shrunk) mini.delete(k); else mini.add(k);
    save();
    apply();
  }, true);
  // the top bar is redrawn now and then (alerts, the player's name): keep shrunk pieces shrunk
  new MutationObserver(apply).observe(root.querySelector('.top') ?? root, { childList: true, subtree: true });
  apply();
}
