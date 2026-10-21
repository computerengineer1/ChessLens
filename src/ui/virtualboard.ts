/**
 * Virtual chessboard widget (canvas): used by Analysis mode, the Resync
 * sheet (tap-to-move) and the position editor.
 *
 * Pieces are drawn with Unicode glyphs - no assets, crisp at any size.
 */

import { Chess, type Move } from 'chess.js';
import { el } from './dom.js';

export type BoardMode = 'view' | 'move' | 'edit';

type Sq = Parameters<Chess['get']>[0];

const GLYPHS: Record<string, string> = {
  wk: '\u2654', wq: '\u2655', wr: '\u2656', wb: '\u2657', wn: '\u2658', wp: '\u2659',
  bk: '\u265a', bq: '\u265b', br: '\u265c', bb: '\u265d', bn: '\u265e', bp: '\u265f'
};

export interface VirtualBoardOptions {
  mode?: BoardMode;
  fen?: string;
  flipped?: boolean;
  onMove?: (m: Move) => void;
  onEdit?: (fen: string) => void;
  onPromotionNeeded?: (from: string, to: string, choose: (p: 'q' | 'r' | 'b' | 'n') => void) => void;
}

export class VirtualBoard {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  chess: Chess;
  mode: BoardMode;
  flipped: boolean;
  private selected: string | null = null;
  private legalTargets: Move[] = [];
  private editPiece: string = 'wp'; // 'wp'..'bk' or '' for erase
  private editTurn: 'w' | 'b' = 'w';
  private editCastling = 'KQkq';
  private lastMove: { from: string; to: string } | null = null;
  private opts: VirtualBoardOptions;

  constructor(opts: VirtualBoardOptions = {}) {
    this.opts = opts;
    this.mode = opts.mode ?? 'view';
    this.flipped = opts.flipped ?? false;
    this.chess = new Chess(opts.fen);
    this.canvas = el('canvas', { class: 'virtual-board' });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('virtualboard: no 2d context');
    this.ctx = ctx;
    this.root = el('div', { class: 'virtual-board-wrap' }, [this.canvas]);
    this.canvas.addEventListener('pointerdown', (ev) => this.onTap(ev));
    this.resize();
  }

  resize(): void {
    const w = this.root.clientWidth || 320;
    const size = Math.max(240, Math.min(w, 560));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.draw();
  }

  setFen(fen: string): boolean {
    try {
      this.chess = new Chess(fen);
      this.selected = null;
      this.legalTargets = [];
      this.lastMove = null;
      this.draw();
      return true;
    } catch {
      return false;
    }
  }

  fen(): string {
    return this.chess.fen();
  }

  setMode(mode: BoardMode): void {
    this.mode = mode;
    this.selected = null;
    this.draw();
  }

  setFlipped(v: boolean): void {
    this.flipped = v;
    this.draw();
  }

  setEditPiece(p: string): void {
    this.editPiece = p;
  }

  setEditTurn(t: 'w' | 'b'): void {
    this.editTurn = t;
  }

  setEditCastling(c: string): void {
    this.editCastling = c;
  }

  /** Current editor FEN (from the painted board). */
  editFen(): string {
    const rows: string[] = [];
    const board = this.chess.board();
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = board[r]?.[c];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) { row += String(empty); empty = 0; }
        row += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return `${rows.join('/')} ${this.editTurn} ${this.editCastling || '-'} - 0 1`;
  }

  private squareAt(ev: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const size = rect.width;
    let col = Math.floor((x / size) * 8);
    let row = Math.floor((y / size) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    if (this.flipped) {
      col = 7 - col;
      row = 7 - row;
    }
    return `${'abcdefgh'[col]}${8 - row}`;
  }

  private onTap(ev: PointerEvent): void {
    const sq = this.squareAt(ev);
    if (!sq) return;
    if (this.mode === 'edit') {
      this.paintEdit(sq);
      return;
    }
    if (this.mode !== 'move') return;
    if (this.selected) {
      const target = this.legalTargets.filter((m) => m.to === sq);
      if (target.length > 0) {
        const promos = target.filter((m) => m.promotion);
        if (promos.length > 0) {
          const finish = (p: 'q' | 'r' | 'b' | 'n'): void => {
            const m = promos.find((x) => x.promotion === p) ?? promos[0]!;
            this.applyMove(m);
          };
          if (this.opts.onPromotionNeeded) this.opts.onPromotionNeeded(this.selected, sq, finish);
          else finish('q');
          this.selected = null;
          this.legalTargets = [];
          return;
        }
        this.applyMove(target[0]!);
        this.selected = null;
        this.legalTargets = [];
        this.draw();
        return;
      }
    }
    // Select a piece of the side to move.
    const piece = this.chess.get(sq as Sq);
    if (piece && piece.color === this.chess.turn()) {
      this.selected = sq;
      this.legalTargets = this.chess.moves({ square: sq as Sq, verbose: true }) as Move[];
    } else {
      this.selected = null;
      this.legalTargets = [];
    }
    this.draw();
  }

  private paintEdit(sq: string): void {
    if (this.editPiece === '') {
      this.chess.remove(sq as Sq);
    } else {
      const color = this.editPiece[0] as 'w' | 'b';
      const type = this.editPiece[1] as 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
      try {
        this.chess.put({ type, color }, sq as Sq);
      } catch {
        return; // illegal placement (e.g. second king) - ignore
      }
    }
    this.draw();
    this.opts.onEdit?.(this.editFen());
  }

  private applyMove(m: Move): void {
    try {
      const applied = this.chess.move({ from: m.from, to: m.to, promotion: m.promotion }) as Move;
      this.lastMove = { from: applied.from, to: applied.to };
      this.opts.onMove?.(applied);
    } catch {
      /* ignore illegal */
    }
  }

  /** Externally apply a move (engine suggestion click, resync). */
  externalMove(from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n'): boolean {
    try {
      const applied = this.chess.move({ from, to, promotion }) as Move;
      this.lastMove = { from: applied.from, to: applied.to };
      this.draw();
      return true;
    } catch {
      return false;
    }
  }

  undo(): void {
    this.chess.undo();
    this.selected = null;
    this.legalTargets = [];
    this.lastMove = null;
    this.draw();
  }

  draw(): void {
    const ctx = this.ctx;
    const size = this.canvas.width;
    const sq = size / 8;
    ctx.clearRect(0, 0, size, size);
    const board = this.chess.board();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const vr = this.flipped ? 7 - row : row;
        const vc = this.flipped ? 7 - col : col;
        const dark = ((vr + vc) & 1) === 0;
        ctx.fillStyle = dark ? '#7a5a3a' : '#e8d5b0';
        ctx.fillRect(col * sq, row * sq, sq, sq);
        const squareName = `${'abcdefgh'[vc]}${8 - vr}`;
        if (this.selected === squareName) {
          ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
          ctx.fillRect(col * sq, row * sq, sq, sq);
        }
        if (this.legalTargets.some((m) => m.to === squareName)) {
          ctx.fillStyle = 'rgba(0, 255, 140, 0.28)';
          ctx.fillRect(col * sq, row * sq, sq, sq);
        }
        if (this.lastMove && (this.lastMove.from === squareName || this.lastMove.to === squareName)) {
          ctx.fillStyle = 'rgba(255, 210, 80, 0.25)';
          ctx.fillRect(col * sq, row * sq, sq, sq);
        }
        const p = board[vr]?.[vc];
        if (p) {
          const g = GLYPHS[`${p.color}${p.type}`] ?? '?';
          ctx.font = `${Math.round(sq * 0.72)}px "Segoe UI Symbol", "Noto Sans Symbols 2", serif`;
          ctx.fillStyle = p.color === 'w' ? '#fdfdfd' : '#141414';
          ctx.strokeStyle = p.color === 'w' ? '#222' : '#ddd';
          ctx.lineWidth = Math.max(1, sq * 0.02);
          ctx.strokeText(g, col * sq + sq / 2, row * sq + sq / 2 + sq * 0.03);
          ctx.fillText(g, col * sq + sq / 2, row * sq + sq / 2 + sq * 0.03);
        }
      }
    }
    // Coordinates.
    ctx.font = `${Math.round(sq * 0.18)}px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let col = 0; col < 8; col++) {
      const vc = this.flipped ? 7 - col : col;
      ctx.fillText('abcdefgh'[vc] as string, col * sq + 3, size - sq * 0.24);
    }
    for (let row = 0; row < 8; row++) {
      const vr = this.flipped ? 7 - row : row;
      ctx.fillText(String(8 - vr), row * 0 + 3, row * sq + 3);
    }
  }
}
