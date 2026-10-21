import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { VisionPipeline } from '../src/vision/pipeline.js';
import { paintBoard, renderFrameFromBoard, makeRng } from '../src/vision/synth.js';
import { randomFen, testCalibration, TEST_W, TEST_H } from './helpers/harness.js';
import type { CornerQuad } from '../src/types.js';

/** Occupancy ground truth for a FEN. */
function truthOf(fen: string): Uint8Array {
  const c = new Chess(fen);
  const map = new Uint8Array(64);
  const board = c.board();
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 8; col++) {
      const p = board[r]?.[col];
      if (p) map[r * 8 + col] = p.color === 'w' ? 1 : 2;
    }
  }
  return map;
}

interface Condition {
  seed: number;
  brightness: number;
  contrast: number;
  gradient: number;
  noise: number;
  blur: number;
  corners: CornerQuad;
}

function makeCondition(seed: number): Condition {
  const rng = makeRng(seed);
  const j = (): number => (rng() - 0.5) * 30;
  return {
    seed,
    brightness: 0.65 + rng() * 0.75, // dim office .. sunny window
    contrast: 0.85 + rng() * 0.3,
    gradient: rng() * 0.35, // side lighting
    noise: 2 + rng() * 9, // sensor noise
    blur: rng() < 0.45 ? 0 : 1 + rng(), // soft focus
    corners: [120 + j(), 40 + j(), 528 + j(), 46 + j(), 616 + j(), 328 + j(), 28 + j(), 322 + j()]
  };
}

function runAccuracy(cond: Condition, positions: string[]): { correct: number; total: number } {
  const pipeline = new VisionPipeline();
  pipeline.setCalibration(testCalibration(cond.corners));
  const startFen = new Chess().fen();

  // Self-supervised scan of the start position under these conditions.
  const frames = [];
  const startBoard = paintBoard(startFen, {
    lightColor: [226, 202, 166],
    darkColor: [150, 108, 70],
    size: 512,
    rng: makeRng(cond.seed * 3),
    grain: 4,
    jitter: 0.02
  });
  for (let i = 0; i < 8; i++) {
    frames.push(
      renderBoard(cond, startBoard, startFen, 500 + i, frames.length)
    );
  }
  const ok = pipeline.learnFromFrames(frames.map((f) => ({ rgba: f, w: TEST_W, h: TEST_H })), truthOf(startFen));
  expect(ok).toBe(true);

  let correct = 0;
  let total = 0;
  for (const fen of positions) {
    const truth = truthOf(fen);
    const board = paintBoard(fen, {
      lightColor: [226, 202, 166],
      darkColor: [150, 108, 70],
      size: 512,
      rng: makeRng(cond.seed * 5 + fen.length),
      grain: 4,
      jitter: 0.02
    });
    // 8 frames per position; the first four cover the temporal filter's
    // adoption latency (3 frames) plus one margin frame. Accuracy is a
    // steady-state property, so only frames 4..7 are counted.
    for (let i = 0; i < 8; i++) {
      const rgba = renderBoard(cond, board, fen, 900 + i, i);
      const det = pipeline.process(rgba, TEST_W, TEST_H);
      if (i >= 4) {
        for (let s = 0; s < 64; s++) {
          total++;
          if (det.occupancy[s] === truth[s]) correct++;
        }
      }
      // Adapt like production does after each confirmed move.
      pipeline.confirmTruth(truth);
    }
  }
  return { correct, total };
}

function renderBoard(
  cond: Condition,
  board: Uint8ClampedArray,
  fen: string,
  seed: number,
  variant: number
): Uint8ClampedArray {
  const rng = makeRng(seed * 131 + variant * 17 + cond.seed);
  return renderFrameFromBoard(board, 512, {
    fen,
    outW: TEST_W,
    outH: TEST_H,
    corners: cond.corners,
    seed,
    brightness: cond.brightness * (0.94 + rng() * 0.12), // exposure wobble
    contrast: cond.contrast,
    gradient: cond.gradient * (0.8 + rng() * 0.4),
    noise: cond.noise,
    blur: cond.blur
  }).rgba;
}

describe('square classification accuracy (>=98%)', () => {
  const conditions = [11, 22, 33, 44, 55].map(makeCondition);

  it.each(conditions.map((c, i) => [i + 1, c] as const))(
    'condition %i: randomized lighting/noise/blur/perspective',
    (_i, cond) => {
      const positions = [101, 202, 303, 404].map((s) => randomFen(cond.seed + s, 12 + (s % 20)));
      const { correct, total } = runAccuracy(cond, positions);
      const acc = correct / total;
      expect(acc).toBeGreaterThanOrEqual(0.98);
    },
    120000
  );

  it('aggregate across all conditions', () => {
    let correct = 0;
    let total = 0;
    for (const cond of conditions) {
      const positions = [911, 912].map((s) => randomFen(cond.seed + s, 16));
      const r = runAccuracy(cond, positions);
      correct += r.correct;
      total += r.total;
    }
    const acc = correct / total;
    expect(acc).toBeGreaterThanOrEqual(0.98);
  }, 240000);
});
