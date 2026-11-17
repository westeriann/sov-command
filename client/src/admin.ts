// Moderation for admins (set ADMIN_USERS on the server): open reports, and
// players to ban, mute, rename or remove from their nation.
import { loadToken } from './net';
import type { Political } from './political';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
interface UserRow { id: number; name: string; guest: boolean; created: number; banned: boolean; muted: boolean; nation: number | null }
interface Report { id: number; at: number; reporter: string; target: string; text: string; reason: string }

async function admin(body: Record<string, unknown>) {
  const r = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${loadToken() ?? ''}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Server error (${r.status}).`);
  return data;
}

export class AdminPanel {
  private el: HTMLElement;
  private search = '';

  constructor(root: HTMLElement, private pol: Political) {
    this.el = document.createElement('section');
    this.el.className = 'panel econ-window admin-window';
    this.el.setAttribute('aria-label', 'Moderation');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => void this.onClick(e));
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      this.search = (this.el.querySelector('#adminSearch') as HTMLInputElement).value;
      void this.render();
    });
  }

  get isOpen() { return !this.el.hidden; }
  toggle() { this.el.hidden = !this.el.hidden; if (this.isOpen) void this.render(); }
  close() { this.el.hidden = true; }

  private async onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-adm]');
    if (!b) return;
    const a = b.dataset.adm!;
    if (a === 'close') return this.close();
    try {
      if (a === 'resolve') await admin({ action: 'resolve', report: Number(b.dataset.report) });
      else if (a === 'find') { this.search = b.dataset.name ?? ''; }
      else {
        let name: string | null = null;
        if (a === 'rename') { name = prompt('New name for this player'); if (!name) return; }
        if (a === 'ban' && !confirm('Ban this player? They lose their nation and are signed out.')) return;
        await admin({ action: a, user: Number(b.dataset.user), name });
      }
      await this.render();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async render() {
    let users: UserRow[] = [], reports: Report[] = [];
    try {
      [users, reports] = await Promise.all([
        admin({ action: 'users', search: this.search }).then((d) => d.users),
        admin({ action: 'reports' }).then((d) => d.reports),
      ]);
    } catch (err) {
      this.el.innerHTML = `<div class="econ-head"><div><span class="label">MODERATION</span><h2>Admin</h2></div><button type="button" class="link" data-adm="close">Close</button></div><div class="econ-body"><p class="hint">${esc((err as Error).message)}</p></div>`;
      return;
    }
    const nation = (id: number | null) => (id ? esc(this.pol.nations.get(id)?.short ?? '?') : '—');
    this.el.innerHTML = `<div class="econ-head"><div><span class="label">MODERATION</span><h2>Admin</h2></div><button type="button" class="link" data-adm="close">Close</button></div>
      <div class="econ-body">
        <div class="econ-cols">
          <section>
            <span class="label">OPEN REPORTS (${reports.length})</span>
            ${reports.length ? reports.map((r) => `<div class="war-row"><div><b>${esc(r.target)}</b><span class="mono">reported by ${esc(r.reporter ?? '?')} · ${new Date(r.at).toLocaleString()}</span><span>“${esc(r.text)}”</span></div>
              <div class="actions-row"><button type="button" class="claim" data-adm="find" data-name="${esc(r.target)}">Find</button><button type="button" class="claim" data-adm="resolve" data-report="${r.id}">Dismiss</button></div></div>`).join('')
              : '<p class="hint">No open reports.</p>'}
          </section>
          <section>
            <span class="label">PLAYERS</span>
            <form class="actions-row"><input id="adminSearch" class="text-input" placeholder="Search names" value="${esc(this.search)}" aria-label="Search players"><button type="submit" class="claim">Search</button></form>
            <div class="table-wrap"><table class="league"><thead><tr><th>Name</th><th>Nation</th><th>Status</th><th></th></tr></thead><tbody>
              ${users.map((u) => `<tr><th scope="row">${esc(u.name)}${u.guest ? ' <span class="muted">guest</span>' : ''}</th><td>${nation(u.nation)}</td>
                <td>${u.banned ? '<span class="down">banned</span>' : u.muted ? '<span class="down">muted</span>' : 'ok'}</td>
                <td class="admin-actions">
                  <button type="button" class="link" data-adm="${u.banned ? 'unban' : 'ban'}" data-user="${u.id}">${u.banned ? 'Unban' : 'Ban'}</button>
                  <button type="button" class="link" data-adm="${u.muted ? 'unmute' : 'mute'}" data-user="${u.id}">${u.muted ? 'Unmute' : 'Mute'}</button>
                  ${u.nation ? `<button type="button" class="link" data-adm="release" data-user="${u.id}">Remove from nation</button>` : ''}
                  <button type="button" class="link" data-adm="rename" data-user="${u.id}">Rename</button>
                </td></tr>`).join('')}
            </tbody></table></div>
          </section>
        </div>
      </div>`;
  }
}
