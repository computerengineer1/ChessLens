import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { VisionPipeline } from '../src/vision/pipeline.js';
import { homographyFromQuads } from '../src/vision/homography.js';
import { buildWarpLUT } from '../src/vision/warp.js';
import { paintBoard, renderFrameFromBoard, makeRng } from '../src/vision/synth.js';
import { testCalibration, TEST_W, TEST_H, TEST_CORNERS } from './helpers/harness.js';

/**
 * Performance budget: vision detection under 15 ms per frame.
 * Measured on the CI/dev machine (typically weaker than a mid-range phone
 * webview, which JITs the same typed-array code at least as well).
 */
describe('performance budgets', () => {
  it('vision detection stays under 15 ms average at 640x360', () => {
    const pipeline = new VisionPipeline();
    pipeline.setCalibration(testCalibration(TEST_CORNERS));
    const startFen = new Chess().fen();
    const truth = new Uint8Array(64);
    const b = new Chess(startFen).board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = b[r]?.[c];
        if (p) truth[r * 8 + c] = p.color === 'w' ? 1 : 2;
      }
    }
    const board = paintBoard(startFen, {
      lightColor: [226, 202, 166],
      darkColor: [150, 108, 70],
      size: 512,
      rng: makeRng(1),
      grain: 4,
      jitter: 0.02
    });
    const frames = [];
    for (let i = 0; i < 6; i++) {
      frames.push({
        rgba: renderFrameFromBoard(board, 512, {
          fen: startFen, outW: TEST_W, outH: TEST_H, corners: TEST_CORNERS,
          seed: i + 1, brightness: 1, contrast: 1, gradient: 0.15, noise: 3, blur: 0.5
        }).rgba,
        w: TEST_W,
        h: TEST_H
      });
    }
    expect(pipeline.learnFromFrames(frames, truth)).toBe(true);

    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      const rgba = renderFrameFromBoard(board, 512, {
        fen: startFen, outW: TEST_W, outH: TEST_H, corners: TEST_CORNERS,
        seed: 100 + i, brightness: 1, contrast: 1, gradient: 0.15, noise: 3, blur: 0.5
      }).rgba;
      const t0 = performance.now();
      pipeline.process(rgba, TEST_W, TEST_H);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    console.info(`vision budget: avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (budget 15 ms avg)`);
    expect(avg).toBeLessThan(15);
    // p95 allowance for scheduler jitter on shared CI runners.
    expect(p95).toBeLessThan(40);
  }, 120000);

  it('warp LUT build is a one-time cost under 50 ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) {
      const H = homographyFromQuads(TEST_CORNERS as unknown as number[], [0, 0, 512, 0, 512, 512, 0, 512]);
      if (!H) throw new Error('homography failed');
      const lut = buildWarpLUT(H, 512, 512, TEST_W, TEST_H);
      if (!lut) throw new Error('lut failed');
    }
    const per = (performance.now() - t0) / 5;
    console.info(`LUT build: ${per.toFixed(2)} ms (one-time per calibration)`);
    expect(per).toBeLessThan(50);
  });
});
