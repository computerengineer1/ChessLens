/**
 * Calibration screen.
 *
 * The user drags 4 handles onto the OUTER corners of the 8x8 playing grid.
 * A magnifier loupe follows the active handle for pixel precision. The
 * orientation controls ("my side is nearest the camera" + White/Black +
 * rotate/flip) define which physical corner maps to which canonical corner
 * (a8/h8/h1/a1); the live top-down preview shows whether the mapping is
 * right (square grid, White at the bottom).
 */

import type { Calibration, CornerQuad } from '../types.js';
import { el, pointerPos } from './dom.js';
import { t } from './i18n.js';
import type { CameraSource } from '../camera/camera.js';
import { homographyFromQuads } from '../vision/homography.js';
import { buildWarpLUT, warpRGBA, WARP_SIZE } from '../vision/warp.js';
import type { Screen } from './screens.js';

export interface CalibrationDeps {
  camera: CameraSource;
  onSaved: (cal: Calibration) => void;
  onCancel: () => void;
  getSavedCameraId: () => string;
}

const HANDLE_R = 26; // CSS px touch radius
const LABELS = ['a8', 'h8', 'h1', 'a1']; // canonical corner order

export class CalibrationScreen implements Screen {
  readonly id = 'calibration';
  readonly root: HTMLElement;
  private videoWrap: HTMLElement;
  private handleCanvas: HTMLCanvasElement;
  private hctx: CanvasRenderingContext2D;
  private loupe: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private previewCanvas: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private qualityEl: HTMLElement;
  private handles: Array<{ x: number; y: number }> = [];
  private dragIndex = -1;
  private rot = 0; // rotation state (0..3)
  private flip = false;
  private deps: CalibrationDeps;
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private drawTimer: ReturnType<typeof setInterval> | null = null;
  private titleEl!: HTMLElement;
  private instrEl!: HTMLElement;
  private labels: Record<string, HTMLElement> = {};

  constructor(deps: CalibrationDeps) {
    this.deps = deps;
    this.videoWrap = el('div', { class: 'cal-video-wrap' });
    this.handleCanvas = el('canvas', { class: 'cal-handles' });
    const hctx = this.handleCanvas.getContext('2d');
    if (!hctx) throw new Error('calibration: no 2d context');
    this.hctx = hctx;
    this.videoWrap.append(this.deps.camera.video, this.handleCanvas);

    this.loupe = el('canvas', { class: 'cal-loupe hidden', width: 140, height: 140 });
    const lctx = this.loupe.getContext('2d');
    if (!lctx) throw new Error('calibration: no loupe context');
    this.lctx = lctx;

    this.previewCanvas = el('canvas', { class: 'cal-preview', width: 200, height: 200 });
    const pctx = this.previewCanvas.getContext('2d');
    if (!pctx) throw new Error('calibration: no preview context');
    this.pctx = pctx;
    this.qualityEl = el('span', { class: 'cal-quality', text: '' });

    this.root = el('div', { class: 'screen-content' });
    this.build();

    this.handleCanvas.addEventListener('pointerdown', (ev) => this.onDown(ev));
    this.handleCanvas.addEventListener('pointermove', (ev) => this.onMove(ev));
    this.handleCanvas.addEventListener('pointerup', () => this.onUp());
    this.handleCanvas.addEventListener('pointercancel', () => this.onUp());
  }

  private build(): void {
    this.titleEl = el('h2', { text: t('cal.title') });
    this.instrEl = el('p', { class: 'cal-instructions', text: t('cal.instructions') });

    const mkBtn = (labelKey: string, cls: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', { class: `btn ${cls}`, text: t(labelKey) });
      b.addEventListener('click', fn);
      this.labels[labelKey] = b;
      return b;
    };

    const orientRow = el('div', { class: 'cal-orient-row' }, [
      el('span', { class: 'cal-orient-label', text: t('cal.orientation') }),
      mkBtn('cal.sideWhite', 'btn-ghost', () => this.setSide('white')),
      mkBtn('cal.sideBlack', 'btn-ghost', () => this.setSide('black'))
    ]);
    this.labels['cal.orientation'] = orientRow.firstElementChild as HTMLElement;

    const rotateRow = el('div', { class: 'cal-rotate-row' }, [
      mkBtn('cal.rotateLeft', 'btn-ghost', () => this.rotate(-1)),
      mkBtn('cal.rotateRight', 'btn-ghost', () => this.rotate(1)),
      mkBtn('cal.flip', 'btn-ghost', () => {
        this.flip = !this.flip;
        this.redraw();
      })
    ]);

    const previewBlock = el('div', { class: 'cal-preview-block' }, [
      el('div', { class: 'cal-preview-caption', text: t('cal.preview') }),
      this.previewCanvas,
      this.qualityEl
    ]);
    this.labels['cal.preview'] = previewBlock.firstElementChild as HTMLElement;

    const doneBtn = el('button', { class: 'btn btn-primary btn-big', text: t('cal.done') });
    doneBtn.addEventListener('click', () => this.save());
    this.labels['cal.done'] = doneBtn;

    const cancelBtn = el('button', { class: 'btn btn-ghost', text: t('common.cancel') });
    cancelBtn.addEventListener('click', () => this.deps.onCancel());
    this.labels['common.cancel'] = cancelBtn;

    this.root.append(
      this.titleEl,
      this.instrEl,
      this.videoWrap,
      this.loupe,
      orientRow,
      rotateRow,
      previewBlock,
      el('div', { class: 'cal-buttons' }, [cancelBtn, doneBtn])
    );
  }

  refreshI18n(): void {
    this.titleEl.textContent = t('cal.title');
    this.instrEl.textContent = t('cal.instructions');
    for (const [key, node] of Object.entries(this.labels)) node.textContent = t(key);
  }

  private setSide(side: 'white' | 'black'): void {
    // "My side nearest the camera": when the user plays Black, the canonical
    // a8 corner is on the user's left far side => rotate 180°.
    this.rot = side === 'white' ? 0 : 2;
    this.flip = false;
    this.redraw();
  }

  private rotate(dir: 1 | -1): void {
    this.rot = (this.rot + dir + 4) % 4;
    this.redraw();
  }

  /** Map canonical corner slot -> handle index, given rot/flip. */
  private assignment(): [number, number, number, number] {
    const r = this.rot;
    if (!this.flip) return [r % 4, (r + 1) % 4, (r + 2) % 4, (r + 3) % 4];
    return [(r + 1) % 4, r % 4, (r + 3) % 4, (r + 2) % 4];
  }

  private currentCorners(): CornerQuad {
    const a = this.assignment();
    const out: number[] = [];
    for (let slot = 0; slot < 4; slot++) {
      const h = this.handles[a[slot] as number];
      if (!h) return [0, 0, 1, 0, 1, 1, 0, 1];
      out.push(this.toVideoX(h.x), this.toVideoY(h.y));
    }
    return out as unknown as CornerQuad;
  }

  private toVideoX(cssX: number): number {
    const rect = this.handleCanvas.getBoundingClientRect();
    const video = this.deps.camera.video;
    return (cssX / rect.width) * (video.videoWidth || 1280);
  }

  private toVideoY(cssY: number): number {
    const rect = this.handleCanvas.getBoundingClientRect();
    const video = this.deps.camera.video;
    return (cssY / rect.height) * (video.videoHeight || 720);
  }

  private toCssX(videoX: number): number {
    const rect = this.handleCanvas.getBoundingClientRect();
    const video = this.deps.camera.video;
    return (videoX / (video.videoWidth || 1280)) * rect.width;
  }

  private toCssY(videoY: number): number {
    const rect = this.handleCanvas.getBoundingClientRect();
    const video = this.deps.camera.video;
    return (videoY / (video.videoHeight || 720)) * rect.height;
  }

  private initHandles(): void {
    const video = this.deps.camera.video;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    // Sensible defaults: centered rectangle covering ~70% of the frame.
    const mx = w * 0.15;
    const my = h * 0.15;
    this.handles = [
      { x: this.toCssX(mx), y: this.toCssY(my) },
      { x: this.toCssX(w - mx), y: this.toCssY(my) },
      { x: this.toCssX(w - mx), y: this.toCssY(h - my) },
      { x: this.toCssX(mx), y: this.toCssY(h - my) }
    ];
  }

  private resizeCanvases(): void {
    const rect = this.videoWrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.handleCanvas.width = Math.round(rect.width * dpr);
    this.handleCanvas.height = Math.round(rect.height * dpr);
    this.handleCanvas.style.width = `${rect.width}px`;
    this.handleCanvas.style.height = `${rect.height}px`;
  }

  private redraw(): void {
    this.resizeCanvases();
    const ctx = this.hctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.handleCanvas.width, this.handleCanvas.height);
    if (this.handles.length < 4) return;
    const a = this.assignment();
    // Quad edges in canonical order.
    ctx.beginPath();
    for (let slot = 0; slot < 4; slot++) {
      const h = this.handles[a[slot] as number]!;
      if (slot === 0) ctx.moveTo(h.x, h.y);
      else ctx.lineTo(h.x, h.y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 240, 255, 0.06)';
    ctx.fill();
    // Handles with canonical labels.
    for (let slot = 0; slot < 4; slot++) {
      const hi = a[slot] as number;
      const h = this.handles[hi]!;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = this.dragIndex === hi ? 'rgba(0, 255, 140, 0.95)' : 'rgba(0, 240, 255, 0.9)';
      ctx.fill();
      ctx.strokeStyle = '#04121a';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#eaffff';
      ctx.font = '700 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LABELS[slot] as string, h.x, h.y + 0.5);
    }
    this.updatePreview();
  }

  private updatePreview(): void {
    const video = this.deps.camera.video;
    if (!video.videoWidth) return;
    const corners = this.currentCorners();
    const srcQuad = corners as unknown as ArrayLike<number>;
    const dstQuad = [0, 0, WARP_SIZE, 0, WARP_SIZE, WARP_SIZE, 0, WARP_SIZE];
    const H = homographyFromQuads(srcQuad, dstQuad);
    if (!H) {
      this.qualityEl.textContent = `${t('cal.quality')}: --`;
      return;
    }
    // Coverage: canonical area sanity via the quad's projected diagonals.
    const d1 = Math.hypot(corners[0] - corners[4], corners[1] - corners[5]);
    const d2 = Math.hypot(corners[2] - corners[6], corners[3] - corners[7]);
    const ratio = Math.min(d1, d2) / Math.max(d1, d2);
    const lut = buildWarpLUT(H, 200, 200, video.videoWidth, video.videoHeight);
    if (!lut) return;
    // Grab the current video frame at full res via a shared scratch canvas.
    const scratch = CalibrationScreen.getScratch(video);
    const sc = scratch.getContext('2d', { willReadFrequently: true });
    if (!sc) return;
    const src = sc.getImageData(0, 0, video.videoWidth, video.videoHeight).data;
    const out = new Uint8ClampedArray(200 * 200 * 4);
    warpRGBA(lut, src, out);
    const img = new ImageData(out, 200, 200);
    this.pctx.putImageData(img, 0, 0);
    // Grid overlay on the preview.
    this.pctx.strokeStyle = 'rgba(0,240,255,0.4)';
    this.pctx.lineWidth = 0.5;
    for (let i = 1; i < 8; i++) {
      this.pctx.beginPath();
      this.pctx.moveTo((i * 200) / 8, 0);
      this.pctx.lineTo((i * 200) / 8, 200);
      this.pctx.moveTo(0, (i * 200) / 8);
      this.pctx.lineTo(200, (i * 200) / 8);
      this.pctx.stroke();
    }
    this.qualityEl.textContent = `${t('cal.quality')}: ${(ratio * 100).toFixed(0)}%`;
  }

  private onDown(ev: PointerEvent): void {
    const p = pointerPos(this.handleCanvas, ev);
    let best = -1;
    let bestD = HANDLE_R * HANDLE_R;
    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i]!;
      const d = (h.x - p.x) * (h.x - p.x) + (h.y - p.y) * (h.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.dragIndex = best;
    if (best >= 0) {
      this.handleCanvas.setPointerCapture(ev.pointerId);
      this.loupe.classList.remove('hidden');
      this.updateLoupe(p);
    }
    this.redraw();
  }

  private onMove(ev: PointerEvent): void {
    const p = pointerPos(this.handleCanvas, ev);
    if (this.dragIndex >= 0) {
      const h = this.handles[this.dragIndex]!;
      h.x = Math.max(0, Math.min(this.handleCanvas.clientWidth, p.x));
      h.y = Math.max(0, Math.min(this.handleCanvas.clientHeight, p.y));
      this.updateLoupe(p);
      this.redraw();
    }
  }

  private onUp(): void {
    this.dragIndex = -1;
    this.loupe.classList.add('hidden');
    this.redraw();
  }

  private updateLoupe(p: { x: number; y: number }): void {
    if (this.dragIndex < 0) return;
    const h = this.handles[this.dragIndex]!;
    const video = this.deps.camera.video;
    if (!video.videoWidth) return;
    const rect = this.handleCanvas.getBoundingClientRect();
    // Loupe position: offset from touch so the finger does not cover it.
    const lx = Math.min(rect.width - 150, Math.max(10, p.x + 30));
    const ly = Math.max(10, p.y - 170);
    this.loupe.style.left = `${lx}px`;
    this.loupe.style.top = `${ly}px`;
    const zoom = 4;
    const vx = (h.x / rect.width) * video.videoWidth;
    const vy = (h.y / rect.height) * video.videoHeight;
    const srcSize = 140 / zoom;
    const scratch = CalibrationScreen.getScratch(video);
    const sc = scratch.getContext('2d', { willReadFrequently: true });
    if (!sc) return;
    this.lctx.imageSmoothingEnabled = true;
    this.lctx.clearRect(0, 0, 140, 140);
    this.lctx.drawImage(scratch, vx - srcSize / 2, vy - srcSize / 2, srcSize, srcSize, 0, 0, 140, 140);
    // Crosshair.
    this.lctx.strokeStyle = 'rgba(0,255,140,0.9)';
    this.lctx.lineWidth = 1;
    this.lctx.beginPath();
    this.lctx.moveTo(70, 55);
    this.lctx.lineTo(70, 85);
    this.lctx.moveTo(55, 70);
    this.lctx.lineTo(85, 70);
    this.lctx.stroke();
  }

  private static scratchCanvas: HTMLCanvasElement | null = null;
  static getScratch(video: HTMLVideoElement): HTMLCanvasElement {
    let s = CalibrationScreen.scratchCanvas;
    if (!s) {
      s = document.createElement('canvas');
      CalibrationScreen.scratchCanvas = s;
    }
    if (s.width !== video.videoWidth || s.height !== video.videoHeight) {
      s.width = video.videoWidth;
      s.height = video.videoHeight;
    }
    const c = s.getContext('2d');
    if (c) c.drawImage(video, 0, 0);
    return s;
  }

  private save(): void {
    const video = this.deps.camera.video;
    const cal: Calibration = {
      corners: this.currentCorners(),
      srcW: video.videoWidth || 1280,
      srcH: video.videoHeight || 720,
      cameraId: this.deps.getSavedCameraId(),
      createdAt: Date.now()
    };
    // Sanity: corners must form a convex quad with positive area.
    if (!isConvexQuad(cal.corners)) {
      this.qualityEl.textContent = '\u26a0';
      return;
    }
    this.deps.onSaved(cal);
  }

  onShow(): void {
    this.initHandles();
    this.redraw();
    this.previewTimer = setInterval(() => {
      if (this.dragIndex < 0) this.updatePreview();
    }, 250);
    this.drawTimer = setInterval(() => this.redraw(), 1000 / 20);
  }

  onHide(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    if (this.drawTimer) clearInterval(this.drawTimer);
    this.previewTimer = null;
    this.drawTimer = null;
    this.loupe.classList.add('hidden');
  }
}

function isConvexQuad(c: CornerQuad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = { x: c[i * 2] as number, y: c[i * 2 + 1] as number };
    const b = c[((i + 1) % 4) * 2] as number;
    const bY = c[((i + 1) % 4) * 2 + 1] as number;
    const d = c[((i + 2) % 4) * 2] as number;
    const dY = c[((i + 2) % 4) * 2 + 1] as number;
    const cross = (b - a.x) * (dY - bY) - (bY - a.y) * (d - b);
    const s = cross > 0 ? 1 : cross < 0 ? -1 : 0;
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  // Also require a minimum area.
  const area = quadArea(c);
  return area > 1000;
}

function quadArea(c: CornerQuad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += (c[i * 2] as number) * (c[j * 2 + 1] as number) - (c[j * 2] as number) * (c[i * 2 + 1] as number);
  }
  return Math.abs(area) / 2;
}
