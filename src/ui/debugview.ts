/**
 * Debug view: warped board + classification overlay, per-square scores,
 * feature inspector, FPS/perf budgets, engine status, and LIVE threshold
 * sliders so everything can be tuned on a real board.
 */

import type { AppSettings, DetectionResult, VisionThresholds } from '../types.js';
import { WHITE, BLACK, FEATURE_COUNT } from '../types.js';
import { el, sliderRow } from './dom.js';
import { t } from './i18n.js';
import type { Screen } from './screens.js';
import { squareName } from '../vision/features.js';
import type { PerfBudgets } from '../util/timing.js';

export interface TrackerTunables {
  acceptCost: number;
  acceptMargin: number;
  weakConfidence: number;
  recoveryAcceptCost: number;
  recoveryMargin: number;
  lostAfter: number;
}

export interface DebugDeps {
  getSettings(): AppSettings;
  onThresholdChange(patch: Partial<VisionThresholds>): void;
  onTrackerConfigChange(patch: Partial<TrackerTunables>): void;
  getTrackerConfig(): TrackerTunables;
  getPerf(): PerfBudgets;
  getEngineStatus(): string;
  getTrackerInfo(): { fen: string; confirmed: Uint8Array };
}

const STATE_COLORS = ['rgba(120,120,120,0.35)', 'rgba(250,250,240,0.55)', 'rgba(20,20,20,0.55)'];

let tmpCanvas: HTMLCanvasElement | null = null;

export class DebugScreen implements Screen {
  readonly id = 'debug';
  readonly root: HTMLElement;
  private deps: DebugDeps;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private preview: Uint8ClampedArray | null = null;
  private previewSize = 256;
  private lastDet: DetectionResult | null = null;
  private selSquare = 0;
  private infoEl: HTMLElement;
  private featEl: HTMLElement;
  private perfEl: HTMLElement;
  private engineEl: HTMLElement;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private labels = new Map<string, HTMLElement>();

  constructor(deps: DebugDeps) {
    this.deps = deps;
    this.canvas = el('canvas', { class: 'debug-board', width: 512, height: 512 });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('debug: no 2d context');
    this.ctx = ctx;
    this.canvas.addEventListener('pointerdown', (ev) => {
      const r = this.canvas.getBoundingClientRect();
      const col = Math.floor(((ev.clientX - r.left) / r.width) * 8);
      const row = Math.floor(((ev.clientY - r.top) / r.height) * 8);
      if (col >= 0 && col < 8 && row >= 0 && row < 8) {
        this.selSquare = row * 8 + col;
        this.renderInfo();
      }
    });
    this.infoEl = el('div', { class: 'debug-info' });
    this.featEl = el('div', { class: 'debug-features' });
    this.perfEl = el('div', { class: 'debug-perf' });
    this.engineEl = el('div', { class: 'debug-engine' });
    this.root = el('div', { class: 'screen-content settings-scroll' });
    this.build();
  }

  setPreview(data: Uint8ClampedArray | null, size: number): void {
    this.preview = data;
    this.previewSize = size;
  }

  setDetection(det: DetectionResult | null): void {
    this.lastDet = det;
  }

  private build(): void {
    const th = this.deps.getSettings().thresholds;
    const title = el('h2', { text: t('dbg.title') });
    this.labels.set('dbg.title', title);

    const rows: HTMLElement[] = [];
    const mk = (label: string, key: keyof VisionThresholds, min: number, max: number, step: number): void => {
      const r = sliderRow(label, min, max, step, th[key] as number, (v) => {
        this.deps.onThresholdChange({ [key]: v } as Partial<VisionThresholds>);
        this.renderInfo();
      });
      rows.push(r.row);
    };
    mk('stableFrames', 'stableFrames', 1, 20, 1);
    mk('skinFraction', 'skinFraction', 0.01, 0.3, 0.01);
    mk('maxSimultaneousChanges', 'maxSimultaneousChanges', 2, 12, 1);
    mk('massThreshold', 'massThreshold', 8, 60, 1);
    mk('confidenceTemperature', 'confidenceTemperature', 0.05, 2, 0.05);
    mk('templateEma', 'templateEma', 0, 0.3, 0.01);
    mk('classEma', 'classEma', 0, 0.3, 0.01);

    const cfg = this.deps.getTrackerConfig();
    const trackerRows: HTMLElement[] = [];
    const mkT = (label: string, key: keyof TrackerTunables, min: number, max: number, step: number): void => {
      const r = sliderRow(label, min, max, step, cfg[key] as number, (v) => {
        this.deps.onTrackerConfigChange({ [key]: v } as Partial<TrackerTunables>);
      });
      trackerRows.push(r.row);
    };
    mkT('acceptCost', 'acceptCost', 0.2, 6, 0.1);
    mkT('acceptMargin', 'acceptMargin', 0.1, 4, 0.1);
    mkT('weakConfidence', 'weakConfidence', 0.1, 0.9, 0.05);
    mkT('recoveryAcceptCost', 'recoveryAcceptCost', 0.5, 8, 0.1);
    mkT('recoveryMargin', 'recoveryMargin', 0.2, 6, 0.1);
    mkT('lostAfter', 'lostAfter', 5, 120, 1);

    const thHeader = el('h3', { class: 'settings-section', text: t('dbg.thresholds') });
    const trkHeader = el('h3', { class: 'settings-section', text: 'tracker' });
    const perfHeader = el('h3', { class: 'settings-section', text: t('dbg.budgets') });
    this.labels.set('dbg.thresholds', thHeader);
    this.labels.set('dbg.budgets', perfHeader);

    const back = el('button', { class: 'btn btn-primary', text: t('common.back') });
    this.labels.set('common.back', back);
    back.addEventListener('click', () => {
      this.deps.getSettings(); // no-op, keeps deps referenced
      window.dispatchEvent(new CustomEvent('chesslens:close-debug'));
    });

    this.root.append(
      title,
      el('div', { class: 'debug-board-caption', text: t('dbg.warped') }),
      this.canvas,
      this.infoEl,
      this.featEl,
      perfHeader,
      this.perfEl,
      this.engineEl,
      thHeader,
      ...rows,
      trkHeader,
      ...trackerRows,
      back
    );
  }

  refreshI18n(): void {
    for (const [k, node] of this.labels) node.textContent = t(k);
  }

  onShow(): void {
    this.refreshTimer = setInterval(() => {
      this.drawBoard();
      this.renderInfo();
    }, 200);
  }

  onHide(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private drawBoard(): void {
    const ctx = this.ctx;
    const size = this.canvas.width;
    if (this.preview) {
      // Preview is previewSize^2 RGBA; scale up to canvas.
      const img = new ImageData(this.preview as Uint8ClampedArray<ArrayBuffer>, this.previewSize, this.previewSize);
      const tmp = tmpCanvas ?? (tmpCanvas = document.createElement('canvas'));
      tmp.width = this.previewSize;
      tmp.height = this.previewSize;
      const tc = tmp.getContext('2d');
      if (tc) {
        tc.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(tmp, 0, 0, size, size);
      }
    } else {
      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, size, size);
    }
    // Classification overlay + grid.
    const det = this.lastDet;
    const sq = size / 8;
    for (let s = 0; s < 64; s++) {
      const row = s >> 3;
      const col = s & 7;
      if (det) {
        ctx.fillStyle = STATE_COLORS[det.occupancy[s] as number] ?? STATE_COLORS[0]!;
        ctx.fillRect(col * sq, row * sq, sq, sq);
        const conf = det.confidence[s] as number;
        ctx.fillStyle = conf > 0.8 ? 'rgba(0,255,140,0.9)' : conf > 0.5 ? 'rgba(255,210,80,0.9)' : 'rgba(255,90,90,0.95)';
        ctx.font = `${Math.round(sq * 0.22)}px ui-monospace, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(conf.toFixed(2), col * sq + 3, row * sq + 2);
      }
      ctx.strokeStyle = 'rgba(0,240,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(col * sq, row * sq, sq, sq);
      if (s === this.selSquare) {
        ctx.strokeStyle = 'rgba(0,255,140,1)';
        ctx.lineWidth = 3;
        ctx.strokeRect(col * sq + 1, row * sq + 1, sq - 2, sq - 2);
      }
    }
  }

  private renderInfo(): void {
    const det = this.lastDet;
    const info = this.deps.getTrackerInfo();
    const name = squareName(this.selSquare);
    let stateTxt = '-';
    let confTxt = '-';
    if (det) {
      const st = det.occupancy[this.selSquare] as number;
      stateTxt = st === WHITE ? t('dbg.white') : st === BLACK ? t('dbg.black') : t('dbg.empty');
      confTxt = (det.confidence[this.selSquare] as number).toFixed(3);
    }
    this.infoEl.textContent =
      `${t('dbg.square')}: ${name} | ${t('dbg.state')}: ${stateTxt} | ${t('dbg.conf')}: ${confTxt} | ` +
      `stable: ${det ? (det.stable ? 'yes' : 'no') : '-'} | hand: ${det ? (det.handLikely ? 'yes' : 'no') : '-'} | ` +
      `changed: ${det ? det.changedSquares : '-'} | norm: ${det ? det.normMedian.toFixed(0) + '/' + det.normScale.toFixed(0) : '-'}`;

    const confirmed = info.confirmed[this.selSquare] as number;
    const confLabel = confirmed === WHITE ? 'white' : confirmed === BLACK ? 'black' : 'empty';
    let featTxt = `FEN: ${info.fen} | confirmed[${name}]: ${confLabel}`;
    if (det) {
      const parts: string[] = [];
      for (let f = 0; f < FEATURE_COUNT; f++) {
        parts.push((det.features[this.selSquare * FEATURE_COUNT + f] as number).toFixed(2));
      }
      featTxt += `\n${t('dbg.features')}[${name}]: z, edge, sat, tdiff, wmass, bmass, minz, maxz = ${parts.join(', ')}`;
    }
    this.featEl.textContent = featTxt;

    const perf = this.deps.getPerf().report();
    this.perfEl.textContent = Object.entries(perf)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    this.engineEl.textContent = `engine: ${this.deps.getEngineStatus()}`;
  }
}
