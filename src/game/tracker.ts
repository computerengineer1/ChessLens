/**
 * Tracker: turns a stream of camera detections into confirmed chess moves.
 *
 * Pipeline per detection:
 *   1. Reject frames flagged as hand/occlusion or with too many changes.
 *   2. Require temporal stability (worker-side run length).
 *   3. Score every legal move by confidence-weighted mismatch cost against
 *      the observed occupancy map; accept when the best is cheap enough AND
 *      clearly better than the runner-up.
 *   4. Ambiguous => emit candidates for the confirm sheet.
 *   5. Nothing matches => 2-ply / 3-ply recovery search (missed plies).
 *   6. Still lost => ask the UI for a manual resync.
 */

import type { Move } from 'chess.js';
import type { DetectionResult } from '../types.js';
import { GameState, mapDistance } from './state.js';
import { searchSequences } from './recovery.js';

export interface TrackerConfig {
  /** Max single-move mismatch cost to accept. */
  acceptCost: number;
  /** Required margin between best and runner-up single move. */
  acceptMargin: number;
  /** Confidence below which an observation counts as "weak". */
  weakConfidence: number;
  /** Max sequence cost accepted during recovery. */
  recoveryAcceptCost: number;
  /** Required margin between best and runner-up recovery sequence. */
  recoveryMargin: number;
  /** Max plies searched during recovery. */
  recoveryDepth: number;
  /** Consecutive failed stable detections before declaring "lost". */
  lostAfter: number;
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  acceptCost: 1.8,
  acceptMargin: 0.9,
  weakConfidence: 0.5,
  recoveryAcceptCost: 2.4,
  recoveryMargin: 1.2,
  recoveryDepth: 3,
  lostAfter: 40
};

export type MoveReason = 'camera' | 'manual' | 'recovery';

export interface MoveConfirmedEvent {
  type: 'move';
  /** All plies applied by this event (length 1 normally, more after recovery). */
  moves: Move[];
  /** The last move of the sequence (the newly reached position). */
  move: Move;
  mover: 'w' | 'b';
  reason: MoveReason;
  /** Plies that were silently recovered (0 for a normal single move). */
  recovered: number;
  check: boolean;
  checkmate: boolean;
  stalemate: boolean;
  gameOver: boolean;
  fen: string;
  /** True when the accepted move was a promotion (auto-queen). */
  promotion: 'q' | 'r' | 'b' | 'n' | null;
  /** Alternative promotion choices when the accepted move promoted. */
  promotionAlternatives: Move[];
}

export interface AmbiguousEvent {
  type: 'ambiguous';
  candidates: Array<{ move: Move; cost: number }>;
}

export interface UnstableEvent {
  type: 'unstable';
  reason: 'hand' | 'too-many-changes' | 'settling';
  changedSquares: number;
}

export interface PromotionOnlyEvent {
  type: 'promotion-choice';
  moves: Move[];
}

export interface LostEvent {
  type: 'resync-needed';
  observed: Uint8Array;
  distance: number;
}

export type TrackerEvent =
  | MoveConfirmedEvent
  | AmbiguousEvent
  | UnstableEvent
  | LostEvent
  | { type: 'need-scan' }
  | { type: 'idle' };

export interface RankEntry {
  move: Move;
  cost: number;
}

export class Tracker {
  state: GameState;
  config: TrackerConfig;
  /** FEN the tracking session started from (for PGN export). */
  startFen: string;

  /** Occupancy of the last confirmed position. */
  lastConfirmed = new Uint8Array(64);
  private scratch = new Uint8Array(64);
  private failedStable = 0;
  private lastAmbiguousKey = '';
  /** Pending ambiguity the UI is currently asking about, if any. */
  pendingAmbiguous: RankEntry[] | null = null;
  history: Move[] = [];

  constructor(fen?: string, config?: Partial<TrackerConfig>) {
    this.state = new GameState(fen);
    this.startFen = this.state.fen();
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
    this.state.occupancy(this.lastConfirmed);
  }

  fen(): string {
    return this.state.fen();
  }

  reset(fen?: string): void {
    this.state = new GameState(fen);
    this.startFen = this.state.fen();
    this.state.occupancy(this.lastConfirmed);
    this.failedStable = 0;
    this.pendingAmbiguous = null;
    this.history = [];
  }

  /** Manually set the position (resync / analysis / editor). */
  setPosition(fen: string): boolean {
    try {
      const gs = new GameState(fen);
      void gs.fen(); // validates via chess.js constructor
      this.state = gs;
      this.startFen = gs.fen();
      this.history = [];
      this.state.occupancy(this.lastConfirmed);
      this.failedStable = 0;
      this.pendingAmbiguous = null;
      return true;
    } catch {
      return false;
    }
  }

  undoLast(): Move | null {
    const m = this.state.undo();
    this.state.occupancy(this.lastConfirmed);
    this.history.pop();
    this.failedStable = 0;
    this.pendingAmbiguous = null;
    return m;
  }

  /** User tapped a move on the virtual board / confirm sheet. */
  applyManual(from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n'): MoveConfirmedEvent | null {
    const legal = this.state.legalMoves();
    const m = legal.find((c) => c.from === from && c.to === to && (promotion ? c.promotion === promotion : !c.promotion))
      ?? legal.find((c) => c.from === from && c.to === to);
    if (!m) return null;
    const applied = this.commit([m], 'manual');
    return applied;
  }

  /** Feed one detection result; returns an event (or null when nothing to report). */
  onDetection(det: DetectionResult): TrackerEvent | null {
    if (!det.modelReady) return { type: 'need-scan' };

    const changed = mapDistance(det.occupancy, this.lastConfirmed);
    if (changed === 0) {
      this.failedStable = 0;
      this.pendingAmbiguous = null;
      this.lastAmbiguousKey = '';
      return null; // observation matches the confirmed position
    }

    if (det.handLikely) {
      return { type: 'unstable', reason: 'hand', changedSquares: changed };
    }
    if (!det.stable) {
      return {
        type: 'unstable',
        reason: changed > 4 ? 'too-many-changes' : 'settling',
        changedSquares: changed
      };
    }

    // Stable observation. A single move changes <=4 squares (castling);
    // more means missed plies or a position jump: go straight to recovery.
    if (changed > 4) {
      const rec = this.tryRecovery(det);
      if (rec) return rec;
      this.failedStable++;
      if (this.failedStable >= this.config.lostAfter) {
        this.failedStable = 0;
        return { type: 'resync-needed', observed: det.occupancy.slice(), distance: changed };
      }
      return null;
    }

    // ---- single-move inference -------------------------------------------
    const ranked = this.rankMoves(det.occupancy, det.confidence);
    const best = ranked[0];

    if (best && best.cost <= this.config.acceptCost) {
      // Exact ties first: promotions share one occupancy map, so their
      // costs are identical and must skip the margin gate.
      const tied = ranked.filter((r) => Math.abs(r.cost - best.cost) < 1e-6);
      const promoTied = tied.filter((r) => r.move.promotion);
      if (promoTied.length > 1) {
        const queen = tied.find((r) => r.move.promotion === 'q');
        const chosen = queen ?? best;
        const ev = this.commit([chosen.move], 'camera');
        if (ev) ev.promotionAlternatives = tied.map((r) => r.move);
        this.failedStable = 0;
        return ev;
      }
      // Distinct non-promotion moves with identical cost: the observation
      // cannot separate them - ask the user.
      if (tied.length > 1) {
        const cands = tied.slice(0, 3);
        const key = cands.map((r) => r.move.san).join(',');
        this.pendingAmbiguous = cands;
        if (key === this.lastAmbiguousKey) return null; // UI already showing
        this.lastAmbiguousKey = key;
        return { type: 'ambiguous', candidates: cands };
      }
      // Margin against the first candidate outside the tie set.
      const second = ranked[tied.length] ?? null;
      const marginOk = !second || second.cost - best.cost >= this.config.acceptMargin;
      if (marginOk) {
        this.failedStable = 0;
        return this.commit([best.move], 'camera');
      }
      const cands = ranked.slice(0, 3);
      const key = cands.map((r) => r.move.san).join(',');
      this.pendingAmbiguous = cands;
      if (key === this.lastAmbiguousKey) return null;
      this.lastAmbiguousKey = key;
      return { type: 'ambiguous', candidates: cands };
    }

    // ---- recovery: missed plies ------------------------------------------
    const rec = this.tryRecovery(det);
    if (rec) return rec;

    this.failedStable++;
    this.pendingAmbiguous = null;
    this.lastAmbiguousKey = '';
    if (this.failedStable >= this.config.lostAfter) {
      this.failedStable = 0;
      return { type: 'resync-needed', observed: det.occupancy.slice(), distance: changed };
    }
    return null;
  }

  /** 2-ply / 3-ply sequence search explaining the current observation. */
  private tryRecovery(det: DetectionResult): MoveConfirmedEvent | null {
    const costFn = (expected: Uint8Array): number =>
      this.mismatchCost(expected, det.occupancy, det.confidence);
    for (const depth of [2, 3]) {
      if (depth > this.config.recoveryDepth) break;
      const found = searchSequences(this.state, costFn, { depth, beam: 8, maxNodes: 12000 }, 2);
      const bestSeq = found[0];
      const secondSeq = found[1];
      if (bestSeq && bestSeq.cost <= this.config.recoveryAcceptCost) {
        const marginOk = !secondSeq || secondSeq.cost - bestSeq.cost >= this.config.recoveryMargin;
        if (marginOk) {
          this.failedStable = 0;
          return this.commit(bestSeq.seq, 'recovery');
        }
      }
    }
    return null;
  }


  resolveAmbiguous(index: number): MoveConfirmedEvent | null {
    const cands = this.pendingAmbiguous;
    if (!cands || index < 0 || index >= cands.length) return null;
    const chosen = cands[index];
    if (!chosen) return null;
    this.pendingAmbiguous = null;
    this.lastAmbiguousKey = '';
    return this.commit([chosen.move], 'manual');
  }

  /** Replace the auto-queen promotion with an under-promotion. */
  changePromotion(piece: 'q' | 'r' | 'b' | 'n'): MoveConfirmedEvent | null {
    const last = this.history[this.history.length - 1];
    if (!last || !last.promotion) return null;
    this.undoLast();
    return this.applyManual(last.from, last.to, piece);
  }

  /** Confidence-weighted mismatch cost between an expected and observed map. */
  mismatchCost(expected: Uint8Array, observed: Uint8Array, confidence: Float32Array): number {
    let cost = 0;
    const weak = this.config.weakConfidence;
    for (let s = 0; s < 64; s++) {
      const e = expected[s] as number;
      const o = observed[s] as number;
      if (e === o) continue;
      const c = confidence[s] as number;
      if (c >= weak) {
        cost += 0.6 + 0.9 * c; // confident disagreement is expensive
      } else {
        cost += 0.25; // blurry square: cheap disagreement
      }
    }
    return cost;
  }

  /** Rank all legal moves by mismatch cost (ascending). */
  rankMoves(observed: Uint8Array, confidence: Float32Array): RankEntry[] {
    const base = this.lastConfirmed;
    const out: RankEntry[] = [];
    for (const m of this.state.legalMoves()) {
      GameState.expectedMap(base, m, this.scratch);
      out.push({ move: m, cost: this.mismatchCost(this.scratch, observed, confidence) });
    }
    out.sort((a, b) => a.cost - b.cost);
    return out;
  }

  private commit(seq: Move[], reason: MoveReason): MoveConfirmedEvent | null {
    const applied: Move[] = [];
    for (const m of seq) {
      try {
        applied.push(this.state.applyMove(m));
      } catch {
        // Sequence became illegal mid-way (should not happen): roll back all.
        for (let i = 0; i < applied.length; i++) this.state.undo();
        return null;
      }
    }
    const last = applied[applied.length - 1];
    if (!last) return null;
    this.state.occupancy(this.lastConfirmed);
    this.history.push(...applied);
    this.pendingAmbiguous = null;
    this.lastAmbiguousKey = '';
    return {
      type: 'move',
      moves: applied,
      move: last,
      mover: last.color,
      reason,
      recovered: applied.length - 1,
      check: this.state.inCheck(),
      checkmate: this.state.isCheckmate(),
      stalemate: this.state.isStalemate(),
      gameOver: this.state.isGameOver(),
      fen: this.state.fen(),
      promotion: (last.promotion as 'q' | 'r' | 'b' | 'n' | undefined) ?? null,
      promotionAlternatives: []
    };
  }

  /** Serialize the confirmed move list as PGN text. */
  pgn(): string {
    const replay = new GameState(this.startFen);
    for (const m of this.history) replay.applyMove(m);
    return replay.chess.pgn();
  }
}
