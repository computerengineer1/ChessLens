/**
 * Test harness: replays a PGN through the REAL production pipeline
 * (synthetic renderer -> warp -> classifier -> tracker) with no worker and
 * no DOM. Mirrors exactly what LiveScreen does in the browser:
 *   process frame -> tracker.onDetection -> confirmTruth to the model.
 */

import { Chess, type Move } from 'chess.js';
import type { Calibration, CornerQuad } from '../../src/types.js';
import type { TrackerEvent } from '../../src/game/tracker.js';
import { VisionPipeline } from '../../src/vision/pipeline.js';
import { renderFrameFromBoard, paintBoard, makeRng } from '../../src/vision/synth.js';
import { Tracker, type MoveConfirmedEvent } from '../../src/game/tracker.js';
import type { VisionModel } from '../../src/types.js';

export const TEST_W = 640;
export const TEST_H = 360;

export const TEST_CORNERS: CornerQuad = [126, 44, 524, 50, 612, 324, 32, 318];

export function testCalibration(corners: CornerQuad = TEST_CORNERS): Calibration {
  return { corners, srcW: TEST_W, srcH: TEST_H, cameraId: 'test', createdAt: 0 };
}

export interface ReplayCondition {
  seed: number;
  brightness?: number;
  contrast?: number;
  gradient?: number;
  noise?: number;
  blur?: number;
  corners?: CornerQuad;
  handFrames?: number;
  framesPerPly?: number;
}

export interface ReplayResult {
  events: TrackerEvent[];
  confirmed: MoveConfirmedEvent[];
  tracker: Tracker;
  pipeline: VisionPipeline;
  framesProcessed: number;
  classificationErrors: number;
  classificationTotal: number;
}

/** Play a PGN through the synthetic camera + tracker. */
export function replayGame(pgn: string, condition: ReplayCondition, model?: VisionModel): ReplayResult {
  const g = new Chess();
  g.loadPgn(pgn);
  const fens: string[] = [new Chess().fen()];
  const replay = new Chess();
  const moves: Move[] = [];
  for (const san of g.history()) {
    moves.push(replay.move(san) as Move);
    fens.push(replay.fen());
  }

  const pipeline = new VisionPipeline();
  pipeline.setCalibration(testCalibration(condition.corners));
  const tracker = new Tracker();

  const framesPerPly = condition.framesPerPly ?? 16;
  const handFrames = condition.handFrames ?? 4;
  const rng = makeRng(condition.seed);

  const paint = (fen: string): Uint8ClampedArray =>
    paintBoard(fen, {
      lightColor: [226, 202, 166],
      darkColor: [150, 108, 70],
      size: 512,
      rng: makeRng(condition.seed * 7 + fen.length),
      grain: 4,
      jitter: 0.02
    });

  const renderAt = (fen: string, board: Uint8ClampedArray, frameSeed: number, hand: boolean): Uint8ClampedArray => {
    const frng = makeRng(frameSeed * 7919 + condition.seed);
    const handBlob = hand
      ? { cx: TEST_W * (0.25 + frng() * 0.5), cy: TEST_H * (0.25 + frng() * 0.5), rx: TEST_W * 0.2, ry: TEST_H * 0.22, angle: frng() * Math.PI }
      : null;
    const frame = renderFrameFromBoard(board, 512, {
      fen,
      outW: TEST_W,
      outH: TEST_H,
      corners: condition.corners ?? TEST_CORNERS,
      seed: frameSeed,
      // Fixed camera condition per replay (per-frame randomness is opt-in
      // via the condition values themselves; leaving them undefined means
      // a sane, stable camera - like a real tripod shot).
      brightness: condition.brightness ?? 1.0,
      contrast: condition.contrast ?? 1.0,
      gradient: condition.gradient ?? 0.15,
      noise: condition.noise ?? 3,
      blur: condition.blur ?? 0.5,
      hand: handBlob
    });
    return frame.rgba;
  };

  // --- Learn phase: scan the start position under these conditions.
  const startBoard = paint(fens[0] as string);
  const truth0 = tracker.state.occupancy(new Uint8Array(64));
  const learnFrames = [];
  for (let i = 0; i < 6; i++) {
    learnFrames.push({ rgba: renderAt(fens[0] as string, startBoard, 1000 + i, false), w: TEST_W, h: TEST_H });
  }
  const learned = pipeline.learnFromFrames(learnFrames, truth0);
  if (!learned) throw new Error('harness: learning failed');
  if (model) pipeline.setModel(model);

  const events: TrackerEvent[] = [];
  const confirmed: MoveConfirmedEvent[] = [];
  let framesProcessed = 0;
  let classificationErrors = 0;
  let classificationTotal = 0;

  // Feed the start position so it stabilizes before the first move.
  for (let i = 0; i < 8; i++) {
    const rgba = renderAt(fens[0] as string, startBoard, 2000 + i, false);
    const det = pipeline.process(rgba, TEST_W, TEST_H);
    framesProcessed++;
    const ev = tracker.onDetection(det);
    if (ev) events.push(ev);
  }

  // --- Play each ply.
  let boardCache: Uint8ClampedArray | null = null;
  let boardFen = '';
  for (let ply = 0; ply < fens.length - 1; ply++) {
    const fen = fens[ply + 1] as string;
    if (fen !== boardFen || !boardCache) {
      boardCache = paint(fen);
      boardFen = fen;
    }
    const truth = moves[ply] ? expectedTruth(fens[ply + 1] as string) : new Uint8Array(64);
    for (let f = 0; f < framesPerPly; f++) {
      const withHand = f < handFrames;
      const rgba = renderAt(fen, boardCache, ply * 100 + f + 3000, withHand);
      const det = pipeline.process(rgba, TEST_W, TEST_H);
      framesProcessed++;
      // Accuracy is measured at steady state only: skip the two clean
      // frames right after the hand leaves, where the 3-frame temporal
      // smoother is still voting out the occluded observations.
      if (!withHand && f >= handFrames + 2 && det.modelReady) {
        for (let sIdx = 0; sIdx < 64; sIdx++) {
          if (det.occupancy[sIdx] !== truth[sIdx]) classificationErrors++;
          classificationTotal++;
        }
      }
      const ev = tracker.onDetection(det);
      if (ev) {
        events.push(ev);
        if (ev.type === 'move') {
          confirmed.push(ev);
          // Exactly like production: feed the truth back for EMA adaptation.
          pipeline.confirmTruth(tracker.lastConfirmed);
        }
      }
    }
    void rng;
  }

  return { events, confirmed, tracker, pipeline, framesProcessed, classificationErrors, classificationTotal };
}

function expectedTruth(fen: string): Uint8Array {
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

/** A random mid-game position reached by `n` random legal moves. */
export function randomFen(seed: number, n: number): string {
  const rng = makeRng(seed);
  const c = new Chess();
  for (let i = 0; i < n; i++) {
    const moves = c.moves({ verbose: true }) as Move[];
    if (moves.length === 0) break;
    const m = moves[Math.floor(rng() * moves.length) % moves.length] as Move;
    c.move({ from: m.from, to: m.to, promotion: m.promotion });
    if (c.isGameOver()) break;
  }
  return c.fen();
}
