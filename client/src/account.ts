// Account safety: the recovery code (shown once), a lost-password form, and
// changing your password. There is no email: the recovery code is the way back in.
import { LIMITS, type AuthResponse } from '../../shared/protocol';
import { loadToken } from './net';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function post(path: string, body: unknown, auth = false): Promise<AuthResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = loadToken();
  if (auth && token) headers.authorization = `Bearer ${token}`;
  let r: Response;
  try { r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }); } catch { throw new Error('Could not reach the server.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Server error (${r.status}).`);
  return data as AuthResponse;
}

export class AccountDialog {
  private el: HTMLElement;

  constructor(root: HTMLElement, private onSignedIn: (r: AuthResponse) => void) {
    this.el = document.createElement('div');
    this.el.className = 'login-backdrop';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-acct]')?.dataset.acct;
      if (a === 'close') this.close();
      else if (a === 'copy') void navigator.clipboard?.writeText(this.el.querySelector('.recovery-code')?.textContent ?? '');
    });
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const v = (id: string) => (form.querySelector(`#${id}`) as HTMLInputElement).value;
      const error = form.querySelector<HTMLElement>('.form-error')!;
      error.hidden = true;
      const done = (r: AuthResponse) => { this.onSignedIn(r); if (r.recovery) this.showRecovery(r.recovery); else this.close(); };
      const fail = (err: Error) => { error.textContent = err.message; error.hidden = false; };
      if (form.id === 'recoverForm') post('/api/recover', { name: v('recName').trim(), code: v('recCode'), password: v('recPass') }).then(done, fail);
      else if (form.id === 'passwordForm') {
        if (v('newPass') !== v('newPass2')) return fail(new Error('The new passwords do not match.'));
        post('/api/password', { old: v('oldPass'), password: v('newPass') }, true).then((r) => { done(r); this.showMessage('Password changed. Other devices have been signed out.'); }, fail);
      }
    });
  }

  close() { this.el.hidden = true; }

  /** After registering (or recovering): the one time the code is shown. */
  showRecovery(code: string) {
    this.el.hidden = false;
    this.el.innerHTML = `<div class="panel login" role="dialog" aria-labelledby="recTitle">
      <div class="title" id="recTitle">SAVE YOUR RECOVERY CODE</div>
      <p class="muted">If you ever forget your password, this code is the only way back into your account. Write it down or keep it in a password manager. It will not be shown again.</p>
      <p class="recovery-code mono">${esc(code)}</p>
      <div class="login-actions"><button type="button" data-acct="copy">Copy</button><button type="button" class="primary" data-acct="close">I have saved it</button></div>
    </div>`;
    this.el.querySelector<HTMLElement>('[data-acct="close"]')!.focus();
  }

  private showMessage(text: string) {
    this.el.hidden = false;
    this.el.innerHTML = `<div class="panel login" role="dialog"><p>${esc(text)}</p><div class="login-actions"><button type="button" class="primary" data-acct="close">OK</button></div></div>`;
  }

  openRecover(name = '') {
    this.el.hidden = false;
    this.el.innerHTML = `<form class="panel login" id="recoverForm" novalidate>
      <div class="title">RECOVER YOUR ACCOUNT</div>
      <p class="muted">Enter your commander name, the recovery code you saved when you registered, and a new password.</p>
      <label for="recName">Commander name</label><input id="recName" autocomplete="username" maxlength="${LIMITS.nameMax}" value="${esc(name)}">
      <label for="recCode">Recovery code</label><input id="recCode" autocomplete="one-time-code" placeholder="XXXX-XXXX-XXXX">
      <label for="recPass">New password</label><input id="recPass" type="password" autocomplete="new-password">
      <p class="form-error" role="alert" hidden></p>
      <div class="login-actions"><button type="submit" class="primary">Set new password</button><button type="button" data-acct="close">Cancel</button></div>
    </form>`;
    this.el.querySelector<HTMLInputElement>(name ? '#recCode' : '#recName')!.focus();
  }

  openChangePassword() {
    this.el.hidden = false;
    this.el.innerHTML = `<form class="panel login" id="passwordForm" novalidate>
      <div class="title">CHANGE PASSWORD</div>
      <label for="oldPass">Current password</label><input id="oldPass" type="password" autocomplete="current-password">
      <label for="newPass">New password</label><input id="newPass" type="password" autocomplete="new-password">
      <label for="newPass2">New password again</label><input id="newPass2" type="password" autocomplete="new-password">
      <p class="form-error" role="alert" hidden></p>
      <div class="login-actions"><button type="submit" class="primary">Change password</button><button type="button" data-acct="close">Cancel</button></div>
    </form>`;
    this.el.querySelector<HTMLInputElement>('#oldPass')!.focus();
  }
}
