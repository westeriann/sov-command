// Click a column heading to sort a table by it: high to low, then low to high,
// then back to the order it came in. Windows redraw their tables as the world
// changes, so the choice is remembered (per window and column) and put back
// after each redraw. Tables that sort themselves (their headings hold buttons)
// are left alone.

type Dir = 'desc' | 'asc';
const state = new Map<string, { col: number; dir: Dir }>();

const keyOf = (table: HTMLTableElement) =>
  `${table.closest<HTMLElement>('[aria-label]')?.getAttribute('aria-label') ?? ''}|${table.className}|${[...table.tHead?.rows[0]?.cells ?? []].map((c) => c.textContent?.trim()).join('/')}`;

/** A cell's value for sorting: its data-sort number, else the number in its text (with $, %, k, M, bn, T and signs read), else its text. */
function valueOf(cell: Element | undefined): number | string {
  const given = (cell as HTMLElement | undefined)?.dataset?.sort;
  if (given !== undefined && Number.isFinite(Number(given))) return Number(given);
  const t = (cell?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // a scale word only as a whole word: "Mt" is megatonnes, not millions
  const m = /([−+-]?)\s*\$?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*(k|K|M|bn|B|T|tn)(?![A-Za-z³]))?/.exec(t);
  if (!m) return t.toLowerCase();
  // a leading word (a name) makes it a text column
  if (/^[A-Za-z]/.test(t) && m.index > 0) return t.toLowerCase();
  let v = Number(m[2].replace(/,/g, ''));
  const unit = m[3];
  if (unit === 'k' || unit === 'K') v *= 1e3;
  else if (unit === 'M') v *= 1e6;
  else if (unit === 'bn' || unit === 'B') v *= 1e9;
  else if (unit === 'T' || unit === 'tn') v *= 1e12;
  return m[1] === '−' || m[1] === '-' ? -v : v;
}

function sortable(table: HTMLTableElement) {
  return !!table.tHead && !!table.tBodies[0] && !table.tHead.querySelector('button, [data-rc]');
}

function apply(table: HTMLTableElement) {
  if (!sortable(table)) return;
  const st = state.get(keyOf(table));
  const body = table.tBodies[0];
  const rows = [...body.rows];
  // remember the order the window drew them in
  rows.forEach((r, i) => { if (r.dataset.orig === undefined) r.dataset.orig = String(i); });
  const heads = [...table.tHead!.rows[0].cells];
  heads.forEach((h, i) => {
    h.classList.toggle('sort-desc', !!st && st.col === i && st.dir === 'desc');
    h.classList.toggle('sort-asc', !!st && st.col === i && st.dir === 'asc');
    h.classList.add('sortable-head');
  });
  const sorted = rows.slice().sort((a, b) => {
    if (!st) return Number(a.dataset.orig) - Number(b.dataset.orig);
    const x = valueOf(a.cells[st.col]), y = valueOf(b.cells[st.col]);
    let c: number;
    if (typeof x === 'number' && typeof y === 'number') c = x - y;
    else c = String(x).localeCompare(String(y));
    if (c === 0) return Number(a.dataset.orig) - Number(b.dataset.orig);
    return st.dir === 'desc' ? -c : c;
  });
  if (sorted.every((r, i) => r === rows[i])) return;
  body.append(...sorted);
}

/** Sort tables on heading clicks, and keep each table's sort through redraws. */
export function installTableSort(root: HTMLElement) {
  root.addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest<HTMLTableCellElement>('thead th');
    const table = th?.closest('table');
    if (!th || !table || !sortable(table)) return;
    const key = keyOf(table), col = th.cellIndex, cur = state.get(key);
    // high to low, then low to high, then as it was
    if (!cur || cur.col !== col) state.set(key, { col, dir: 'desc' });
    else if (cur.dir === 'desc') state.set(key, { col, dir: 'asc' });
    else state.delete(key);
    apply(table);
  });
  let queued = false;
  new MutationObserver(() => {
    if (queued || !state.size) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const t of root.querySelectorAll<HTMLTableElement>('table')) if (state.has(keyOf(t))) apply(t);
    });
  }).observe(root, { childList: true, subtree: true });
}
