// Serves the built website and map tiles in production (one process, one port).
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

export function staticHandler(dir: string) {
  const root = resolve(dir);
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; } // no escaping the site folder
    let target = file, stat;
    try { stat = statSync(target); } catch { stat = null; }
    if (!stat || !stat.isFile()) {
      if (extname(path)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
      target = join(root, 'index.html'); // client-side routes fall back to the app
      stat = statSync(target);
    }
    const ext = extname(target).toLowerCase();
    // hashed build assets and map tiles never change; the page itself always revalidates
    const cache = target.includes(`${sep}assets${sep}`) || target.includes(`${sep}world${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': cache,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(target).pipe(res);
  };
}
