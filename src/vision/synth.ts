/**
 * Synthetic chessboard renderer.
 *
 * Renders a real-looking camera frame of a chessboard for a given FEN:
 * canonical board painting (squares + simple piece silhouettes), a random or
 * fixed perspective warp, lighting changes, vignette/gradient, skin-tone
 * "hand" blobs, Gaussian noise and box blur.
 *
 * Used by:
 *  - tests (PGN replays, classifier accuracy, recovery, occlusion)
 *  - the ?demo=1 mode, which plays a synthetic game through the exact same
 *    pipeline as the camera.
 *
 * Pure typed arrays - runs identically in Node (vitest), Web Workers and the
 * browser, with no canvas dependency.
 */

import type { CornerQuad } from '../types.js';
import { Chess } from 'chess.js';
import { buildWarpLUT, warpRGBA } from './warp.js';
import { homographyFromQuads } from './homography.js';

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthFrameOptions {
  fen: string;
  /** Output frame size (the "camera" frame). */
  outW?: number;
  outH?: number;
  /** Canonical board size to paint before warping. */
  boardPx?: number;
  /** Destination corners of the board in the output frame [x0,y0..x3,y3]
   *  (canonical order a8,h8,h1,a1). Random when omitted. */
  corners?: CornerQuad;
  /** Randomization seed (used when corners/lighting not pinned). */
  seed?: number;
  /** Brightness multiplier 0.4..2. Random when undefined. */
  brightness?: number;
  /** Contrast around 1.0. Random when undefined. */
  contrast?: number;
  /** Strength of a left-right lighting gradient (0..0.5). Random when undefined. */
  gradient?: number;
  /** Gaussian noise sigma (0..25). Random when undefined. */
  noise?: number;
  /** Box blur radius (0..3). Random when undefined. */
  blur?: number;
  /** Board colors as [r,g,b] pairs. Slightly random when omitted. */
  lightColor?: [number, number, number];
  darkColor?: [number, number, number];
  /** Skin-tone ellipse (hand) in output-frame coords, or null for none. */
  hand?: { cx: number; cy: number; rx: number; ry: number; angle: number } | null;
  /** Per-square piece placement jitter in board units (0..0.15). Random when undefined. */
  jitter?: number;
}

export interface SynthFrame {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  corners: CornerQuad;
}

// ---------------------------------------------------------------------------
// Piece silhouettes: predicate functions on normalized coords (u,v) in
// [0,1]x[0,1] inside the square, piece area roughly centered.
// ---------------------------------------------------------------------------

function inCircle(u: number, v: number, cx: number, cy: number, r: number): boolean {
  const dx = u - cx;
  const dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}

function inPoly(u: number, v: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2] as number;
    const yi = poly[i * 2 + 1] as number;
    const xj = poly[j * 2] as number;
    const yj = poly[j * 2 + 1] as number;
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRect(u: number, v: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return u >= x0 && u <= x1 && v >= y0 && v <= y1;
}

const KNIGHT_POLY = [
  0.34, 0.86, 0.30, 0.62, 0.34, 0.44, 0.30, 0.30, 0.38, 0.16, 0.46, 0.22, 0.52, 0.16,
  0.62, 0.20, 0.70, 0.34, 0.72, 0.50, 0.66, 0.62, 0.64, 0.86
];

const QUEEN_POLY = [
  0.26, 0.86, 0.28, 0.52, 0.18, 0.30, 0.30, 0.42, 0.36, 0.22, 0.44, 0.40, 0.50, 0.18,
  0.56, 0.40, 0.64, 0.22, 0.70, 0.42, 0.82, 0.30, 0.72, 0.52, 0.74, 0.86
];

/** Is normalized point (u,v) inside piece `type`? */
export function insidePiece(type: string, u: number, v: number): boolean {
  switch (type) {
    case 'p':
      return (
        inCircle(u, v, 0.5, 0.30, 0.13) ||
        inPoly(u, v, [0.42, 0.40, 0.58, 0.40, 0.64, 0.78, 0.36, 0.78]) ||
        inRect(u, v, 0.30, 0.78, 0.70, 0.88)
      );
    case 'r':
      return (
        inRect(u, v, 0.30, 0.30, 0.70, 0.40) ||
        inRect(u, v, 0.30, 0.18, 0.40, 0.30) ||
        inRect(u, v, 0.45, 0.18, 0.55, 0.30) ||
        inRect(u, v, 0.60, 0.18, 0.70, 0.30) ||
        inPoly(u, v, [0.34, 0.40, 0.66, 0.40, 0.70, 0.78, 0.30, 0.78]) ||
        inRect(u, v, 0.26, 0.78, 0.74, 0.88)
      );
    case 'n':
      return inPoly(u, v, KNIGHT_POLY);
    case 'b':
      return (
        inCircle(u, v, 0.5, 0.22, 0.06) ||
        inCircle(u, v, 0.5, 0.44, 0.15) ||
        inPoly(u, v, [0.42, 0.55, 0.58, 0.55, 0.64, 0.80, 0.36, 0.80]) ||
        inRect(u, v, 0.30, 0.80, 0.70, 0.88)
      );
    case 'q':
      return inPoly(u, v, QUEEN_POLY) || inRect(u, v, 0.26, 0.86, 0.74, 0.92);
    case 'k':
      return (
        inRect(u, v, 0.47, 0.10, 0.53, 0.28) ||
        inRect(u, v, 0.41, 0.16, 0.59, 0.22) ||
        inCircle(u, v, 0.5, 0.40, 0.13) ||
        inPoly(u, v, [0.40, 0.50, 0.60, 0.50, 0.66, 0.80, 0.34, 0.80]) ||
        inRect(u, v, 0.28, 0.80, 0.72, 0.90)
      );
    default:
      return false;
  }
}

export interface BoardPaintOptions {
  lightColor: [number, number, number];
  darkColor: [number, number, number];
  size: number;
  rng: () => number;
  /** Wood-grain texture amplitude (0..12). */
  grain?: number;
  jitter?: number;
}

/**
 * Paint the canonical top-down board (a8 top-left, White at bottom) for a
 * FEN into an RGBA buffer. Pieces are two-tone silhouettes: white pieces are
 * near-white with a dark outline, black pieces near-black with a light rim,
 * exactly like a real Staunton set photographed from above.
 */
export function paintBoard(fen: string, opts: BoardPaintOptions): Uint8ClampedArray {
  const { size, lightColor, darkColor, rng } = opts;
  const grain = opts.grain ?? 4;
  const jitter = opts.jitter ?? 0;
  const chess = new Chess(fen);
  const board = chess.board();
  const out = new Uint8ClampedArray(size * size * 4);
  const sq = size / 8;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.min(7, (y / sq) | 0);
      const col = Math.min(7, (x / sq) | 0);
      const dark = ((row + col) & 1) === 0;
      const base = dark ? darkColor : lightColor;
      // Subtle grain so squares are not perfectly flat (edge energy > 0).
      const g = (rng() - 0.5) * 2 * grain;
      const o = (y * size + x) * 4;
      out[o] = clamp255((base[0] as number) + g);
      out[o + 1] = clamp255((base[1] as number) + g);
      out[o + 2] = clamp255((base[2] as number) + g);
      out[o + 3] = 255;
    }
  }

  // Pieces.
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row]?.[col];
      if (!piece) continue;
      const jx = jitter ? (rng() - 0.5) * 2 * jitter * sq : 0;
      const jy = jitter ? (rng() - 0.5) * 2 * jitter * sq : 0;
      const x0 = col * sq + jx;
      const y0 = row * sq + jy;
      const ix0 = Math.max(0, Math.floor(x0));
      const iy0 = Math.max(0, Math.floor(y0));
      const ix1 = Math.min(size - 1, Math.ceil(x0 + sq));
      const iy1 = Math.min(size - 1, Math.ceil(y0 + sq));
      for (let y = iy0; y <= iy1; y++) {
        for (let x = ix0; x <= ix1; x++) {
          const u = (x - x0) / sq;
          const v = (y - y0) / sq;
          if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) continue;
          if (!insidePiece(piece.type, u, v)) continue;
          // Outline: inside now but outside when nudged in any direction.
          const eps = 1.6 / sq;
          const border =
            !insidePiece(piece.type, u + eps, v) ||
            !insidePiece(piece.type, u - eps, v) ||
            !insidePiece(piece.type, u, v + eps) ||
            !insidePiece(piece.type, u, v - eps);
          const o = (y * size + x) * 4;
          if (piece.color === 'w') {
            const c = border ? [55, 50, 45] : [246, 244, 236];
            out[o] = c[0] as number;
            out[o + 1] = c[1] as number;
            out[o + 2] = c[2] as number;
          } else {
            const c = border ? [185, 178, 165] : [24, 22, 22];
            out[o] = c[0] as number;
            out[o + 1] = c[1] as number;
            out[o + 2] = c[2] as number;
          }
        }
      }
    }
  }
  return out;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/** Random but plausible board corners inside the output frame. */
export function randomCorners(rng: () => number, outW: number, outH: number, margin = 0.12): CornerQuad {
  const mx = outW * margin;
  const my = outH * margin;
  // Strong perspective: top edge shorter (board recedes), plus per-corner jitter.
  const inset = outW * (0.10 + rng() * 0.12);
  const j = (): number => (rng() - 0.5) * outW * 0.03;
  return [
    mx + inset + j(), my + j(), //                a8 top-left
    outW - mx - inset + j(), my + j(), //          h8 top-right
    outW - mx + j(), outH - my + j(), //           h1 bottom-right
    mx + j(), outH - my + j() //                   a1 bottom-left
  ];
}

/** The canonical board corner order used by calibration/LUT code. */
export function canonicalCorners(size: number): CornerQuad {
  return [0, 0, size, 0, size, size, 0, size];
}

/**
 * Render one full synthetic camera frame for a FEN.
 */
export function renderSyntheticFrame(options: SynthFrameOptions): SynthFrame {
  const outW = options.outW ?? 640;
  const outH = options.outH ?? 360;
  const boardPx = options.boardPx ?? 512;
  const seed = options.seed ?? 1234;
  const rng = makeRng(seed);

  const lightColor = options.lightColor ?? [225 + rng() * 14, 200 + rng() * 14, 160 + rng() * 14];
  const darkColor = options.darkColor ?? [148 + rng() * 14, 105 + rng() * 12, 66 + rng() * 10];
  const jitter = options.jitter ?? rng() * 0.04;

  const board = paintBoard(options.fen, {
    lightColor: lightColor as [number, number, number],
    darkColor: darkColor as [number, number, number],
    size: boardPx,
    rng,
    grain: 3 + rng() * 5,
    jitter
  });

  const corners = options.corners ?? randomCorners(rng, outW, outH);
  const H = homographyFromQuads(canonicalCorners(boardPx), corners);
  if (!H) throw new Error('synth: degenerate corner quad');
  const lut = buildWarpLUT(H, outW, outH, boardPx, boardPx);
  if (!lut) throw new Error('synth: warp LUT failed');

  const frame = new Uint8ClampedArray(outW * outH * 4);
  warpRGBA(lut, board, frame);

  // Background fill for pixels outside the board (table surface).
  for (let i = 0; i < outW * outH; i++) {
    if (lut.coords[i * 2] < 0) {
      frame[i * 4] = 60;
      frame[i * 4 + 1] = 52;
      frame[i * 4 + 2] = 46;
      frame[i * 4 + 3] = 255;
    }
  }

  // Lighting: brightness, contrast, left-right gradient.
  const brightness = options.brightness ?? 0.75 + rng() * 0.6;
  const contrast = options.contrast ?? 0.9 + rng() * 0.25;
  const gradient = options.gradient ?? rng() * 0.3;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = (y * outW + x) * 4;
      const grad = 1 + gradient * ((x / outW) * 2 - 1);
      const k = brightness * grad;
      for (let c = 0; c < 3; c++) {
        const v = frame[o + c] as number;
        frame[o + c] = clamp255(((v / 255 - 0.5) * contrast + 0.5) * 255 * k);
      }
    }
  }

  // Optional hand: skin-tone ellipse with texture.
  if (options.hand) {
    const h = options.hand;
    const cosA = Math.cos(h.angle);
    const sinA = Math.sin(h.angle);
    for (let y = Math.max(0, Math.floor(h.cy - h.ry * 1.5)); y < Math.min(outH, Math.ceil(h.cy + h.ry * 1.5)); y++) {
      for (let x = Math.max(0, Math.floor(h.cx - h.rx * 1.5)); x < Math.min(outW, Math.ceil(h.cx + h.rx * 1.5)); x++) {
        const dx = x - h.cx;
        const dy = y - h.cy;
        const u = (dx * cosA + dy * sinA) / h.rx;
        const v = (-dx * sinA + dy * cosA) / h.ry;
        if (u * u + v * v <= 1) {
          const o = (y * outW + x) * 4;
          const n = (rng() - 0.5) * 14;
          frame[o] = clamp255(214 + n);
          frame[o + 1] = clamp255(168 + n);
          frame[o + 2] = clamp255(134 + n);
        }
      }
    }
  }

  // Gaussian noise (Box-Muller).
  const noise = options.noise ?? rng() * 8;
  if (noise > 0.01) {
    for (let i = 0; i < outW * outH * 4; i += 4) {
      const u1 = Math.max(1e-9, rng());
      const u2 = rng();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * noise;
      frame[i] = clamp255((frame[i] as number) + g);
      frame[i + 1] = clamp255((frame[i + 1] as number) + g * 0.9);
      frame[i + 2] = clamp255((frame[i + 2] as number) + g * 1.1);
    }
  }

  // Separable box blur.
  const blur = options.blur ?? (rng() < 0.5 ? 0 : 1 + rng());
  if (blur >= 1) boxBlur(frame, outW, outH, Math.min(3, Math.round(blur)));

  return { rgba: frame, w: outW, h: outH, corners };
}

/** In-place separable box blur on RGBA (alpha untouched). */
export function boxBlur(buf: Uint8ClampedArray, w: number, h: number, r: number): void {
  if (r < 1) return;
  const tmp = new Uint8ClampedArray(buf.length);
  // Horizontal.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        const o = (y * w + xx) * 4;
        rs += buf[o] as number;
        gs += buf[o + 1] as number;
        bs += buf[o + 2] as number;
        n++;
      }
      const o = (y * w + x) * 4;
      tmp[o] = rs / n;
      tmp[o + 1] = gs / n;
      tmp[o + 2] = bs / n;
      tmp[o + 3] = 255;
    }
  }
  // Vertical.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        const o = (yy * w + x) * 4;
        rs += tmp[o] as number;
        gs += tmp[o + 1] as number;
        bs += tmp[o + 2] as number;
        n++;
      }
      const o = (y * w + x) * 4;
      buf[o] = rs / n;
      buf[o + 1] = gs / n;
      buf[o + 2] = bs / n;
      buf[o + 3] = 255;
    }
  }
}

/**
 * Render a frame from an ALREADY PAINTED canonical board (perf path for the
 * demo player and tests that render many frames of the same position).
 */
export function renderFrameFromBoard(
  board: Uint8ClampedArray,
  boardPx: number,
  opts: SynthFrameOptions
): SynthFrame {
  const outW = opts.outW ?? 640;
  const outH = opts.outH ?? 360;
  const seed = opts.seed ?? 1234;
  const rng = makeRng(seed);
  const corners = opts.corners ?? randomCorners(rng, outW, outH);
  const H = homographyFromQuads(canonicalCorners(boardPx), corners);
  if (!H) throw new Error('synth: degenerate corner quad');
  const lut = buildWarpLUT(H, outW, outH, boardPx, boardPx);
  if (!lut) throw new Error('synth: warp LUT failed');
  const frame = new Uint8ClampedArray(outW * outH * 4);
  warpRGBA(lut, board, frame);
  for (let i = 0; i < outW * outH; i++) {
    if (lut.coords[i * 2] < 0) {
      frame[i * 4] = 60;
      frame[i * 4 + 1] = 52;
      frame[i * 4 + 2] = 46;
      frame[i * 4 + 3] = 255;
    }
  }
  const brightness = opts.brightness ?? 0.75 + rng() * 0.6;
  const contrast = opts.contrast ?? 0.9 + rng() * 0.25;
  const gradient = opts.gradient ?? rng() * 0.3;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = (y * outW + x) * 4;
      const grad = 1 + gradient * ((x / outW) * 2 - 1);
      const k = brightness * grad;
      for (let c = 0; c < 3; c++) {
        const v = frame[o + c] as number;
        frame[o + c] = clamp255(((v / 255 - 0.5) * contrast + 0.5) * 255 * k);
      }
    }
  }
  if (opts.hand) {
    const h = opts.hand;
    const cosA = Math.cos(h.angle);
    const sinA = Math.sin(h.angle);
    for (let y = Math.max(0, Math.floor(h.cy - h.ry * 1.5)); y < Math.min(outH, Math.ceil(h.cy + h.ry * 1.5)); y++) {
      for (let x = Math.max(0, Math.floor(h.cx - h.rx * 1.5)); x < Math.min(outW, Math.ceil(h.cx + h.rx * 1.5)); x++) {
        const dx = x - h.cx;
        const dy = y - h.cy;
        const u = (dx * cosA + dy * sinA) / h.rx;
        const v = (-dx * sinA + dy * cosA) / h.ry;
        if (u * u + v * v <= 1) {
          const o = (y * outW + x) * 4;
          const n = (rng() - 0.5) * 14;
          frame[o] = clamp255(214 + n);
          frame[o + 1] = clamp255(168 + n);
          frame[o + 2] = clamp255(134 + n);
        }
      }
    }
  }
  const noise = opts.noise ?? rng() * 8;
  if (noise > 0.01) {
    for (let i = 0; i < outW * outH * 4; i += 4) {
      const u1 = Math.max(1e-9, rng());
      const u2 = rng();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * noise;
      frame[i] = clamp255((frame[i] as number) + g);
      frame[i + 1] = clamp255((frame[i + 1] as number) + g * 0.9);
      frame[i + 2] = clamp255((frame[i + 2] as number) + g * 1.1);
    }
  }
  const blur = opts.blur ?? (rng() < 0.5 ? 0 : 1 + rng());
  if (blur >= 1) boxBlur(frame, outW, outH, Math.min(3, Math.round(blur)));
  return { rgba: frame, w: outW, h: outH, corners };
}
