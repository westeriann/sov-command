// The world lobby: every world runs on its own server. The list comes from the
// VITE_WORLDS build setting (JSON: [{"name": "...", "url": "https://..."}]),
// and always includes the world this page belongs to.

interface WorldEntry { name: string; url: string }
interface WorldStatus { name?: string; players?: number; online?: number; nations?: number; season?: { number: number; endsAt: number }; day?: number }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function worlds(): WorldEntry[] {
  let list: WorldEntry[] = [];
  try { list = JSON.parse(import.meta.env.VITE_WORLDS ?? '[]'); } catch { /* bad setting: just this world */ }
  if (!list.some((w) => w.url.replace(/\/$/, '') === location.origin)) list.unshift({ name: 'This world', url: location.origin });
  return list;
}

export class Lobby {
  private el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'panel lobby';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Choose a world');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
      if (!b) return;
      if (b.dataset.w === 'close') this.el.hidden = true;
      else if (b.dataset.w === 'go' && b.dataset.url) location.href = b.dataset.url;
    });
  }

  async open() {
    const list = worlds();
    this.el.hidden = false;
    this.el.innerHTML = `<div class="econ-head"><div><span class="label">WORLDS</span><h2>Choose a world</h2></div><button type="button" class="link" data-w="close">Close</button></div>
      <div class="world-list">${list.map((w, i) => `<div class="world-row" id="w${i}"><b>${esc(w.name)}</b><span class="mono">checking…</span></div>`).join('')}</div>
      <p class="hint">Each world is its own planet with its own nations, seasons and players. Your account belongs to the world you registered in.</p>`;
    await Promise.all(list.map(async (w, i) => {
      const row = this.el.querySelector(`#w${i}`)!;
      try {
        const r = await fetch(`${w.url.replace(/\/$/, '')}/api/world`, { signal: AbortSignal.timeout(5000) });
        const s = (await r.json()) as WorldStatus;
        const here = w.url.replace(/\/$/, '') === location.origin;
        row.innerHTML = `<b>${esc(s.name ?? w.name)}</b>
          <span class="mono">${s.online ?? 0} online · ${s.players ?? 0} players · ${s.nations ?? '?'} nations · season ${s.season?.number ?? 1}</span>
          ${here ? '<em>You are here</em>' : `<button type="button" class="claim primary" data-w="go" data-url="${esc(w.url)}">Play here</button>`}`;
      } catch {
        row.innerHTML = `<b>${esc(w.name)}</b><span class="mono down">offline</span>`;
      }
    }));
  }
}
