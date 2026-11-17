// Talking to the world server: account calls over HTTP, game traffic over a
// WebSocket that reconnects on its own.
import type { AuthResponse, ClientMsg, ServerMsg } from '../../shared/protocol';
import type { Game } from './game';

const TOKEN_KEY = 'sovereign.token';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: the session lasts until the tab closes */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing stored */
  }
}

export async function serverAvailable(timeoutMs = 2500) {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

export async function authenticate(kind: 'login' | 'register' | 'guest', name = '', password = ''): Promise<AuthResponse> {
  let r: Response;
  try {
    r = await fetch(`/api/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Server error (${r.status}).`);
  return body as AuthResponse;
}

export async function logout(token: string) {
  await fetch('/api/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
}

export class Connection {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private retry = 1000;
  private pingTimer = 0;
  private stopped = true;
  onAuthFailed: () => void = () => {};

  constructor(private game: Game) {}

  connect(token: string) {
    this.token = token;
    this.stopped = false;
    this.open();
  }

  private open() {
    if (this.stopped || !this.token) return;
    this.game.setStatus('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', token: this.token ?? '' } satisfies ClientMsg));
      this.retry = 1000;
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: Date.now() }), 20_000);
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'error' && msg.code === 'auth') {
        this.stop();
        clearToken();
        this.game.reset();
        this.game.setStatus('offline');
        this.onAuthFailed();
        return;
      }
      this.game.apply(msg);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws || this.stopped) return;
      this.game.setStatus('connecting');
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(30_000, this.retry * 2);
    };
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  stop() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
