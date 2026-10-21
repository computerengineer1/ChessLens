/**
 * Demo mode (?demo=1 or `--demo` in Electron): plays a synthetic PGN through
 * the EXACT production pipeline - frames are rendered by the synthetic board
 * renderer, pushed as ImageBitmaps into the vision worker, classified,
 * tracked, and analyzed. No camera, no board needed.
 *
 * Each ply is shown as ~14 frames at 10 Hz; the first frames of every ply
 * carry a skin-tone "hand" blob so hand rejection is exercised too.
 */

import { Chess } from 'chess.js';
import type { CornerQuad } from '../types.js';
import { makeRng, paintBoard, renderFrameFromBoard } from '../vision/synth.js';
import type { DemoFeed, LiveScreen } from '../ui/live.js';
import type { LogPanel } from '../ui/logpanel.js';

export const DEMO_W = 640;
export const DEMO_H = 360;

/** The Opera Game (Morphy vs Duke of Brunswick / Count Isouard, 1858). */
export const DEMO_PGN = [
  '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6',
  '7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7',
  '12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8',
  '17. Rd8#'
].join(' ');

/** Fixed "camera" corners for the synthetic board (strong perspective). */
export const DEMO_CORNERS: CornerQuad = [128, 46, 522, 52, 610, 322, 34, 316];

export interface DemoOptions {
  pgn?: string;
  framesPerPly?: number;
  handFrames?: number;
  seed?: number;
}

export class DemoPlayer implements DemoFeed {
  private live: LiveScreen | null = null;
  private log: LogPanel;
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: Required<DemoOptions>;
  private fens: string[] = [];
  private ply = -1; // -2: learning phase, -1: pre-roll, >=0: playing fens[ply+1]
  private frameInPly = 0;
  private boardCache: Uint8ClampedArray | null = null;
  private boardFen = '';
  stopped = false;

  constructor(log: LogPanel, opts: DemoOptions = {}) {
    this.log = log;
    this.opts = {
      pgn: opts.pgn ?? DEMO_PGN,
      framesPerPly: opts.framesPerPly ?? 14,
      handFrames: opts.handFrames ?? 5,
      seed: opts.seed ?? 777
    };
  }

  attach(live: LiveScreen): void {
    this.live = live;
    const g = new Chess();
    try {
      g.loadPgn(this.opts.pgn);
    } catch {
      this.log.log('demo: invalid PGN', 'error');
      return;
    }
    // Rebuild the FEN sequence.
    const replay = new Chess();
    this.fens = [replay.fen()];
    for (const san of g.history()) {
      replay.move(san);
      this.fens.push(replay.fen());
    }
    // Calibrate with the fixed synthetic camera corners (full "video" size).
    live.applyCalibration(
      {
        corners: DEMO_CORNERS,
        srcW: DEMO_W,
        srcH: DEMO_H,
        cameraId: 'demo',
        createdAt: Date.now()
      },
      false
    );
    this.log.log(`demo: loaded ${this.fens.length - 1} plies from PGN`);
    // Start the scan phase: learn from the start position.
    this.ply = -2;
    this.frameInPly = 0;
    live.startDemoScan();
    this.timer = setInterval(() => void this.tick(), 100);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private currentTargetFen(): string {
    if (this.ply < 0) return this.fens[0] as string;
    return this.fens[Math.min(this.ply + 1, this.fens.length - 1)] as string;
  }

  private renderFrame(seedOffset: number, withHand: boolean): ImageData | null {
    const fen = this.currentTargetFen();
    if (fen !== this.boardFen || !this.boardCache) {
      const rng = makeRng(this.opts.seed + seedOffset);
      this.boardCache = paintBoard(fen, {
        lightColor: [228, 205, 168],
        darkColor: [150, 108, 70],
        size: 512,
        rng,
        grain: 4,
        jitter: 0.02
      });
      this.boardFen = fen;
    }
    const rng = makeRng(this.opts.seed * 31 + seedOffset * 7919);
    const hand = withHand
      ? {
          cx: DEMO_W * (0.3 + rng() * 0.4),
          cy: DEMO_H * (0.3 + rng() * 0.4),
          rx: DEMO_W * 0.18,
          ry: DEMO_H * 0.2,
          angle: rng() * Math.PI
        }
      : null;
    const frame = renderFrameFromBoard(this.boardCache, 512, {
      fen,
      outW: DEMO_W,
      outH: DEMO_H,
      corners: DEMO_CORNERS,
      seed: this.opts.seed + seedOffset,
      brightness: 1.0,
      contrast: 1.0,
      gradient: 0.12,
      noise: 3 + rng() * 3,
      blur: rng() < 0.3 ? 1 : 0,
      hand
    });
    return new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.w, frame.h);
  }

  private async pushFrame(seedOffset: number, withHand: boolean): Promise<void> {
    const img = this.renderFrame(seedOffset, withHand);
    if (!img) return;
    const bmp = await createImageBitmap(img);
    if (this.stopped || !this.live) {
      bmp.close();
      return;
    }
    await this.live.pushDemoFrame(bmp);
  }

  private async tick(): Promise<void> {
    if (!this.live || this.stopped) return;
    if (this.ply === -2) {
      // Learning phase: feed clean start-position frames (worker averages 8).
      await this.pushFrame(this.frameInPly + 1, false);
      this.frameInPly++;
      if (this.frameInPly >= 10) {
        this.ply = -1;
        this.frameInPly = 0;
      }
      return;
    }
    if (this.ply === -1) {
      // Pre-roll: let the start position stabilize and the engine warm up.
      await this.pushFrame(this.frameInPly + 50, false);
      this.frameInPly++;
      if (this.frameInPly >= 8) {
        this.ply = 0;
        this.frameInPly = 0;
      }
      return;
    }
    const withHand = this.frameInPly < this.opts.handFrames;
    await this.pushFrame(this.ply * 100 + this.frameInPly, withHand);
    this.frameInPly++;
    if (this.frameInPly >= this.opts.framesPerPly) {
      this.ply++;
      this.frameInPly = 0;
      if (this.ply >= this.fens.length) {
        this.log.log('demo: game complete - replay finished', 'info');
        this.stop();
        return;
      }
    }
  }
}
