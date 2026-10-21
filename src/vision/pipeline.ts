/**
 * VisionPipeline: frame -> warped planes -> features -> classification ->
 * stability tracking. Pure TypeScript with preallocated buffers; the exact
 * same code runs inside the vision worker (production) and inside vitest
 * (tests), so tests exercise the real pipeline.
 */

import {
  DEFAULT_THRESHOLDS,
  type Calibration,
  type DetectionResult,
  type VisionThresholds
} from '../types.js';
import { homographyFromQuads, type H3 } from './homography.js';
import {
  buildWarpLUT,
  downscaleRGBA,
  warpPlanes,
  warpRGBA,
  WARP_SIZE,
  type WarpLUT
} from './warp.js';
import {
  computeFeatures,
  computeFrameStats,
  fitPlaneTrend,
  computeSquareStats,
  createFeatureBuffers,
  skinFractionInChanged,
  type FeatureBuffers,
  type FrameStats
} from './features.js';
import {
  bootstrapTemplates,
  classifyAll,
  createModel,
  learnClassStats,
  modelFromSerializable,
  modelToSerializable,
  updateModel,
  type ClassifierModel
} from './occupancy.js';
import type { VisionModel } from '../types.js';

/** Processing resolution for detection frames. */
export const PROC_W = 640;
export const PROC_H = 360;

export interface PipelineOptions {
  /** Keep full-resolution warped RGBA for the debug view (costly; off by default). */
  debugPreview?: boolean;
}

export class VisionPipeline {
  /** Consecutive identical raw classifications before a square updates. */
  static readonly ADOPT_FRAMES = 3;
  private lut: WarpLUT | null = null;
  private calibration: Calibration | null = null;

  private gray = new Uint8Array(WARP_SIZE * WARP_SIZE);
  private sat = new Uint8Array(WARP_SIZE * WARP_SIZE);
  private cb = new Uint8Array(WARP_SIZE * WARP_SIZE);
  private cr = new Uint8Array(WARP_SIZE * WARP_SIZE);
  private rgbaSmall = new Uint8ClampedArray(PROC_W * PROC_H * 4);
  private previewRGBA: Uint8ClampedArray | null = null;
  private previewLUT: WarpLUT | null = null;

  private buf: FeatureBuffers = createFeatureBuffers();
  private stats: FrameStats = { median: 128, scale: 40, planeB: 0, planeC: 0 };
  model: ClassifierModel = createModel();
  thresholds: VisionThresholds = { ...DEFAULT_THRESHOLDS };

  private occupancy = new Uint8Array(64);
  /**
   * Temporal debounce: a square's smoothed state only follows the raw
   * classifier once the raw state repeats on two consecutive frames.
   * Period-2 noise oscillation can never flip the smoothed map, while a
   * real board change (which persists) shows up after 2 frames.
   */
  private rawPrev = new Uint8Array(64);
  private rawCur = new Uint8Array(64);
  /** Per-square adoption counter/candidate for the temporal filter. */
  private candCount = new Uint8Array(64);
  private candState = new Uint8Array(64);
  private confidence = new Float32Array(64);
  private prevOccupancy: Uint8Array | null = null;
  private runLength = 0;

  private frameId = 0;
  private options: PipelineOptions;

  constructor(options: PipelineOptions = {}) {
    this.options = options;
  }

  setOptions(options: PipelineOptions): void {
    this.options = options;
    if (!options.debugPreview) {
      this.previewRGBA = null;
      this.previewLUT = null;
    }
  }

  /** (Re)build the warp LUT from a calibration. Returns LUT coverage 0..1. */
  setCalibration(cal: Calibration): number {
    this.calibration = cal;
    // Scale calibration corners (full-res video coords) down to processing res.
    const sx = PROC_W / cal.srcW;
    const sy = PROC_H / cal.srcH;
    const srcQuad = cal.corners.map((v, i) => v * (i % 2 === 0 ? sx : sy));
    // Homography maps processing-frame coords -> canonical 512x512 board.
    const dstQuad = [0, 0, WARP_SIZE, 0, WARP_SIZE, WARP_SIZE, 0, WARP_SIZE];
    const H: H3 | null = homographyFromQuads(srcQuad, dstQuad);
    if (!H) {
      this.lut = null;
      return 0;
    }
    this.lut = buildWarpLUT(H, WARP_SIZE, WARP_SIZE, PROC_W, PROC_H);
    if (!this.lut) return 0;
    // Coverage metric for the calibration UI.
    let ok = 0;
    const n = WARP_SIZE * WARP_SIZE;
    for (let i = 0; i < n; i++) if (this.lut.coords[i * 2] >= 0) ok++;
    return ok / n;
  }

  hasCalibration(): boolean {
    return this.lut !== null;
  }

  setThresholds(t: Partial<VisionThresholds>): void {
    this.thresholds = { ...this.thresholds, ...t };
  }

  setModel(serialized: VisionModel): boolean {
    const m = modelFromSerializable(serialized);
    if (!m) return false;
    this.model = m;
    return true;
  }

  exportModel(): VisionModel {
    return modelToSerializable(this.model);
  }

  /**
   * Learn the classification model from an averaged frame of a KNOWN
   * position (ground-truth occupancy for all 64 squares).
   */
  learnFromFrame(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, truth: Uint8Array): boolean {
    if (!this.lut) return false;
    this.warpAndFeaturize(rgba, w, h);
    // Order matters: templates first (they define the feature space),
    // then recompute features with those templates, then class stats.
    fitPlaneTrend(this.buf, this.stats, truth); // exact mask available at scan time
    bootstrapTemplates(this.model, this.buf.squareMeanL, this.stats, truth);
    computeFeatures(this.gray, this.buf, this.model.templateZ, this.stats, this.thresholds.massThreshold);
    learnClassStats(this.model, this.buf.features, truth);
    this.resetStability();
    return true;
  }

  /** Average several frames then learn (reduces sensor noise at scan time). */
  learnFromFrames(
    frames: Array<{ rgba: Uint8ClampedArray | Uint8Array; w: number; h: number }>,
    truth: Uint8Array
  ): boolean {
    if (!this.lut || frames.length === 0) return false;
    if (frames.length === 1) {
      const f = frames[0]!;
      return this.learnFromFrame(f.rgba, f.w, f.h, truth);
    }
    const f0 = frames[0]!;
    const acc = new Float64Array(f0.rgba.length);
    for (const f of frames) {
      if (f.rgba.length !== acc.length) continue;
      for (let i = 0; i < acc.length; i++) acc[i] += f.rgba[i] as number;
    }
    const avg = new Uint8ClampedArray(acc.length);
    for (let i = 0; i < acc.length; i++) avg[i] = (acc[i] as number) / frames.length;
    return this.learnFromFrame(avg, f0.w, f0.h, truth);
  }

  /** Called by the tracker after a confirmed move: EMA template/class update. */
  confirmTruth(truth: Uint8Array): void {
    updateModel(
      this.model,
      this.buf.features,
      truth,
      this.occupancy,
      this.thresholds.templateEma,
      this.thresholds.classEma
    );
  }

  private countRawChanged(): number {
    let n = 0;
    for (let s = 0; s < 64; s++) if (this.rawCur[s] !== this.rawPrev[s]) n++;
    return n;
  }

  resetStability(): void {
    this.prevOccupancy = null;
    this.runLength = 0;
    this.rawPrev.fill(0);
    this.rawCur.fill(0);
    this.occupancy.fill(0);
    this.candCount.fill(0);
    this.candState.fill(255);
  }

  private warpAndFeaturize(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): void {
    const lut = this.lut;
    if (!lut) throw new Error('pipeline: no calibration');
    let src = rgba;
    if (w !== PROC_W || h !== PROC_H) {
      downscaleRGBA(rgba, w, h, this.rgbaSmall, PROC_W, PROC_H);
      src = this.rgbaSmall;
    }
    warpPlanes(lut, src, this.gray, this.sat, this.cb, this.cr);
    computeSquareStats(this.gray, this.sat, this.buf);
    computeFrameStats(this.buf, this.stats);
    // Remove lighting-direction drift: fit a luminance plane over the
    // squares that locally look empty (template-gated, label-free).
    fitPlaneTrend(this.buf, this.stats, null);
    computeFeatures(this.gray, this.buf, this.model.templateZ, this.stats, this.thresholds.massThreshold);
  }

  /**
   * Process one frame (any size >= PROC; it is downscaled internally).
   * Returns the detection result. The returned occupancy/confidence/features
   * arrays are OWNED by the pipeline - copy or transfer before reuse.
   */
  process(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): DetectionResult {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.frameId++;
    if (!this.lut) {
      return {
        frameId: this.frameId,
        occupancy: new Uint8Array(64),
        confidence: new Float32Array(64),
        features: new Float32Array(64 * 6),
        changedSquares: 64,
        stable: false,
        handLikely: false,
        normMedian: 0,
        normScale: 0,
        timeMs: 0,
        modelReady: false
      };
    }
    this.warpAndFeaturize(rgba, w, h);

    // Classify into the current raw slot, then debounce per square.
    this.rawPrev.set(this.rawCur);
    classifyAll(this.model, this.buf.features, this.rawCur, this.confidence, this.thresholds.confidenceTemperature);
    // While a skin-covered blob is sweeping the grid (large raw change plus
    // skin chroma), freeze the smoothed map entirely so occlusion frames
    // cannot poison it; it resumes two frames after the hand leaves.
    const rawChanged = this.countRawChanged();
    const skinNow = skinFractionInChanged(this.cb, this.cr, this.sat, this.rawPrev, this.rawCur);
    const occluded = rawChanged > this.thresholds.maxSimultaneousChanges && skinNow > this.thresholds.skinFraction;
    if (!occluded) {
      // Adopt a square's new state only after the raw classifier repeats it
      // for ADOPT_FRAMES consecutive frames. Period-2 noise oscillation can
      // never reach the counter, so borderline squares keep their last
      // stable value instead of flapping.
      for (let s = 0; s < 64; s++) {
        const cur = this.rawCur[s] as number;
        if (cur === this.occupancy[s]) {
          this.candCount[s] = 0;
          this.candState[s] = 255;
          continue;
        }
        if (this.candState[s] === cur) {
          this.candCount[s]++;
        } else {
          this.candState[s] = cur;
          this.candCount[s] = 1;
        }
        if (this.candCount[s] >= VisionPipeline.ADOPT_FRAMES) {
          this.occupancy[s] = cur;
          this.candCount[s] = 0;
          this.candState[s] = 255;
        }
      }
    }

    // Stability: run length of identical (smoothed) argmax maps.
    let changed = 0;
    const prevBefore = this.prevOccupancy;
    if (this.prevOccupancy) {
      for (let s = 0; s < 64; s++) {
        if (this.prevOccupancy[s] !== this.occupancy[s]) changed++;
      }
      if (changed === 0) this.runLength++;
      else this.runLength = 1;
    } else {
      this.runLength = 1;
    }
    if (!this.prevOccupancy) this.prevOccupancy = new Uint8Array(64);
    this.prevOccupancy.set(this.occupancy);
    const stable = this.runLength >= this.thresholds.stableFrames;

    // Hand/occlusion heuristic: a moving hand changes many squares at once
    // AND shows skin chroma inside the changed region. Requiring both keeps
    // wooden boards (whose chroma overlaps skin) and single-frame noise
    // bursts from ever flagging a hand.
    const skin = skinFractionInChanged(this.cb, this.cr, this.sat, prevBefore, this.occupancy);
    const handLikely =
      changed > this.thresholds.maxSimultaneousChanges && skin > this.thresholds.skinFraction;

    if (this.options.debugPreview && this.calibration) {
      if (!this.previewLUT) {
        const sx = this.calibration.srcW / PROC_W;
        const sy = this.calibration.srcH / PROC_H;
        const srcQuad = this.calibration.corners.map((v, i) => v * (i % 2 === 0 ? sx : sy));
        const Hfull = homographyFromQuads(srcQuad, [0, 0, WARP_SIZE, 0, WARP_SIZE, WARP_SIZE, 0, WARP_SIZE]);
        if (Hfull) this.previewLUT = buildWarpLUT(Hfull, WARP_SIZE, WARP_SIZE, this.calibration.srcW, this.calibration.srcH);
      }
      // The small (processing-res) frame is warped for the preview to stay cheap.
      if (!this.previewRGBA) this.previewRGBA = new Uint8ClampedArray(WARP_SIZE * WARP_SIZE * 4);
    }

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      frameId: this.frameId,
      occupancy: this.occupancy,
      confidence: this.confidence,
      features: this.buf.features,
      changedSquares: changed,
      stable,
      handLikely,
      normMedian: this.stats.median,
      normScale: this.stats.scale,
      timeMs: t1 - t0,
      modelReady: this.model.initialized
    };
  }

  /** Warped RGBA preview for the debug view (only when debugPreview is on). */
  renderPreview(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8ClampedArray | null {
    if (!this.previewLUT || !this.previewRGBA) return null;
    if (w !== this.previewLUT.srcW || h !== this.previewLUT.srcH) {
      // Preview LUT is full-res; only full-res frames can feed it.
      return null;
    }
    warpRGBA(this.previewLUT, rgba, this.previewRGBA);
    return this.previewRGBA;
  }
}
