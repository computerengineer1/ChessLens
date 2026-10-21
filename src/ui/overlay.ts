/**
 * AR overlay renderer.
 *
 * Draws on a transparent canvas layered exactly over the <video> element:
 *  - glowing neon-cyan perspective outline of the 8x8 board (pre-rendered
 *    glow sprite, pulsing alpha - no per-frame shadowBlur)
 *  - the suggested move as two translucent green squares (from/to)
 *  - a perspective-correct arrow (polyline sampled through the homography)
 *  - red highlight for the last opponent move (subtle, corner ticks)
 *
 * Redraw policy: only when state changes or the pulse ticks (~15 Hz), and
 * the whole thing is skipped while hidden.
 */

import type { Calibration } from '../types.js';
import { homographyFromQuads, applyH, invertH, type H3 } from '../vision/homography.js';

export interface OverlaySuggestion {
  from: number; // canonical square index
  to: number;
  label: string; // e.g. "KNIGHT g8\u2192e7"
}

export interface OverlayLastMove {
  from: number;
  to: number;
}

const BOARD = 512; // canonical px
const SQ = 64;

export class OverlayRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private glowCanvas: HTMLCanvasElement | null = null;
  private H: H3 | null = null; // canonical -> video-frame pixels
  private display = { scale: 1, offX: 0, offY: 0, w: 0, h: 0 };
  private srcHint = { w: 1280, h: 720 };
  private suggestion: OverlaySuggestion | null = null;
  private lastMove: OverlayLastMove | null = null;
  private dirty = true;
  private lastPulseDraw = 0;
  private rafId = 0;
  private running = false;
  drawMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('overlay: 2d context unavailable');
    this.ctx = ctx;
  }

  setCalibration(cal: Calibration): void {
    // canonical (0..512) -> full-res video pixels
    const dstQuad = cal.corners as unknown as ArrayLike<number>;
    const srcQuad = [0, 0, BOARD, 0, BOARD, BOARD, 0, BOARD];
    this.H = homographyFromQuads(srcQuad, dstQuad);
    this.glowCanvas = null;
    this.dirty = true;
  }

  /** Source pixel space of the calibration (used when no video is attached,
   *  e.g. demo mode). */
  setSourceSize(w: number, h: number): void {
    this.srcHint = { w, h };
    this.dirty = true;
  }

  clearCalibration(): void {
    this.H = null;
    this.glowCanvas = null;
    this.dirty = true;
  }

  /** Match canvas backing store to the displayed video box (object-fit: cover). */
  resize(videoEl: HTMLVideoElement): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const vw = videoEl.videoWidth || this.srcHint.w;
    const vh = videoEl.videoHeight || this.srcHint.h;
    // object-fit: cover mapping from video pixels -> canvas pixels.
    const scale = Math.max(rect.width / vw, rect.height / vh);
    this.display = {
      scale: scale * dpr,
      offX: (rect.width - vw * scale) * 0.5 * dpr,
      offY: (rect.height - vh * scale) * 0.5 * dpr,
      w,
      h
    };
    this.glowCanvas = null;
    this.dirty = true;
  }

  setSuggestion(s: OverlaySuggestion | null): void {
    this.suggestion = s;
    this.dirty = true;
  }

  setLastMove(m: OverlayLastMove | null): void {
    this.lastMove = m;
    this.dirty = true;
  }

  /** Label position (CSS px, relative to canvas rect) for DOM chips. */
  labelAnchor(squareIndex: number): { x: number; y: number } | null {
    const p = this.projectSquarePoint(squareIndex, 0.5, -0.18);
    if (!p) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return { x: p.x / dpr, y: p.y / dpr };
  }

  private projectSquarePoint(squareIndex: number, fx: number, fy: number): { x: number; y: number } | null {
    if (!this.H) return null;
    const col = squareIndex & 7;
    const row = squareIndex >> 3;
    const cx = (col + fx) * SQ;
    const cy = (row + fy) * SQ;
    const p = applyH(this.H, cx, cy);
    if (!p) return null;
    return { x: p.x * this.display.scale + this.display.offX, y: p.y * this.display.scale + this.display.offY };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      const now = performance.now();
      const pulseTick = now - this.lastPulseDraw >= 66; // ~15 Hz pulse
      if (this.dirty || (pulseTick && this.H)) {
        this.draw(now);
        this.lastPulseDraw = now;
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private toScreen(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x * this.display.scale + this.display.offX, y: p.y * this.display.scale + this.display.offY };
  }

  private quadPath(ctx: CanvasRenderingContext2D, corners: Array<{ x: number; y: number }>): void {
    ctx.beginPath();
    const c0 = corners[0]!;
    ctx.moveTo(c0.x, c0.y);
    for (let i = 1; i < corners.length; i++) {
      const c = corners[i]!;
      ctx.lineTo(c.x, c.y);
    }
    ctx.closePath();
  }

  private squareCorners(index: number, inset = 0): Array<{ x: number; y: number }> {
    const col = index & 7;
    const row = index >> 3;
    const pts: Array<{ x: number; y: number }> = [];
    for (const [fx, fy] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ] as const) {
      const cx = col * SQ + fx * SQ;
      const cy = row * SQ + fy * SQ;
      const p = applyH(this.H!, cx, cy);
      if (!p) return [];
      const s = this.toScreen(p);
      if (inset) {
        // simple inset toward square center
        const cp = applyH(this.H!, col * SQ + SQ / 2, row * SQ + SQ / 2);
        if (cp) {
          const cs = this.toScreen(cp);
          s.x += (cs.x - s.x) * inset;
          s.y += (cs.y - s.y) * inset;
        }
      }
      pts.push(s);
    }
    return pts;
  }

  private ensureGlow(): HTMLCanvasElement | null {
    if (this.glowCanvas) return this.glowCanvas;
    if (!this.H) return null;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const c = off.getContext('2d');
    if (!c) return null;
    // Board outline quad in screen space.
    const corners: Array<{ x: number; y: number }> = [];
    for (const [cx, cy] of [
      [0, 0],
      [BOARD, 0],
      [BOARD, BOARD],
      [0, BOARD]
    ] as const) {
      const p = applyH(this.H, cx, cy);
      if (!p) return null;
      corners.push(this.toScreen(p));
    }
    this.quadPath(c, corners);
    // Pre-rendered glow: stacked translucent strokes (cheap fake blur).
    const layers: Array<[number, number]> = [
      [18, 0.05],
      [12, 0.08],
      [8, 0.12],
      [5, 0.2],
      [3, 0.5],
      [1.6, 1]
    ];
    c.lineJoin = 'round';
    for (const [lw, alpha] of layers) {
      c.lineWidth = lw;
      c.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
      c.stroke();
    }
    // Faint inner grid.
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0, 240, 255, 0.14)';
    for (let i = 1; i < 8; i++) {
      const a = applyH(this.H, (i * BOARD) / 8, 0);
      const b = applyH(this.H, (i * BOARD) / 8, BOARD);
      const cc = applyH(this.H, 0, (i * BOARD) / 8);
      const d = applyH(this.H, BOARD, (i * BOARD) / 8);
      if (!a || !b || !cc || !d) continue;
      const sa = this.toScreen(a);
      const sb = this.toScreen(b);
      const sc = this.toScreen(cc);
      const sd = this.toScreen(d);
      c.beginPath();
      c.moveTo(sa.x, sa.y);
      c.lineTo(sb.x, sb.y);
      c.moveTo(sc.x, sc.y);
      c.lineTo(sd.x, sd.y);
      c.stroke();
    }
    this.glowCanvas = off;
    return off;
  }

  private draw(now: number): void {
    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.H) {
      this.drawMs = performance.now() - t0;
      return;
    }
    // Neon outline with pulse.
    const glow = this.ensureGlow();
    if (glow) {
      const pulse = 0.72 + 0.28 * Math.sin((now / 1000) * Math.PI * 1.6);
      ctx.globalAlpha = pulse;
      ctx.drawImage(glow, 0, 0);
      ctx.globalAlpha = 1;
    }
    // Last opponent move: subtle corner ticks (cyan-white).
    if (this.lastMove) {
      ctx.strokeStyle = 'rgba(200, 230, 255, 0.5)';
      ctx.lineWidth = 2;
      for (const idx of [this.lastMove.from, this.lastMove.to]) {
        const corners = this.squareCorners(idx, 0.15);
        if (corners.length < 4) continue;
        ctx.beginPath();
        ctx.moveTo(corners[0]!.x, corners[0]!.y);
        ctx.lineTo(corners[1]!.x, corners[1]!.y);
        ctx.lineTo(corners[2]!.x, corners[2]!.y);
        ctx.lineTo(corners[3]!.x, corners[3]!.y);
        ctx.closePath();
        ctx.stroke();
      }
    }
    // Suggested move: two translucent green squares + arrow.
    if (this.suggestion) {
      for (const idx of [this.suggestion.from, this.suggestion.to]) {
        const corners = this.squareCorners(idx, 0.06);
        if (corners.length < 4) continue;
        this.quadPath(ctx, corners);
        ctx.fillStyle = 'rgba(0, 255, 140, 0.22)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 255, 140, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      this.drawArrow(ctx, this.suggestion.from, this.suggestion.to);
    }
    this.drawMs = performance.now() - t0;
  }

  private drawArrow(ctx: CanvasRenderingContext2D, from: number, to: number): void {
    if (!this.H) return;
    const fc = { x: (from & 7) * SQ + SQ / 2, y: (from >> 3) * SQ + SQ / 2 };
    const tc = { x: (to & 7) * SQ + SQ / 2, y: (to >> 3) * SQ + SQ / 2 };
    // Shorten so the head lands inside the target square.
    const dx = tc.x - fc.x;
    const dy = tc.y - fc.y;
    const len = Math.hypot(dx, dy) || 1;
    const ex = tc.x - (dx / len) * SQ * 0.18;
    const ey = tc.y - (dy / len) * SQ * 0.18;
    // Sample the canonical segment through the homography: perspective-correct.
    const N = 14;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = applyH(this.H, fc.x + (ex - fc.x) * t, fc.y + (ey - fc.y) * t);
      if (p) pts.push(this.toScreen(p));
    }
    if (pts.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Dark outline for contrast, then bright green core.
    for (const pass of [0, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      if (pass === 0) {
        ctx.strokeStyle = 'rgba(0, 40, 20, 0.55)';
        ctx.lineWidth = 9;
      } else {
        ctx.strokeStyle = 'rgba(0, 255, 140, 0.92)';
        ctx.lineWidth = 5;
      }
      ctx.stroke();
    }
    // Arrowhead at the end point, oriented along the last screen segment.
    const a = pts[pts.length - 2]!;
    const b = pts[pts.length - 1]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = Math.max(12, len * this.display.scale * 0.06);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - headLen * Math.cos(ang - 0.42), b.y - headLen * Math.sin(ang - 0.42));
    ctx.lineTo(b.x - headLen * Math.cos(ang + 0.42), b.y - headLen * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 255, 140, 0.95)';
    ctx.fill();
  }

  /** Expose the canonical->screen transform (debug view uses its inverse). */
  getHomography(): H3 | null {
    return this.H;
  }

  screenToCanonical(xCss: number, yCss: number): { x: number; y: number } | null {
    if (!this.H) return null;
    const Hi = invertH(this.H);
    if (!Hi) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vx = (xCss * dpr - this.display.offX) / this.display.scale;
    const vy = (yCss * dpr - this.display.offY) / this.display.scale;
    return applyH(Hi, vx, vy);
  }
}
