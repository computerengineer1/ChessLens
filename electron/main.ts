/**
 * Electron main process.
 *
 * Serves the built renderer over a privileged custom scheme (app://) so
 * that:
 *  - the page is a secure context (getUserMedia works),
 *  - Web Workers / nested engine worker load correctly (file:// blocks them),
 *  - COOP/COEP headers are NOT needed (the engine is the lite single-thread
 *    WASM build with no SharedArrayBuffer).
 *
 * Camera permission is granted in the session permission handler.
 * `--demo` starts the synthetic PGN playback (same as ?demo=1 in browsers).
 */

import { app, BrowserWindow, session, protocol, net, Menu } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, extname, normalize } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true
    }
  }
]);

function serve(req: GlobalRequest): Response | Promise<Response> {
  const url = new URL(req.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  // Prevent path traversal.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, safe);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA fallback.
    file = join(DIST, 'index.html');
  }
  const mime = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  return net.fetch(pathToFileURL(file).toString()).then((res) => {
    const headers = new Headers(res.headers);
    headers.set('Content-Type', mime);
    headers.set('Cache-Control', 'no-cache');
    return new Response(res.body, { status: res.status, headers });
  });
}

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    title: 'ChessLens AR',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);

  // Allow camera + microphone-free media access for the renderer.
  // Grant camera access to our own renderer only.
  const allowed = (permission: string): boolean => permission === 'media' || permission === 'camera';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));

  const demo = process.argv.includes('--demo');
  void win.loadURL(`app://./index.html${demo ? '?demo=1' : ''}`);
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  protocol.handle('app', serve);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
