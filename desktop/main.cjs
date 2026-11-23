// Sovereign Command desktop: a window around the single-player build.
// The whole world simulation runs inside the window (a Web Worker), saves
// to the app's own storage, and needs no server or network. It can also host
// a multiplayer world: the same server the website uses, run by the app's own
// Node, which friends on the same network (or through a forwarded port) join.
const { app, BrowserWindow, Menu, ipcMain, protocol, shell } = require('electron');
const { spawn } = require('node:child_process');
const os = require('node:os');
const { readFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

// The game is served from app://game/ so module workers, fetch() and saved
// games behave exactly as they do on a website.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const GAME_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'game')
  : path.join(__dirname, '..', 'client', 'dist-offline');

const HOST_DIR = app.isPackaged ? path.join(process.resourcesPath, 'host') : path.join(__dirname, 'host');
const HOST_PORT = 8787;
let host = null; // the hosted world server, while running

/** Start the bundled world server; resolves with its port once it listens. */
function startHost() {
  if (host) return Promise.resolve(host.port);
  if (!existsSync(path.join(HOST_DIR, 'server.mjs'))) return Promise.reject(new Error('This build cannot host games (the server is missing).'));
  const dataDir = path.join(app.getPath('userData'), 'hosted-world');
  const child = spawn(process.execPath, [path.join(HOST_DIR, 'server.mjs')], {
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', SOV_HOST: '1', PORT: String(HOST_PORT),
      WORLD_DIR: path.join(HOST_DIR, 'site', 'world'), STATIC_DIR: path.join(HOST_DIR, 'site'), DB_FILE: path.join(dataDir, 'world.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  return new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(`The server did not start.\n${log.slice(-600)}`)), 60_000);
    child.stdout.on('data', (b) => {
      log += b;
      const m = /SOV_READY (\d+)/.exec(log);
      if (m && !host) { clearTimeout(timer); host = { child, port: Number(m[1]) }; resolve(host.port); }
    });
    child.stderr.on('data', (b) => { log += b; });
    child.on('exit', (code) => { clearTimeout(timer); host = null; if (code) reject(new Error(`The server stopped (${code}).\n${log.slice(-600)}`)); });
  });
}

function stopHost() {
  if (!host) return;
  host.child.kill();
  host = null;
}

/** Addresses on this computer's networks that friends can use to join. */
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.bin': 'application/octet-stream',
};

async function serve(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(GAME_DIR, rel));
  if (!file.startsWith(GAME_DIR)) return new Response('Forbidden', { status: 403 });
  try {
    const data = await readFile(file);
    return new Response(data, { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1100, minHeight: 680,
    backgroundColor: '#05080b',
    title: 'Sovereign Command',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // links to the outside world open in the player's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // the game itself, or a multiplayer world server chosen from the main menu, loads in this window
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !/^https?:/.test(url)) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
    // back to single player from a multiplayer server
    if (input.control && input.shift && input.key.toLowerCase() === 'h') { win.loadURL('app://game/index.html'); e.preventDefault(); }
  });
  win.loadURL('app://game/index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    if (!existsSync(path.join(GAME_DIR, 'index.html'))) {
      console.error(`Game files not found in ${GAME_DIR}. Run \`npm run game\` in desktop/ first.`);
    }
    protocol.handle('app', serve);
    ipcMain.handle('host:start', async () => {
      const port = await startHost();
      return { port, url: `http://localhost:${port}/`, addresses: lanAddresses().map((a) => `http://${a}:${port}/`) };
    });
    ipcMain.handle('host:stop', () => { stopHost(); return true; });
    ipcMain.handle('host:status', () => (host ? { port: host.port, addresses: lanAddresses().map((a) => `http://${a}:${host.port}/`) } : null));
    ipcMain.handle('app:single', (e) => { e.sender.loadURL('app://game/index.html'); return true; });
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]) : null);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', stopHost);
}
