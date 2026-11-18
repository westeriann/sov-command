// Your nation's name, map colour and flag: how other players will know you.
import {
  EMBLEM_NAMES, FLAG_EMBLEMS, FLAG_PATTERNS, PATTERN_NAMES, defaultFlag, flagSvg, type FlagEmblem, type FlagPattern, type FlagSpec,
} from '../../shared/flags';
import type { Order } from '../../shared/protocol';
import { ACHIEVEMENTS } from '../../shared/goals';
import { EARNED_EMBLEMS } from '../../shared/flags';
import type { Nation } from './political';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const flagOf = (n: Nation) => n.flag ?? defaultFlag(n.id, n.color);

export class CustomizeDialog {
  private el: HTMLElement;
  private nation: Nation | null = null;

  constructor(root: HTMLElement, private send: (o: Order) => void) {
    this.el = document.createElement('div');
    this.el.className = 'login-backdrop';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('input', () => this.preview());
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-cz="close"]')) this.close(); });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = this.nation!;
      const v = this.values();
      const order: Order = { kind: 'customize', color: v.color, flag: v.flag };
      if (v.name !== n.name || v.short !== n.short) Object.assign(order, { name: v.name, short: v.short });
      this.send(order);
      this.close();
    });
  }

  close() { this.el.hidden = true; }

  private values() {
    const q = (id: string) => (this.el.querySelector(`#${id}`) as HTMLInputElement).value;
    const flag: FlagSpec = { pattern: q('czPattern') as FlagPattern, emblem: q('czEmblem') as FlagEmblem, colors: [q('czC1'), q('czC2'), q('czC3')] };
    return { name: q('czName').trim(), short: q('czShort').trim(), color: q('czColor'), flag };
  }

  private preview() {
    const box = this.el.querySelector('#czPreview');
    if (box) box.innerHTML = flagSvg(this.values().flag, 150);
  }

  open(n: Nation, achievements: string[] = []) {
    const earned = new Set(Object.entries(ACHIEVEMENTS).filter(([k]) => achievements.includes(k)).map(([, a]) => a.emblem));
    this.nation = n;
    const f = flagOf(n);
    this.el.hidden = false;
    this.el.innerHTML = `<form class="panel login customize" novalidate>
      <div class="title">YOUR NATION</div>
      <p class="muted">How other leaders will know you on the map, in diplomacy and in the rankings. A new name is announced to the world; you can rename once a day.</p>
      <div class="cz-grid">
        <div>
          <label for="czName">Name</label><input id="czName" maxlength="40" value="${esc(n.name)}">
          <label for="czShort">Short name (map label)</label><input id="czShort" maxlength="16" value="${esc(n.short)}">
          <label for="czColor">Map colour</label><input id="czColor" type="color" value="${n.color}">
          <label for="czPattern">Flag pattern</label>
          <select id="czPattern">${FLAG_PATTERNS.map((p) => `<option value="${p}"${p === f.pattern ? ' selected' : ''}>${PATTERN_NAMES[p]}</option>`).join('')}</select>
          <label for="czEmblem">Emblem</label>
          <select id="czEmblem">${FLAG_EMBLEMS.filter((e) => !EARNED_EMBLEMS.includes(e) || earned.has(e)).map((e) => `<option value="${e}"${e === f.emblem ? ' selected' : ''}>${EMBLEM_NAMES[e]}</option>`).join('')}</select>
          <div class="cz-colors"><label>Flag colours</label>
            <input id="czC1" type="color" value="${f.colors[0]}" aria-label="Field colour">
            <input id="czC2" type="color" value="${f.colors[1]}" aria-label="Second colour">
            <input id="czC3" type="color" value="${f.colors[2]}" aria-label="Emblem colour"></div>
        </div>
        <div id="czPreview" class="cz-preview" aria-live="polite"></div>
      </div>
      <div class="login-actions"><button type="submit" class="primary">Save</button><button type="button" data-cz="close">Cancel</button></div>
    </form>`;
    this.preview();
    (this.el.querySelector('#czName') as HTMLInputElement).focus();
  }
}
