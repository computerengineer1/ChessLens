/**
 * VisionClient: main-thread handle to the vision worker.
 *
 * Also supports a DIRECT (same-thread) mode used by unit tests and as a
 * fallback when module workers are unavailable - both paths run the exact
 * same VisionPipeline code.
 */

import type { Calibration, DetectionResult, VisionModel, VisionThresholds } from '../types.js';
import type { VisionWorkerInbound } from './vision.worker.js';

export interface DetectionMessage extends DetectionResult {
  wallMs?: number;
  preview?: Uint8ClampedArray;
  previewSize?: number;
}

export interface VisionClientHandlers {
  onDetection?: (det: DetectionMessage) => void;
  onCalibrated?: (coverage: number) => void;
  onLearned?: (ok: boolean, model: VisionModel | null) => void;
  onLearnProgress?: (have: number, need: number) => void;
  onError?: (message: string) => void;
  onIdle?: (frameId: number) => void;
}

export class VisionClient {
  private worker: Worker | null = null;
  private handlers: VisionClientHandlers;
  private pending = 0;
  readonly direct: boolean;
  private directPipeline: import('./pipeline.js').VisionPipeline | null = null;

  constructor(handlers: VisionClientHandlers = {}, forceDirect = false) {
    this.handlers = handlers;
    const hasWorkers = typeof Worker !== 'undefined';
    this.direct = forceDirect || !hasWorkers;
    if (!this.direct) {
      this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), {
        type: 'module',
        name: 'chesslens-vision'
      });
      this.worker.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
      this.worker.onerror = (ev) => {
        this.handlers.onError?.(`vision worker error: ${ev.message}`);
      };
    }
  }

  private async ensureDirect(): Promise<import('./pipeline.js').VisionPipeline> {
    if (!this.directPipeline) {
      const { VisionPipeline } = await import('./pipeline.js');
      this.directPipeline = new VisionPipeline();
    }
    return this.directPipeline;
  }

  private post(msg: VisionWorkerInbound, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private onMessage(data: Record<string, unknown>): void {
    switch (data.type as string) {
      case 'detection':
        this.pending = Math.max(0, this.pending - 1);
        this.handlers.onDetection?.(data as unknown as DetectionMessage);
        break;
      case 'calibrated':
        this.handlers.onCalibrated?.(data.coverage as number);
        break;
      case 'learned':
        this.handlers.onLearned?.(data.ok as boolean, (data.model as VisionModel | null) ?? null);
        break;
      case 'learnProgress':
        this.handlers.onLearnProgress?.(data.have as number, data.need as number);
        break;
      case 'idle':
        this.handlers.onIdle?.(data.frameId as number);
        break;
      case 'error':
        this.handlers.onError?.(data.message as string);
        break;
      case 'modelSet':
        break;
      default:
        break;
    }
  }

  calibrate(cal: Calibration): void {
    if (this.direct) {
      void this.ensureDirect().then((p) => {
        const coverage = p.setCalibration(cal);
        this.handlers.onCalibrated?.(coverage);
      });
      return;
    }
    this.post({ type: 'calibrate', calibration: cal });
  }

  setModel(model: VisionModel): void {
    if (this.direct) {
      void this.ensureDirect().then((p) => p.setModel(model));
      return;
    }
    this.post({ type: 'model', model });
  }

  setThresholds(t: Partial<VisionThresholds>): void {
    if (this.direct) {
      void this.ensureDirect().then((p) => p.setThresholds(t));
      return;
    }
    this.post({ type: 'thresholds', thresholds: t });
  }

  /** Begin a start-position scan: the next frames are averaged and learned. */
  learn(truth: Uint8Array, frames = 8): void {
    if (this.direct) {
      this.handlers.onError?.('direct mode: use learnDirect()');
      return;
    }
    this.post({ type: 'learn', truth: Array.from(truth), frames });
  }

  confirmTruth(truth: Uint8Array): void {
    if (this.direct) {
      void this.ensureDirect().then((p) => p.confirmTruth(truth));
      return;
    }
    this.post({ type: 'confirm', truth: Array.from(truth) });
  }

  setPreview(on: boolean): void {
    if (this.direct) return;
    this.post({ type: 'preview', on });
  }

  /** Send one frame. Returns false when the worker is still busy (skip). */
  async postFrame(bitmap: ImageBitmap): Promise<boolean> {
    if (this.direct) {
      const p = await this.ensureDirect();
      const off = new OffscreenCanvas(bitmap.width, bitmap.height);
      const c = off.getContext('2d');
      if (c) {
        c.drawImage(bitmap, 0, 0);
        const data = c.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const det = p.process(data, bitmap.width, bitmap.height);
        this.handlers.onDetection?.({
          ...det,
          occupancy: det.occupancy.slice(),
          confidence: det.confidence.slice(),
          features: det.features.slice()
        });
      }
      bitmap.close();
      return true;
    }
    if (this.pending >= 2) {
      bitmap.close();
      return false; // worker still busy: drop frame (keeps latency low)
    }
    this.pending++;
    this.post({ type: 'frame', bitmap, frameId: 0 }, [bitmap]);
    return true;
  }

  /** Direct-mode learning helper (tests): learn from raw RGBA frames. */
  async learnDirect(
    frames: Array<{ rgba: Uint8ClampedArray | Uint8Array; w: number; h: number }>,
    truth: Uint8Array
  ): Promise<{ ok: boolean; model: VisionModel | null }> {
    const p = await this.ensureDirect();
    const ok = p.learnFromFrames(frames, truth);
    const model = ok ? p.exportModel() : null;
    this.handlers.onLearned?.(ok, model);
    return { ok, model };
  }

  /** Direct-mode single frame processing (tests). */
  async processDirect(
    rgba: Uint8ClampedArray | Uint8Array,
    w: number,
    h: number
  ): Promise<DetectionResult | null> {
    const p = await this.ensureDirect();
    if (!p.hasCalibration()) return null;
    return p.process(rgba, w, h);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.directPipeline = null;
  }
}
