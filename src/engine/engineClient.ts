/**
 * EngineClient: UCI wrapper around the engine worker.
 *
 * Responsibilities:
 *  - lazily spawn the engine worker and pre-warm (uci/isready/ucinewgame)
 *  - Hash 16 MB, Threads 1 (lite single WASM build - no SharedArrayBuffer,
 *    so no COOP/COEP headers needed anywhere)
 *  - analyze(fen): set position, `go movetime ... depth ...`, stream infos
 *  - cancel any running search when the position changes (`stop`)
 *  - surface Skill Level / MultiPV settings
 *  - never touch the UI thread with parsing work beyond simple line splits
 */

import type { EngineSettings } from '../types.js';
import type { EngineWorkerInbound, EngineWorkerOutbound } from './engine.worker.js';

export type EngineBackend = 'wasm' | 'asmjs' | 'none';
export type EngineStatus = 'idle' | 'starting' | 'ready' | 'searching' | 'failed';

export interface EngineLine {
  multipv: number;
  depth: number;
  /** Centipawns from the side-to-move perspective, or null for mate scores. */
  cp: number | null;
  /** Mate in N (positive = side to move mates), or null. */
  mate: number | null;
  pvSan: string[];
  pvUci: string[];
  nodes: number;
  nps: number;
  timeMs: number;
}

export interface BestMove {
  uci: string;
  from: string;
  to: string;
  promotion?: string;
  ponder?: string;
}

export interface EngineCallbacks {
  onStatus?: (status: EngineStatus, backend: EngineBackend, error?: string) => void;
  onInfo?: (line: EngineLine) => void;
  onBestMove?: (mv: BestMove, searchMs: number) => void;
}

/** Platform default think time per move (ms). */
export function defaultMovetime(): number {
  if (typeof navigator !== 'undefined' && /android|iphone|ipad|mobile/i.test(navigator.userAgent)) return 700;
  return 1200;
}

const HASH_MB = 16;

export class EngineClient {
  private worker: Worker | null = null;
  private backend: EngineBackend = 'none';
  private status: EngineStatus = 'idle';
  private readyResolvers: Array<() => void> = [];
  private failed = false;
  private pendingReadyOk: Array<() => void> = [];
  private searchStart = 0;
  private currentFen: string | null = null;
  private settings: EngineSettings;
  private cb: EngineCallbacks;
  private urls: { wasmUrl: string; asmUrl: string };

  constructor(settings: EngineSettings, cb: EngineCallbacks = {}, baseUrl?: string) {
    this.settings = { ...settings };
    this.cb = cb;
    const base = baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : '/');
    this.urls = {
      wasmUrl: new URL('engine/stockfish-19-lite-single.js', base).href,
      asmUrl: new URL('engine/stockfish-19-asm.js', base).href
    };
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getBackend(): EngineBackend {
    return this.backend;
  }

  /** Spawn (once) and pre-warm the engine. Resolves when ready (or failed). */
  async start(): Promise<boolean> {
    if (this.status === 'ready') return true;
    if (this.failed) return false;
    if (this.worker) {
      return new Promise<boolean>((resolve) => this.readyResolvers.push(() => resolve(!this.failed)));
    }
    this.setStatus('starting');
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'chesslens-engine'
    });
    this.worker.onmessage = (ev: MessageEvent<EngineWorkerOutbound>) => this.onWorkerMessage(ev.data);

    return new Promise<boolean>((resolve) => {
      this.readyResolvers.push(() => resolve(!this.failed));
      this.post({
        type: 'init',
        wasmUrl: this.urls.wasmUrl,
        asmUrl: this.urls.asmUrl,
        preferAsm: this.settings.forceAsmJs
      });
      // Final safety net: if neither backend reports uciok in 25s, fail.
      setTimeout(() => {
        if (this.status === 'starting') {
          this.failed = true;
          this.setStatus('failed', 'engine init timeout');
          this.flushReady();
        }
      }, 25000);
    });
  }

  private post(msg: EngineWorkerInbound): void {
    this.worker?.postMessage(msg);
  }

  private setStatus(s: EngineStatus, error?: string): void {
    this.status = s;
    this.cb.onStatus?.(s, this.backend, error);
  }

  private flushReady(): void {
    const rs = this.readyResolvers;
    this.readyResolvers = [];
    for (const r of rs) r();
  }

  private onWorkerMessage(msg: EngineWorkerOutbound): void {
    if (msg.type === 'status') {
      if (msg.ok) {
        this.backend = msg.backend;
        // Finish UCI handshake and options.
        this.sendRaw('setoption name Hash value ' + HASH_MB);
        this.sendRaw('setoption name Threads value 1');
        this.applyOptions();
        this.sendRaw('isready');
        this.pendingReadyOk.push(() => {
          this.sendRaw('ucinewgame');
          this.setStatus('ready');
          this.flushReady();
        });
      } else {
        this.failed = true;
        this.setStatus('failed', msg.error);
        this.flushReady();
      }
      return;
    }
    const line = msg.line;
    if (line === 'readyok') {
      const cb = this.pendingReadyOk.shift();
      if (cb) cb();
      else if (this.afterReady) {
        const f = this.afterReady;
        this.afterReady = null;
        f();
      }
      return;
    }
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const parsed = parseInfo(line, this.pvConverter);
      if (parsed) this.cb.onInfo?.(parsed);
      return;
    }
    if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/);
      const uci = parts[1] ?? '';
      const searchMs = this.searchStart ? Date.now() - this.searchStart : 0;
      this.searchStart = 0;
      if (this.status === 'searching') this.setStatus('ready');
      if (uci && uci !== '(none)') {
        const mv: BestMove = {
          uci,
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          ...(uci.length > 4 ? { promotion: uci.slice(4) } : {}),
          ...(parts[3] ? { ponder: parts[3] } : {})
        };
        this.cb.onBestMove?.(mv, searchMs);
      }
    }
  }

  private afterReady: (() => void) | null = null;
  private pvConverter: ((uciMoves: string[], fen: string) => string[]) | null = null;

  /** Register a UCI->SAN converter (chess.js lives on the main thread only). */
  setPvConverter(fn: (uciMoves: string[], fen: string) => string[]): void {
    this.pvConverter = fn;
  }

  private sendRaw(line: string): void {
    this.post({ type: 'uci', line });
  }

  private applyOptions(): void {
    this.sendRaw(`setoption name Skill Level value ${this.settings.skill}`);
    this.sendRaw(`setoption name MultiPV value ${this.settings.multipv}`);
  }

  updateSettings(s: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...s };
    if (this.status === 'ready' || this.status === 'searching') {
      this.stopSearch();
      this.applyOptions();
    }
  }

  getSettings(): EngineSettings {
    return { ...this.settings };
  }

  /**
   * Cancel any running search. Safe to call when idle.
   */
  stopSearch(): void {
    if (this.status === 'searching') {
      this.sendRaw('stop');
      // bestmove will arrive and flip status back to ready.
    }
  }

  /**
   * Analyze a position. Cancels any in-flight search first.
   * `movesUci` optionally applies a move sequence on top of the FEN.
   */
  analyze(fen: string, movesUci: string[] = []): void {
    if (this.failed) return;
    const run = (): void => {
      this.stopSearchSync();
      this.currentFen = fen;
      const pos = movesUci.length ? `position fen ${fen} moves ${movesUci.join(' ')}` : `position fen ${fen}`;
      this.sendRaw(pos);
      const movetime = this.settings.movetime > 0 ? this.settings.movetime : defaultMovetime();
      this.searchStart = Date.now();
      this.setStatus('searching');
      this.sendRaw(`go movetime ${movetime} depth ${this.settings.depthCap}`);
    };
    if (this.status === 'starting' || this.pendingReadyOk.length > 0) {
      this.afterReady = run;
    } else if (this.status === 'ready' || this.status === 'searching') {
      run();
    }
  }

  /** Synchronous stop that waits for the bestmove round-trip via isready. */
  private stopSearchSync(): void {
    if (this.status === 'searching') {
      this.sendRaw('stop');
      this.sendRaw('isready');
      // The readyok handler resets status; force local state so the next
      // position command cannot interleave with a stale bestmove.
      this.status = 'ready';
      this.cb.onStatus?.(this.status, this.backend);
    }
  }

  /**
   * Fully restart the engine worker (used when the backend is force-changed).
   * Resolves like start().
   */
  async restart(): Promise<boolean> {
    this.post({ type: 'terminate' });
    this.worker?.terminate();
    this.worker = null;
    this.backend = 'none';
    this.failed = false;
    this.status = 'idle';
    this.pendingReadyOk = [];
    this.afterReady = null;
    return this.start();
  }

  newGame(): void {
    this.stopSearch();
    this.sendRaw('ucinewgame');
    this.sendRaw('isready');
    this.currentFen = null;
  }

  currentAnalyzedFen(): string | null {
    return this.currentFen;
  }

  dispose(): void {
    this.post({ type: 'terminate' });
    this.worker?.terminate();
    this.worker = null;
    this.backend = 'none';
    this.failed = true;
    this.setStatus('idle');
  }
}

/** Parse a UCI `info ... pv ...` line. */
export function parseInfo(
  line: string,
  sanConverter: ((uciMoves: string[], fen: string) => string[]) | null = null,
  fen = ''
): EngineLine | null {
  const tok = line.split(/\s+/);
  let depth = 0;
  let cp: number | null = null;
  let mate: number | null = null;
  let multipv = 1;
  let nodes = 0;
  let nps = 0;
  let timeMs = 0;
  let pv: string[] = [];
  for (let i = 0; i < tok.length; i++) {
    switch (tok[i]) {
      case 'depth':
        depth = Number(tok[++i]);
        break;
      case 'multipv':
        multipv = Number(tok[++i]);
        break;
      case 'score': {
        const kind = tok[++i];
        const val = Number(tok[++i]);
        if (kind === 'cp') cp = val;
        else if (kind === 'mate') mate = val;
        break;
      }
      case 'nodes':
        nodes = Number(tok[++i]);
        break;
      case 'nps':
        nps = Number(tok[++i]);
        break;
      case 'time':
        timeMs = Number(tok[++i]);
        break;
      case 'pv':
        pv = tok.slice(i + 1);
        i = tok.length;
        break;
      default:
        break;
    }
  }
  if (pv.length === 0) return null;
  const pvSan = sanConverter ? sanConverter(pv, fen) : [];
  return { multipv, depth, cp, mate, pvSan, pvUci: pv, nodes, nps, timeMs };
}

/** Format an evaluation for display: "+1.4" / "-0.3" / "M3". */
export function formatEval(line: { cp: number | null; mate: number | null }, fromWhitePerspective = true, sideToMove: 'w' | 'b' = 'w'): string {
  if (line.mate !== null) {
    let m = line.mate;
    if (!fromWhitePerspective) return `M${m}`;
    if (sideToMove === 'b') m = -m;
    return `M${m}`;
  }
  if (line.cp === null) return '';
  let cp = line.cp;
  if (fromWhitePerspective && sideToMove === 'b') cp = -cp;
  const v = cp / 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
}

/** Map an eval to a 0..1 bar fill (white advantage up). */
export function evalToBar(cp: number | null, mate: number | null, sideToMove: 'w' | 'b'): number {
  let score = 0;
  if (mate !== null) score = mate >= 0 ? 1000 : -1000;
  else if (cp !== null) score = cp;
  if (sideToMove === 'b') score = -score;
  // Sigmoid-ish mapping; +/-350cp ~ 85%.
  return 0.5 + 0.5 * Math.tanh(score / 400);
}
