/**
 * GameState: chess.js wrapper with canonical occupancy maps.
 *
 * Occupancy map: Uint8Array(64), canonical indexing (0 = a8 ... 63 = h1),
 * values EMPTY/WHITE/BLACK from types.ts. Expected maps for candidate moves
 * are computed INCREMENTALLY (no chess.js clone per candidate) so the
 * per-detection hot loop stays allocation-free.
 */

import { Chess, type Move } from 'chess.js';
import { BLACK, EMPTY, WHITE } from '../types.js';
import { indexOfSquare } from '../vision/features.js';

/** Rook jumps for castling, indexed by [colorIsWhite?1:0][kingside?1:0]. */
const CASTLE_ROOK: Record<string, [number, number]> = {
  wk: [63, 61], // h1 -> f1
  wq: [56, 59], // a1 -> d1
  bk: [7, 5], //   h8 -> f8
  bq: [0, 3] //    a8 -> d8
};

export class GameState {
  readonly chess: Chess;
  private mapBuf = new Uint8Array(64);

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  get turn(): 'w' | 'b' {
    return this.chess.turn();
  }

  fen(): string {
    return this.chess.fen();
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  isCheckmate(): boolean {
    return this.chess.isCheckmate();
  }

  isStalemate(): boolean {
    return this.chess.isStalemate();
  }

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  /** Current occupancy in canonical indexing. Reuses an internal buffer when out is omitted. */
  occupancy(out?: Uint8Array): Uint8Array {
    const map = out ?? this.mapBuf;
    map.fill(EMPTY);
    const board = this.chess.board();
    for (let r = 0; r < 8; r++) {
      const row = board[r];
      if (!row) continue;
      for (let c = 0; c < 8; c++) {
        const p = row[c];
        if (p) map[r * 8 + c] = p.color === 'w' ? WHITE : BLACK;
      }
    }
    return map;
  }

  legalMoves(): Move[] {
    return this.chess.moves({ verbose: true }) as Move[];
  }

  /** Apply a verbose move. Throws when illegal (chess.js semantics). */
  applyMove(m: Move): Move {
    return this.chess.move({ from: m.from, to: m.to, promotion: m.promotion }) as Move;
  }

  /** Apply by SAN or UCI ("e2e4"/"e7e8q"). Returns the move or null when illegal. */
  applyUciOrSan(s: string): Move | null {
    const trimmed = s.trim();
    try {
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(trimmed)) {
        return this.chess.move({
          from: trimmed.slice(0, 2),
          to: trimmed.slice(2, 4),
          promotion: trimmed.length === 5 ? (trimmed[4] as 'q' | 'r' | 'b' | 'n') : undefined
        }) as Move;
      }
      return this.chess.move(trimmed) as Move;
    } catch {
      return null;
    }
  }

  undo(): Move | null {
    return this.chess.undo();
  }

  history(): string[] {
    return this.chess.history();
  }

  /**
   * Build the expected occupancy map after applying a verbose move to `base`.
   * Handles castling (rook jump), en passant (removes the passed pawn) and
   * captures/promotions (to-square simply takes the mover's color).
   * Writes into `out` (preallocated) and returns it.
   */
  static expectedMap(base: Uint8Array, m: Move, out: Uint8Array): Uint8Array {
    out.set(base);
    const from = indexOfSquare(m.from);
    const to = indexOfSquare(m.to);
    const color = m.color === 'w' ? WHITE : BLACK;
    out[from] = EMPTY;
    out[to] = color;
    if (m.flags.includes('k') || m.flags.includes('q')) {
      const key = (m.color === 'w' ? 'w' : 'b') + (m.flags.includes('k') ? 'k' : 'q');
      const rook = CASTLE_ROOK[key];
      if (rook) {
        out[rook[0]] = EMPTY;
        out[rook[1]] = color;
      }
    }
    if (m.flags.includes('e')) {
      // En passant: captured pawn sits on (to-file, from-rank).
      const toCol = to & 7;
      const fromRow = from >> 3;
      out[fromRow * 8 + toCol] = EMPTY;
    }
    return out;
  }

  /** Convenience: expected map in a fresh array (used by tests/UI). */
  expectedMapAfter(m: Move): Uint8Array {
    const base = this.occupancy(new Uint8Array(64));
    return GameState.expectedMap(base, m, new Uint8Array(64));
  }

  /** Human description: "queen g3->e4". */
  static describe(m: Move): string {
    const names: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    return `${names[m.piece] ?? m.piece} ${m.from}\u2192${m.to}`;
  }
}

/** Convert an occupancy map to the 8-char-per-rank FEN fragment (for debug). */
export function mapToFenFragment(map: Uint8Array): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const v = map[r * 8 + c] as number;
      if (v === EMPTY) {
        empty++;
      } else {
        if (empty) row += String(empty);
        empty = 0;
        row += v === WHITE ? 'P' : 'p';
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return rows.join('/');
}

/** Count differing squares between two maps. */
export function mapDistance(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) d++;
  return d;
}
