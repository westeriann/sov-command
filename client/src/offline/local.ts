// Single-player: the game interface talks to the world in a Web Worker
// instead of a server. Same messages, no network.
import type { ClientMsg, ServerMsg } from '../../../shared/protocol';
import type { Game } from '../game';
import { Connection } from '../net';

export function startWorld(base: string): Promise<Worker> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  installApi(worker);
  return new Promise((resolve, reject) => {
    const onReady = (e: MessageEvent) => {
      if (e.data?.t !== 'ready') return;
      worker.removeEventListener('message', onReady);
      resolve(worker);
    };
    worker.addEventListener('message', onReady);
    worker.addEventListener('error', (e) => reject(e));
    worker.postMessage({ t: 'start', base });
    window.addEventListener('pagehide', () => worker.postMessage({ t: 'save' }));
  });
}

/** Answer the interface's /api/ requests from the worker. */
function installApi(worker: Worker) {
  let next = 1;
  const waiting = new Map<number, (r: { status: number; body: unknown }) => void>();
  worker.addEventListener('message', (e) => {
    if (e.data?.t !== 'api') return;
    waiting.get(e.data.id)?.(e.data);
    waiting.delete(e.data.id);
  });
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/(^|\/)api\//.test(new URL(url, location.href).pathname)) return real(input, init);
    const id = next++;
    return new Promise<Response>((resolve) => {
      waiting.set(id, (r) => resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })));
      worker.postMessage({ t: 'api', id, path: url });
    });
  };
}

export class LocalConnection extends Connection {
  private listening = false;
  constructor(private local: Game, private worker: Worker) { super(local); }

  connect() {
    if (!this.listening) {
      this.listening = true;
      this.worker.addEventListener('message', (e) => { if (e.data?.t === 'msg') this.local.apply(e.data.msg as ServerMsg); });
    }
    this.send({ t: 'hello', token: 'local' });
  }

  send(msg: ClientMsg) { this.worker.postMessage({ t: 'msg', msg }); }

  stop() { /* the world keeps running in this tab */ }

  /** Start over: delete the saved world and reload. Ironman: one autosave, no loading other saves. */
  newGame(ironman = false) {
    this.worker.addEventListener('message', (e) => { if (e.data?.t === 'reset-done') location.reload(); });
    this.worker.postMessage({ t: 'reset', ironman });
  }

  /** Save slots: list them, save the world under a name, load one (reloads the page), delete one. */
  slots(msg: { t: 'slots' } | { t: 'save-slot'; name: string } | { t: 'load-slot'; name: string } | { t: 'delete-slot'; name: string }) {
    return new Promise<{ list: { name: string; info: string }[]; ironman: boolean; error?: string; saved?: string }>((res) => {
      const on = (e: MessageEvent) => {
        if (e.data?.t === 'reset-done') location.reload();
        if (e.data?.t !== 'slots') return;
        this.worker.removeEventListener('message', on);
        res(e.data);
      };
      this.worker.addEventListener('message', on);
      this.worker.postMessage(msg);
    });
  }

  pause(on: boolean) { this.worker.postMessage({ t: 'pause', on }); }
}
