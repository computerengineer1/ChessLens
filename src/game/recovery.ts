/**
 * Recovery: when no single legal move explains the observed board, search
 * 2-ply and 3-ply sequences (the tracker missed one or more plies, e.g. the
 * app was backgrounded or the board was occluded during two fast moves).
 *
 * Beam search over legal sequences with a cheap incremental occupancy cost.
 */

import type { Move } from 'chess.js';
import { GameState } from './state.js';

export interface CostFn {
  /** Mismatch cost of an expected occupancy map vs the observation. */
  (expected: Uint8Array): number;
}

export interface RecoveryResult {
  seq: Move[];
  cost: number;
  nodes: number;
}

export interface RecoveryOptions {
  /** Maximum plies to search (2 or 3). */
  depth: number;
  /** Beam width kept per ply. */
  beam?: number;
  /** Hard node budget. */
  maxNodes?: number;
}

/**
 * Search sequences of length exactly `depth` from the current state.
 * Returns up to `results` best sequences sorted by cost (cheapest first),
 * computed on a cloned game so the caller's state is untouched.
 */
export function searchSequences(
  state: GameState,
  cost: CostFn,
  options: RecoveryOptions,
  results = 3
): RecoveryResult[] {
  const depth = Math.max(1, options.depth);
  const beam = options.beam ?? 10;
  const maxNodes = options.maxNodes ?? 20000;
  const scratch = new Uint8Array(64);
  const base = new Uint8Array(64);
  const best: RecoveryResult[] = [];
  let nodes = 0;

  // movesByLevel[ply] holds the move lists captured along the beam paths.
  interface BeamEntry {
    moves: Move[]; // sequence of applied verbose moves
    cost: number; // cost of the position after the sequence
  }

  let current: BeamEntry[] = [{ moves: [], cost: Infinity }];

  for (let ply = 0; ply < depth; ply++) {
    const candidates: BeamEntry[] = [];
    for (const entry of current) {
      // Rebuild the position for this entry.
      const game = new GameState(state.fen());
      for (const m of entry.moves) game.applyMove(m);
      if (game.isGameOver() && ply < depth - 1) continue;
      game.occupancy(base);
      const moves = game.legalMoves();
      for (const m of moves) {
        if (nodes++ > maxNodes) break;
        GameState.expectedMap(base, m, scratch);
        const c = cost(scratch);
        candidates.push({ moves: [...entry.moves, m], cost: c });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
    current = candidates.slice(0, beam);
    if (current.length === 0) break;
  }

  const seen = new Set<string>();
  for (const entry of current) {
    const key = entry.moves.map((m) => m.san).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    best.push({ seq: entry.moves, cost: entry.cost, nodes });
    if (best.length >= results) break;
  }
  return best;
}
