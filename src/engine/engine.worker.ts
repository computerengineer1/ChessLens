/// <reference lib="webworker" />
/**
 * Dedicated engine Web Worker.
 *
 * Stockfish (lite single-threaded WASM, no SharedArrayBuffer needed) is
 * loaded as a NESTED worker from /engine/stockfish-19-lite-single.js, which
 * resolves its .wasm sibling by URL and speaks UCI over postMessage.
 *
 * This wrapper adds:
 *  - lifecycle management (init/terminate)
 *  - an initialization watchdog with automatic asm.js fallback when the WASM
 *    build fails (some older webviews)
 *  - message framing between the app and the raw UCI stream.
 *
 * Protocol (parent <-> this worker):
 *   parent -> worker: { type: 'init', wasmUrl, asmUrl }
 *                     { type: 'uci', line: string }
 *                     { type: 'terminate' }
 *   worker -> parent: { type: 'engine', line: string }
 *                     { type: 'status', backend: 'wasm' | 'asmjs' | 'none', ok: boolean, error?: string }
 */

export interface EngineWorkerInit {
  type: 'init';
  wasmUrl: string;
  asmUrl: string;
  /** Start directly with the asm.js build (user forced it in settings). */
  preferAsm?: boolean;
}
export interface EngineWorkerUci {
  type: 'uci';
  line: string;
}
export interface EngineWorkerTerminate {
  type: 'terminate';
}
export type EngineWorkerInbound = EngineWorkerInit | EngineWorkerUci | EngineWorkerTerminate;

export interface EngineWorkerEngineMsg {
  type: 'engine';
  line: string;
}
export interface EngineWorkerStatusMsg {
  type: 'status';
  backend: 'wasm' | 'asmjs' | 'none';
  ok: boolean;
  error?: string;
}
export type EngineWorkerOutbound = EngineWorkerEngineMsg | EngineWorkerStatusMsg;

const INIT_TIMEOUT_MS = 10000;

declare const self: DedicatedWorkerGlobalScope;

let child: Worker | null = null;
let backend: 'wasm' | 'asmjs' | 'none' = 'none';
let initTimer: ReturnType<typeof setTimeout> | null = null;
let gotUciok = false;
let pendingInit: { wasmUrl: string; asmUrl: string } | null = null;

function send(msg: EngineWorkerOutbound): void {
  self.postMessage(msg);
}

function clearInitTimer(): void {
  if (initTimer !== null) {
    clearTimeout(initTimer);
    initTimer = null;
  }
}

function killChild(): void {
  if (child) {
    child.terminate();
    child = null;
  }
}

function spawn(url: string, which: 'wasm' | 'asmjs'): void {
  killChild();
  gotUciok = false;
  backend = which;
  try {
    child = new Worker(url, { name: `stockfish-${which}` });
  } catch (err) {
    send({ type: 'status', backend: 'none', ok: false, error: String(err) });
    return;
  }
  child.onmessage = (ev: MessageEvent) => {
    const line = typeof ev.data === 'string' ? ev.data : String(ev.data);
    if (line === 'uciok') {
      gotUciok = true;
      clearInitTimer();
      send({ type: 'status', backend, ok: true });
    }
    send({ type: 'engine', line });
  };
  child.onerror = (ev) => {
    send({
      type: 'status',
      backend: 'none',
      ok: false,
      error: ev.message || 'engine worker error'
    });
    if (!gotUciok && backend === 'wasm' && pendingInit) {
      // WASM failed to load (e.g. webview without WASM support): fall back.
      clearInitTimer();
      spawn(pendingInit.asmUrl, 'asmjs');
    }
  };
  child.postMessage('uci');
  clearInitTimer();
  initTimer = setTimeout(() => {
    if (!gotUciok) {
      if (backend === 'wasm' && pendingInit) {
        spawn(pendingInit.asmUrl, 'asmjs');
      } else {
        send({ type: 'status', backend: 'none', ok: false, error: 'engine init timeout' });
      }
    }
  }, INIT_TIMEOUT_MS);
}

self.onmessage = (ev: MessageEvent<EngineWorkerInbound>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      pendingInit = { wasmUrl: msg.wasmUrl, asmUrl: msg.asmUrl };
      if (msg.preferAsm) spawn(msg.asmUrl, 'asmjs');
      else spawn(msg.wasmUrl, 'wasm');
      break;
    }
    case 'uci': {
      if (child) child.postMessage(msg.line);
      break;
    }
    case 'terminate': {
      clearInitTimer();
      killChild();
      backend = 'none';
      break;
    }
  }
};
