import { describe, expect, it } from 'vitest';
import type { Move } from 'chess.js';
import { Tracker } from '../src/game/tracker.js';
import type { DetectionResult } from '../src/types.js';

/** Build a perfect detection (conf 0.95 everywhere) for an occupancy map. */
function det(occupancy: Uint8Array, stable = true, handLikely = false): DetectionResult {
  return {
    frameId: 1,
    occupancy,
    confidence: new Float32Array(64).fill(0.95),
    features: new Float32Array(64 * 6),
    changedSquares: 0,
    stable,
    handLikely,
    normMedian: 128,
    normScale: 40,
    timeMs: 1,
    modelReady: true
  };
}

function mapFromFen(fen: string): Uint8Array {
  // Occupancy-only FEN parse (pieces -> colors).
  const map = new Uint8Array(64);
  const placement = fen.split(' ')[0] as string;
  const rows = placement.split('/');
  rows.forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) c += Number(ch);
      else {
        map[r * 8 + c] = ch === ch.toUpperCase() ? 1 : 2;
        c++;
      }
    }
  });
  return map;
}

describe('tracker move inference', () => {
  it('confirms a single legal move from a clean observation', () => {
    const t = new Tracker();
    const after = mapFromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    const ev = t.onDetection(det(after));
    expect(ev?.type).toBe('move');
    if (ev?.type === 'move') expect(ev.move.san).toBe('e4');
  });

  it('rejects unstable and hand-flagged frames', () => {
    const t = new Tracker();
    const after = mapFromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(t.onDetection(det(after, false))?.type).toBe('unstable');
    expect(t.onDetection(det(after, true, true))?.type).toBe('unstable');
    expect(t.history.length).toBe(0);
  });

  it('reports too-many-changes while a wild observation is still settling', () => {
    const t = new Tracker();
    const broken = mapFromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    broken[0] = 0;
    broken[1] = 0;
    broken[2] = 0;
    const ev = t.onDetection(det(broken, false));
    expect(ev?.type).toBe('unstable');
    if (ev?.type === 'unstable') expect(ev.reason).toBe('too-many-changes');
  });

  it('asks the user when two hypotheses are equally cheap (blurry squares)', () => {
    const t = new Tracker('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    // Observation: pawn gone from e2, but e3/e4 readings are low-confidence
    // (blur). Both e2-e4 and e2-e3 explain it at identical tiny cost, and
    // the margin to the next hypothesis is below the acceptance margin.
    const obs = mapFromFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
    const conf = new Float32Array(64).fill(0.95);
    conf[36] = 0.2; // e4
    conf[44] = 0.2; // e3
    const d = det(obs);
    d.confidence = conf;
    const ev = t.onDetection(d);
    expect(ev?.type).toBe('ambiguous');
    if (ev?.type === 'ambiguous') {
      const sans = ev.candidates.map((c) => c.move.san);
      expect(sans).toContain('e4');
      expect(sans).toContain('e3');
      // Resolving via the sheet commits the chosen move.
      const idx = sans.indexOf('e4');
      const done = t.resolveAmbiguous(idx);
      expect(done?.move.san).toBe('e4');
    }
  });

  it('applyManual accepts tapped moves and updates the confirmed map', () => {
    const t = new Tracker();
    const ev = t.applyManual('e2', 'e4');
    expect(ev?.type).toBe('move');
    expect(t.fen().startsWith('rnbqkbnr/pppppppp/8/8/4P3')).toBe(true);
    expect(t.lastConfirmed[36]).toBe(1); // e4 occupied by white
  });

  it('undo and setPosition keep tracker and confirmed map consistent', () => {
    const t = new Tracker();
    t.applyManual('e2', 'e4');
    t.applyManual('e7', 'e5');
    t.undoLast();
    expect(t.history.map((m: Move) => m.san).join(' ')).toBe('e4');
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1';
    expect(t.setPosition(fen)).toBe(true);
    expect(t.fen()).toBe(fen);
    expect(t.setPosition('not a fen')).toBe(false);
  });

  it('pgn() exports the confirmed move list', () => {
    const t = new Tracker();
    t.applyManual('e2', 'e4');
    t.applyManual('e7', 'e5');
    expect(t.pgn()).toContain('1. e4 e5');
  });
});
