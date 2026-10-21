/// <reference lib="webworker" />
/**
 * Vision Web Worker.
 *
 * Owns the VisionPipeline and all heavy buffers. The main thread sends
 * ImageBitmaps (transferable) at ~10 Hz; this worker downscales to 640x360
 * on an OffscreenCanvas, warps through the calibration LUT, extracts
 * features, classifies all 64 squares and posts back a DetectionResult with
 * the typed arrays transferred (zero copy). The only per-frame allocation is
 * the native ImageData from getImageData(); all vision buffers are reused.
 *
 * Also implements the start-position scan: on {type:'learn', truth} the next
 * `learnFrames` frames are averaged and fed to learnModel(), then the
 * serialized model is posted back for persistence.
 */

import type { Calibration, VisionModel, VisionThresholds } from '../types.js';
import { VisionPipeline, PROC_W, PROC_H } from './pipeline.js';
import { homographyFromQuads } from './homography.js';
import { buildWarpLUT, warpRGBA } from './warp.js';

declare const self: DedicatedWorkerGlobalScope;

export type VisionWorkerInbound =
  | { type: 'calibrate'; calibration: Calibration }
  | { type: 'model'; model: VisionModel }
  | { type: 'learn'; truth: number[]; frames?: number }
  | { type: 'confirm'; truth: number[] }
  | { type: 'thresholds'; thresholds: Partial<VisionThresholds> }
  | { type: 'frame'; bitmap: ImageBitmap; frameId: number }
  | { type: 'preview'; on: boolean };

const pipeline = new VisionPipeline();
const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(PROC_W, PROC_H) : null;
const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;

let frameCounter = 0;
let debugPreview = false;
const PREVIEW_EVERY = 5;

// Learn mode state.
let learnState: { truth: Uint8Array; needed: number; frames: Uint8ClampedArray[] } | null = null;

// Debug preview state (canonical 256px warp of the processing-res frame).
const PREVIEW_SIZE = 256;
let previewLUT: ReturnType<typeof buildWarpLUT> | null = null;
let previewCal: Calibration | null = null;

function renderDebugPreview(smallRGBA: Uint8ClampedArray): Uint8ClampedArray | null {
  if (!previewCal) return null;
  if (!previewLUT) {
    const sx = PROC_W / previewCal.srcW;
    const sy = PROC_H / previewCal.srcH;
    const srcQuad = previewCal.corners.map((v, i) => v * (i % 2 === 0 ? sx : sy));
    const H = homographyFromQuads(srcQuad, [0, 0, PREVIEW_SIZE, 0, PREVIEW_SIZE, PREVIEW_SIZE, 0, PREVIEW_SIZE]);
    if (!H) return null;
    previewLUT = buildWarpLUT(H, PREVIEW_SIZE, PREVIEW_SIZE, PROC_W, PROC_H);
    if (!previewLUT) return null;
  }
  const out = new Uint8ClampedArray(PREVIEW_SIZE * PREVIEW_SIZE * 4);
  warpRGBA(previewLUT, smallRGBA, out);
  return out;
}

self.onmessage = (ev: MessageEvent<VisionWorkerInbound>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'calibrate': {
      const coverage = pipeline.setCalibration(msg.calibration);
      pipeline.resetStability();
      previewCal = msg.calibration;
      previewLUT = null;
      self.postMessage({ type: 'calibrated', coverage });
      break;
    }
    case 'model': {
      const ok = pipeline.setModel(msg.model);
      self.postMessage({ type: 'modelSet', ok });
      break;
    }
    case 'thresholds': {
      pipeline.setThresholds(msg.thresholds);
      break;
    }
    case 'preview': {
      debugPreview = msg.on;
      break;
    }
    case 'learn': {
      learnState = {
        truth: Uint8Array.from(msg.truth),
        needed: msg.frames ?? 8,
        frames: []
      };
      break;
    }
    case 'confirm': {
      pipeline.confirmTruth(Uint8Array.from(msg.truth));
      break;
    }
    case 'frame': {
      handleFrame(msg.bitmap, msg.frameId);
      break;
    }
  }
};

function handleFrame(bitmap: ImageBitmap, frameId: number): void {
  const t0 = performance.now();
  if (!ctx) {
    bitmap.close();
    self.postMessage({ type: 'error', message: 'OffscreenCanvas unavailable in this webview' });
    return;
  }
  ctx.drawImage(bitmap, 0, 0, PROC_W, PROC_H);
  bitmap.close();
  const data = ctx.getImageData(0, 0, PROC_W, PROC_H).data;

  if (learnState) {
    learnState.frames.push(new Uint8ClampedArray(data));
    if (learnState.frames.length >= learnState.needed) {
      const { truth, frames } = learnState;
      learnState = null;
      const ok = pipeline.learnFromFrames(
        frames.map((rgba) => ({ rgba, w: PROC_W, h: PROC_H })),
        truth
      );
      const model = ok ? pipeline.exportModel() : null;
      self.postMessage({ type: 'learned', ok, model });
    } else {
      self.postMessage({ type: 'learnProgress', have: learnState.frames.length, need: learnState.needed });
    }
    return;
  }

  if (!pipeline.hasCalibration()) {
    self.postMessage({ type: 'idle', frameId });
    return;
  }

  const det = pipeline.process(data, PROC_W, PROC_H);
  frameCounter++;

  const occ = det.occupancy.slice();
  const conf = det.confidence.slice();
  const feats = det.features.slice();
  const transfer: ArrayBuffer[] = [occ.buffer, conf.buffer, feats.buffer];

  const payload: Record<string, unknown> = {
    type: 'detection',
    frameId: det.frameId,
    occupancy: occ,
    confidence: conf,
    features: feats,
    changedSquares: det.changedSquares,
    stable: det.stable,
    handLikely: det.handLikely,
    normMedian: det.normMedian,
    normScale: det.normScale,
    timeMs: det.timeMs,
    modelReady: det.modelReady,
    wallMs: performance.now() - t0
  };

  if (debugPreview && frameCounter % PREVIEW_EVERY === 0) {
    const preview = renderDebugPreview(data);
    if (preview) {
      payload.preview = preview;
      payload.previewSize = PREVIEW_SIZE;
      transfer.push(preview.buffer as ArrayBuffer);
    }
  }
  self.postMessage(payload, transfer);
}
