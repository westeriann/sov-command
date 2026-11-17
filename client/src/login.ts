import { LIMITS, type AuthResponse } from '../../shared/protocol';
import { authenticate } from './net';

/** Sign-in dialog: log in, create an account, play as a guest, or keep exploring offline. */
export class LoginDialog {
  private el: HTMLElement;

  constructor(root: HTMLElement, private onSignedIn: (r: AuthResponse) => void) {
    this.el = document.createElement('div');
    this.el.className = 'login-backdrop';
    this.el.hidden = true;
    this.el.innerHTML = `
      <form class="panel login" id="loginForm" aria-labelledby="loginTitle" novalidate>
        <div class="title" id="loginTitle">JOIN THE WORLD</div>
        <p class="muted">Lead a nation in a world that never pauses. Nations nobody leads are run by the AI, and you can take over any of them.</p>
        <label for="loginName">Commander name</label>
        <input id="loginName" name="name" autocomplete="username" maxlength="${LIMITS.nameMax}" required>
        <label for="loginPassword">Password</label>
        <input id="loginPassword" name="password" type="password" autocomplete="current-password" required>
        <p class="form-error" id="loginError" role="alert" hidden></p>
        <div class="login-actions">
          <button type="submit" class="primary" data-kind="login">Log in</button>
          <button type="button" data-kind="register">Create account</button>
        </div>
        <div class="login-alt">
          <button type="button" class="link" data-kind="guest">Play as a guest</button>
          <button type="button" class="link" data-kind="close">Explore without signing in</button>
        </div>
      </form>`;
    root.appendChild(this.el);
    const form = this.el.querySelector<HTMLFormElement>('#loginForm')!;
    const name = this.el.querySelector<HTMLInputElement>('#loginName')!;
    const pass = this.el.querySelector<HTMLInputElement>('#loginPassword')!;
    const error = this.el.querySelector<HTMLElement>('#loginError')!;
    const buttons = [...this.el.querySelectorAll<HTMLButtonElement>('button')];

    const run = async (kind: 'login' | 'register' | 'guest') => {
      error.hidden = true;
      buttons.forEach((b) => (b.disabled = true));
      try {
        const r = await authenticate(kind, name.value.trim(), pass.value);
        pass.value = '';
        this.close();
        this.onSignedIn(r);
      } catch (e) {
        error.textContent = (e as Error).message;
        error.hidden = false;
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void run('login');
    });
    this.el.addEventListener('click', (e) => {
      const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]')?.dataset.kind;
      if (kind === 'register') {
        pass.autocomplete = 'new-password';
        void run('register');
      } else if (kind === 'guest') void run('guest');
      else if (kind === 'close') this.close();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  open() {
    this.el.hidden = false;
    this.el.querySelector<HTMLInputElement>('#loginName')!.focus();
  }

  close() {
    this.el.hidden = true;
  }
}
