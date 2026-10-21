/**
 * Terminal-style log panel.
 *
 * Dark, monospace, auto-scrolling, timestamps `[HH:MM:SS]`. Collapsed shows
 * the last 4 lines; tapping expands to the full ring buffer. Always LTR,
 * even in Arabic UI mode (per spec).
 */

import { el } from './dom.js';
import { timestamp } from '../util/timing.js';

export type LogLevel = 'info' | 'move' | 'engine' | 'warn' | 'error';

export interface LogEntry {
  time: string;
  text: string;
  level: LogLevel;
}

const MAX_ENTRIES = 300;
const COLLAPSED_LINES = 4;

export class LogPanel {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private toggle: HTMLElement;
  private entries: LogEntry[] = [];
  expanded = false;

  constructor() {
    this.list = el('div', { class: 'log-lines' });
    this.toggle = el('button', { class: 'log-toggle', text: '\u25b2' });
    this.toggle.addEventListener('click', () => this.setExpanded(!this.expanded));
    this.root = el('div', { class: 'log-panel', dir: 'ltr' }, [this.toggle, this.list]);
    // Tap anywhere on the collapsed panel to expand.
    this.list.addEventListener('click', () => {
      if (!this.expanded) this.setExpanded(true);
    });
  }

  log(text: string, level: LogLevel = 'info'): void {
    const entry: LogEntry = { time: timestamp(), text, level };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.render();
  }

  /** Raw line without timestamp decoration (already formatted). */
  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.render();
  }

  setExpanded(v: boolean): void {
    this.expanded = v;
    this.root.classList.toggle('expanded', v);
    this.toggle.textContent = v ? '\u25bc' : '\u25b2';
    this.render();
  }

  private render(): void {
    const visible = this.expanded ? this.entries : this.entries.slice(-COLLAPSED_LINES);
    // Rebuild only the visible tail (cheap: <= MAX_ENTRIES small nodes).
    this.list.replaceChildren(
      ...visible.map((e) =>
        el('div', { class: `log-line log-${e.level}` }, [el('span', { class: 'log-time', text: `[${e.time}]` }), ` ${e.text}`])
      )
    );
    if (!this.expanded) {
      // Auto-scroll: keep the newest line at the bottom of the 4-line window.
      this.list.scrollTop = this.list.scrollHeight;
    } else {
      this.list.scrollTop = this.list.scrollHeight;
    }
  }
}

/**
 * Spec-exact log line formatting. The terminal log is intentionally always
 * English + LTR (it mimics an engine console), independent of UI language.
 */
export const logLines = {
  waitingForGame(): string {
    return 'waiting for game';
  },
  playerMoveConfirmed(desc: string, extras: string[]): string {
    const suffix = extras.length ? ` (${extras.join(', ')})` : '';
    return `player move confirmed: ${desc}${suffix}`;
  },
  opponentTurnFinished(desc: string, extras: string[]): string {
    const suffix = extras.length ? ` (${extras.join(', ')})` : '';
    return `opponent turn finished: ${desc}${suffix}`;
  },
  queryStockfish(): string {
    return 'query stockfish with board positioning';
  },
  newMoveToRenderer(desc: string): string {
    return `new move sent to rendering engine: ${desc}`;
  },
  finalMoveToRenderer(desc: string, extras: string[]): string {
    const suffix = extras.length ? ` (${extras.join(', ')})` : '';
    return `final move sent to rendering engine: ${desc}${suffix}`;
  },
  engineReady(backend: string): string {
    return `engine ready (stockfish 19 lite, ${backend}, hash 16MB, threads 1)`;
  },
  engineFallback(): string {
    return 'warn: wasm engine failed to init, falling back to asm.js build';
  },
  engineFailed(): string {
    return 'error: engine failed to start - analysis disabled, tracking continues';
  },
  scanStart(): string {
    return 'scanning start position for self-supervised templates';
  },
  scanDone(): string {
    return 'vision model learned from start position (64 squares)';
  },
  calibrated(coverage: number): string {
    return `board calibrated (warp coverage ${(coverage * 100).toFixed(1)}%)`;
  },
  recovered(n: number): string {
    return `recovery: ${n} missed ply re-synced from camera`;
  },
  unstable(reason: string): string {
    return `frame unstable (${reason}) - waiting`;
  },
  resyncNeeded(): string {
    return 'warn: position lost - manual resync requested';
  },
  resyncApplied(fen: string): string {
    return `position resynced manually: ${fen}`;
  },
  ambiguous(cands: string[]): string {
    return `ambiguous observation - asking user: ${cands.join(' | ')}`;
  },
  promotion(piece: string): string {
    return `promotion applied: ${piece} (tap piece chip to under-promote)`;
  },
  gameOver(result: string): string {
    return `game over: ${result}`;
  }
};
