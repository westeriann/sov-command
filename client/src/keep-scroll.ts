// Windows redraw their contents as the world changes. Replacing the HTML replaces
// the scrolling areas inside them too, which jumps them back to the top while you
// read. Wrap such redraws in keepScroll: each scrolled area is found again in the
// new content (by its class and position) and put back where it was.
const SCROLLERS = '.econ-body, .table-wrap, .tech-grid, .gov-grid, .comms-list, [data-keep-scroll]';

export function keepScroll(root: HTMLElement, redraw: () => void) {
  const key = (els: Element[], el: Element) => `${el.className}|${els.filter((e) => e.className === el.className).indexOf(el)}`;
  const before = [...root.querySelectorAll(SCROLLERS)];
  const saved = new Map<string, [number, number]>();
  for (const el of before) if (el.scrollTop || el.scrollLeft) saved.set(key(before, el), [el.scrollTop, el.scrollLeft]);
  const rootAt: [number, number] = [root.scrollTop, root.scrollLeft];
  redraw();
  root.scrollTop = rootAt[0]; root.scrollLeft = rootAt[1];
  if (!saved.size) return;
  const after = [...root.querySelectorAll(SCROLLERS)];
  for (const el of after) {
    const at = saved.get(key(after, el));
    if (at) { el.scrollTop = at[0]; el.scrollLeft = at[1]; }
  }
}

/** Make every innerHTML redraw of this element keep its scroll positions. */
export function keepScrollOn(el: HTMLElement) {
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { return desc.get!.call(el); },
    set(html: string) { keepScroll(el, () => desc.set!.call(el, html)); },
  });
}
