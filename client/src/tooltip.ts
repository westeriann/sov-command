// Hover tooltips: any element with a data-tip attribute shows a small window
// beside the pointer explaining what it does. Tips may use simple markup:
//   <b>Title</b>, then lines; wrap effects in <g>…</g> (good, green) or <r>…</r> (bad, red).
// data-tip holds that markup (the game's own text, never a player's).

let box: HTMLElement | null = null;
let current: HTMLElement | null = null;
let timer = 0;

function render(tip: string) {
  // tiny markup: <g>, <r>, <b>, <br>; everything else is shown as text
  const esc = tip.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/&lt;g&gt;/g, '<span class="tip-good">').replace(/&lt;\/g&gt;/g, '</span>')
    .replace(/&lt;r&gt;/g, '<span class="tip-bad">').replace(/&lt;\/r&gt;/g, '</span>')
    .replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')
    .replace(/&lt;br&gt;/g, '<br>').replace(/\n/g, '<br>');
}

function place(x: number, y: number) {
  if (!box) return;
  const r = box.getBoundingClientRect();
  let left = x + 16, top = y + 18;
  if (left + r.width > innerWidth - 8) left = x - r.width - 12;
  if (top + r.height > innerHeight - 8) top = y - r.height - 12;
  box.style.left = `${Math.max(8, left)}px`;
  box.style.top = `${Math.max(8, top)}px`;
}

function hide() {
  window.clearTimeout(timer);
  current = null;
  if (box) box.hidden = true;
}

export function installTooltips(doc: Document) {
  box = doc.createElement('div');
  box.className = 'tooltip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  doc.body.appendChild(box);
  doc.addEventListener('pointerover', (e) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]');
    if (el === current) return;
    hide();
    if (!el || (e as PointerEvent).pointerType === 'touch') return;
    current = el;
    const { clientX: x, clientY: y } = e as PointerEvent;
    timer = window.setTimeout(() => {
      if (current !== el || !box || !el.isConnected) return;
      box.innerHTML = render(el.dataset.tip ?? '');
      box.hidden = false;
      place(x, y);
    }, 280);
  });
  doc.addEventListener('pointermove', (e) => { if (box && !box.hidden) place(e.clientX, e.clientY); });
  doc.addEventListener('pointerdown', hide, true);
  doc.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
}

/** Build a tip: a title, plain lines, and lines of effects marked good or bad. */
export function tip(title: string, ...lines: (string | [string, 'good' | 'bad'] | null | undefined | false)[]) {
  const out = [`<b>${title}</b>`];
  for (const l of lines) {
    if (!l) continue;
    if (typeof l === 'string') out.push(l);
    else out.push(l[1] === 'good' ? `<g>${l[0]}</g>` : `<r>${l[0]}</r>`);
  }
  return out.join('\n');
}

/** Split an effect text such as "+8% land attack, −0.2% growth" into good and bad parts. */
export function effectLines(text: string): [string, 'good' | 'bad'][] {
  return text.split(/,\s*|;\s*/).filter(Boolean).map((part) => {
    const bad = /(^|\s)[−-]\d|slower|loses?|lost|costs?|risk|burns|needs|fewer|less /i.test(part) && !/faster|more|\+/.test(part.replace(/[−-]\d.*/, ''));
    return [part.trim(), bad ? 'bad' : 'good'];
  });
}

/** Escape a string for use inside a data-tip attribute value. */
export const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
