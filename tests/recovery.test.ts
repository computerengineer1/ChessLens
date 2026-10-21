import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { VisionPipeline } from '../src/vision/pipeline.js';
import { paintBoard, renderFrameFromBoard, makeRng } from '../src/vision/synth.js';
import { Tracker } from '../src/game/tracker.js';
import { GameState, mapDistance } from '../src/game/state.js';
import { testCalibration, TEST_W, TEST_H, TEST_CORNERS } from './helpers/harness.js';

function truthOf(fen: string): Uint8Array {
  const c = new Chess(fen);
  const m = new Uint8Array(64);
  const b = c.board();
  for (let r = 0; r < 8; r++) {
    for (let col = 0; col < 8; col++) {
      const p = b[r]?.[col];
      if (p) m[r * 8 + col] = p.color === 'w' ? 1 : 2;
    }
  }
  return m;
}

interface Rig {
  pipeline: VisionPipeline;
  tracker: Tracker;
  render: (fen: string, seed: number, hand: boolean) => Uint8ClampedArray;
  feed: (fen: string, seedBase: number, handFrames?: number, cleanFrames?: number) => void;
}

function makeRig(seed: number): Rig {
  const pipeline = new VisionPipeline();
  pipeline.setCalibration(testCalibration(TEST_CORNERS));
  const tracker = new Tracker();
  const render = (fen: string, s: number, hand: boolean): Uint8ClampedArray => {
    const board = paintBoard(fen, {
      lightColor: [226, 202, 166],
      darkColor: [150, 108, 70],
      size: 512,
      rng: makeRng(seed * 5 + fen.length),
      grain: 4,
      jitter: 0.02
    });
    const r2 = makeRng(s * 7919 + seed);
    return renderFrameFromBoard(board, 512, {
      fen,
      outW: TEST_W,
      outH: TEST_H,
      corners: TEST_CORNERS,
      seed: s,
      brightness: 1.0,
      contrast: 1.0,
      gradient: 0.15,
      noise: 3,
      blur: 0.5,
      hand: hand
        ? { cx: TEST_W * (0.3 + r2() * 0.4), cy: TEST_H * (0.3 + r2() * 0.4), rx: TEST_W * 0.2, ry: TEST_H * 0.22, angle: r2() * Math.PI }
        : null
    }).rgba;
  };
  const startFen = new Chess().fen();
  const learn = [];
  for (let i = 0; i < 6; i++) learn.push({ rgba: render(startFen, 100 + i, false), w: TEST_W, h: TEST_H });
  pipeline.learnFromFrames(learn, truthOf(startFen));
  const feed = (fen: string, seedBase: number, handFrames = 4, cleanFrames = 12): void => {
    for (let f = 0; f < handFrames + cleanFrames; f++) {
      const det = pipeline.process(render(fen, seedBase + f, f < handFrames), TEST_W, TEST_H);
      const ev = tracker.onDetection(det);
      if (ev?.type === 'move') pipeline.confirmTruth(tracker.lastConfirmed);
    }
  };
  feed(startFen, 500);
  return { pipeline, tracker, render, feed };
}

describe('recovery and occlusion handling', () => {
  it('recovers a missed ply (2-ply search) when frames were dropped', () => {
    const rig = makeRig(9001);
    // Play e4 but DO NOT feed it; feed only the position after e4 e5.
    const g = new Chess();
    g.move('e4');
    g.move('e5');
    rig.feed(g.fen(), 7000);
    // The tracker should have recovered both plies in one event.
    expect(rig.tracker.history.map((m) => m.san).join(' ')).toBe('e4 e5');
  }, 120000);

  it('hand occlusion frames never confirm a wrong move', () => {
    const rig = makeRig(9002);
    const g = new Chess();
    g.move('e4');
    // Feed a long hand-only sequence over the START position: nothing may be
    // confirmed, and afterwards the real move still confirms normally.
    for (let f = 0; f < 14; f++) {
      const det = rig.pipeline.process(rig.render(new Chess().fen(), 8000 + f, true), TEST_W, TEST_H);
      const ev = rig.tracker.onDetection(det);
      expect(ev?.type === 'move').toBe(false);
    }
    rig.feed(g.fen(), 8500);
    expect(rig.tracker.history.map((m) => m.san).join(' ')).toBe('e4');
  }, 120000);

  it('reports resync-needed after long unexplainable observations', () => {
    const rig = makeRig(9003);
    // Teleport to an unrelated position: no 1..3-ply sequence explains it.
    const weird = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1';
    let resync = false;
    for (let round = 0; round < 6 && !resync; round++) {
      for (let f = 0; f < 14; f++) {
        const det = rig.pipeline.process(rig.render(weird, 9000 + round * 20 + f, false), TEST_W, TEST_H);
        const ev = rig.tracker.onDetection(det);
        if (ev?.type === 'resync-needed') resync = true;
      }
    }
    expect(resync).toBe(true);
    // Resync by FEN restores tracking.
    expect(rig.tracker.setPosition(weird)).toBe(true);
    expect(mapDistance(rig.tracker.lastConfirmed, truthOf(weird))).toBe(0);
  }, 180000);
});

describe('game state utilities', () => {
  it('expectedMap handles castling, en passant and captures', () => {
    const g = new GameState();
    const seq = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'];
    for (const s of seq) g.applyUciOrSan(s);
    const base = new GameState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    void base;
    const map = g.occupancy(new Uint8Array(64));
    // After O-O: king g1 (idx 62? g1 = row7,col6 = 62), rook f1 (61).
    expect(map[62]).toBe(1); // g1 king
    expect(map[61]).toBe(1); // f1 rook
    expect(map[60]).toBe(0); // e1 empty
    expect(map[63]).toBe(0); // h1 empty
  });

  it('expectedMap matches chess.js board for every legal move of a midgame', () => {
    const g = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1');
    const state = new GameState(g.fen());
    const base = state.occupancy(new Uint8Array(64));
    for (const m of g.moves({ verbose: true })) {
      const expected = GameState.expectedMap(base, m, new Uint8Array(64));
      const after = new Chess(m.after);
      const truth = new Uint8Array(64);
      const board = after.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r]?.[c];
          if (p) truth[r * 8 + c] = p.color === 'w' ? 1 : 2;
        }
      }
      expect(Array.from(expected)).toEqual(Array.from(truth));
    }
  });
});
