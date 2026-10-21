/**
 * Per-square feature extraction on the warped canonical board.
 *
 * All buffers are preallocated; the hot path performs zero allocations.
 * Only the central ~60% of each square is used, which avoids neighbour
 * spill-over and pieces leaning across square borders.
 */

import {
  FEATURE_COUNT,
  F_MEAN_Z,
  F_EDGE,
  F_SAT,
  F_TEMPLATE_DIFF,
  F_WHITE_MASS,
  F_BLACK_MASS,
  F_MIN_Z,
  F_MAX_Z
} from '../types.js';
import { SQUARE_PX } from './warp.js';
import { solveLinear } from './homography.js';

/** Central region size: 60% of a 64px square, odd for a centered window. */
export const CENTER_PX = 39; // ~60% of 64, centered => offset 12..50
const CENTER_OFF = (SQUARE_PX - CENTER_PX) >> 1; // 12

export interface FrameStats {
  /** Robust median of per-square mean luminance (0..255). */
  median: number;
  /** Robust scale so z-space is exposure invariant. */
  scale: number;
  /**
   * Lighting-direction detrend: z(plane) = planeB * (row - 3.5) +
   * planeC * (col - 3.5). Auto-exposure and side lighting shift luminance
   * across the board; removing the fitted plane keeps z-space stable when
   * the light direction changes between the scan and later frames.
   */
  planeB: number;
  planeC: number;
}

export interface FeatureBuffers {
  /** Per-square raw mean luminance of the center region. */
  squareMeanL: Float32Array; // 64
  /** Per-square mean saturation. */
  squareMeanSat: Float32Array; // 64
  /** Per-square mean absolute gradient (raw lum units). */
  squareEdge: Float32Array; // 64
  /** Per-square mean |zL - templateZ[s]| (filled by computeFeatures). */
  templateDiff: Float32Array; // 64
  /** Per-square white mass fraction (filled by computeFeatures). */
  whiteMass: Float32Array; // 64
  /** Per-square black mass fraction. */
  blackMass: Float32Array; // 64
  /** Final feature matrix, 64 x FEATURE_COUNT in z-space. */
  features: Float32Array;
  /** Scratch: per-square normalized mean luminance (z units). */
  squareZ: Float32Array; // 64
}

export function createFeatureBuffers(): FeatureBuffers {
  return {
    squareMeanL: new Float32Array(64),
    squareMeanSat: new Float32Array(64),
    squareEdge: new Float32Array(64),
    templateDiff: new Float32Array(64),
    whiteMass: new Float32Array(64),
    blackMass: new Float32Array(64),
    features: new Float32Array(64 * FEATURE_COUNT),
    squareZ: new Float32Array(64)
  };
}

function medianSorted(sorted: Float64Array, n: number): number {
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

/**
 * Pass 1: raw per-square aggregates (luminance, saturation, edge energy)
 * over the central region of each square.
 */
let scratchL: Float64Array | null = null;
let scratchSorted: Float64Array | null = null;

export function computeSquareStats(
  gray: Uint8Array,
  sat: Uint8Array,
  buf: FeatureBuffers,
  boardPx = SQUARE_PX
): void {
  const scratch = scratchL ?? (scratchL = new Float64Array(64));
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const s = row * 8 + col;
      const y0 = row * boardPx + CENTER_OFF * (boardPx / SQUARE_PX);
      const x0 = col * boardPx + CENTER_OFF * (boardPx / SQUARE_PX);
      const size = Math.max(2, Math.round(CENTER_PX * (boardPx / SQUARE_PX)));
      const stride = boardPx * 8; // warped image is 8 squares wide
      let sumL = 0;
      let sumS = 0;
      let edge = 0;
      let n = 0;
      for (let dy = 0; dy < size; dy++) {
        const py = ((y0 + dy) | 0) * stride;
        for (let dx = 0; dx < size; dx++) {
          const p = py + ((x0 + dx) | 0);
          const l = gray[p] as number;
          sumL += l;
          sumS += sat[p] as number;
          if (dx + 1 < size) edge += Math.abs(l - (gray[p + 1] as number));
          if (dy + 1 < size) edge += Math.abs(l - (gray[p + stride] as number));
          n++;
        }
      }
      buf.squareMeanL[s] = sumL / n;
      buf.squareMeanSat[s] = sumS / n;
      buf.squareEdge[s] = edge / Math.max(1, n * 2 - size * 2);
      scratch[s] = sumL / n;
    }
  }
}

/**
 * Pass 2: frame-level normalization parameters. Exposure changes shift and
 * stretch luminance; we normalize with a robust median/scale so class
 * statistics learned earlier stay valid.
 */
/**
 * Least-squares fit of a luminance plane over the 64 square means (z-space).
 * Writes planeB/planeC into `stats`. 3x3 normal equations, allocation-light.
 */
export function fitPlaneTrend(
  buf: FeatureBuffers,
  stats: FrameStats,
  emptyMask: Uint8Array | null = null
): void {
  const gain = 60 / stats.scale;
  const zRaw = (s: number): number => ((buf.squareMeanL[s] as number) - stats.median) * gain;
  const planeAt = (s: number, b: number, c: number): number => {
    const row = s >> 3;
    const col = s & 7;
    return b * (row - 3.5) + c * (col - 3.5);
  };
  const med = (vals: number[]): number => {
    if (vals.length === 0) return 0;
    const v = [...vals].sort((a, b) => a - b);
    return v[v.length >> 1] as number;
  };

  // Parity empty levels (the checkerboard offset). With a mask they come
  // from known-empty squares; otherwise from per-parity medians, which sit
  // inside the empty cluster whenever a parity is majority-empty (always
  // true in real games: <= 16 pieces per side spread over 32 squares).
  const parityLevel = [0, 0];
  if (emptyMask) {
    const dv: number[] = [];
    const lv: number[] = [];
    for (let s = 0; s < 64; s++) {
      if (emptyMask[s] !== 0) continue;
      (isDarkSquare(s) ? dv : lv).push(zRaw(s));
    }
    parityLevel[0] = dv.length ? med(dv) : -30;
    parityLevel[1] = lv.length ? med(lv) : 30;
  } else {
    const pb0 = stats.planeB ?? 0;
    const pc0 = stats.planeC ?? 0;
    const dv: number[] = [];
    const lv: number[] = [];
    for (let s = 0; s < 64; s++) {
      const zd = zRaw(s) - planeAt(s, pb0, pc0);
      (isDarkSquare(s) ? dv : lv).push(zd);
    }
    parityLevel[0] = med(dv);
    parityLevel[1] = med(lv);
  }
  const zd = (s: number): number => zRaw(s) - parityLevel[isDarkSquare(s) ? 0 : 1];

  const fitOn = (use: (s: number) => boolean): { b: number; c: number; n: number } => {
    // Least squares zd = a + b*rc + c*cc on parity-removed values, so the
    // checkerboard offset cannot leak into the tilt estimate.
    let n = 0;
    let sR = 0;
    let sC = 0;
    let sRR = 0;
    let sRC = 0;
    let sCC = 0;
    let sZ = 0;
    let sRZ = 0;
    let sCZ = 0;
    for (let row = 0; row < 8; row++) {
      const rc = row - 3.5;
      for (let col = 0; col < 8; col++) {
        const s = row * 8 + col;
        if (!use(s)) continue;
        const cc = col - 3.5;
        const z = zd(s);
        n++;
        sR += rc;
        sC += cc;
        sRR += rc * rc;
        sRC += rc * cc;
        sCC += cc * cc;
        sZ += z;
        sRZ += rc * z;
        sCZ += cc * z;
      }
    }
    if (n < 16) return { b: stats.planeB ?? 0, c: stats.planeC ?? 0, n };
    const A = new Float64Array([n, sR, sC, sR, sRR, sRC, sC, sRC, sCC]);
    const rhs = new Float64Array([sZ, sRZ, sCZ]);
    const sol = solveLinear(A, rhs, 3);
    if (!sol) return { b: stats.planeB ?? 0, c: stats.planeC ?? 0, n };
    return { b: sol[1] as number, c: sol[2] as number, n };
  };

  if (emptyMask) {
    const r = fitOn((s) => emptyMask[s] === 0);
    if (r.n >= 16) {
      stats.planeB = r.b;
      stats.planeC = r.c;
    }
    return;
  }

  // Runtime gate: squares whose (previous-plane-detrended) luminance sits at
  // the parity empty level. Pieces deviate by tens of z units; white-on-
  // light pieces sit near the empty-light level and pass the gate, but they
  // carry the same luminance as an empty light square, so they cannot bias
  // the parity-removed fit.
  const pb = stats.planeB ?? 0;
  const pc = stats.planeC ?? 0;
  const looksEmpty = (s: number): boolean => Math.abs(zd(s) - planeAt(s, pb, pc)) < 12;
  const r = fitOn(looksEmpty);
  if (r.n >= 16) {
    stats.planeB = r.b;
    stats.planeC = r.c;
  }
  // else: keep the previous plane (stable fallback).
}

export function computeFrameStats(buf: FeatureBuffers, out: FrameStats): FrameStats {
  const scratch = scratchSorted ?? (scratchSorted = new Float64Array(64));
  for (let i = 0; i < 64; i++) scratch[i] = buf.squareMeanL[i] as number;
  scratch.subarray(0, 64).sort();
  const median = medianSorted(scratch, 64);
  const p25 = medianSorted(scratch.subarray(0, 16), 16);
  const p75 = medianSorted(scratch.subarray(48, 64), 16);
  // Robust "std" from the interquartile range; floor guards flat frames.
  const iqr = Math.max(8, (p75 - p25) / 1.349);
  out.median = median;
  out.scale = iqr;
  if (out.planeB === undefined) out.planeB = 0;
  if (out.planeC === undefined) out.planeC = 0;
  return out;
}

/**
 * Pass 3: build the z-space feature matrix.
 * zL = (L - median) * 60 / scale  => typical light/dark square split is ~ +/-30.
 * templateDiff / whiteMass / blackMass use the per-square learned empty
 * template (z-space). massThreshold is in z units.
 */
export function computeFeatures(
  gray: Uint8Array,
  buf: FeatureBuffers,
  templateZ: Float32Array,
  stats: FrameStats,
  massThreshold: number,
  boardPx = SQUARE_PX
): void {
  const gain = 60 / stats.scale;
  const planeB = stats.planeB ?? 0;
  const planeC = stats.planeC ?? 0;
  const y0off = CENTER_OFF * (boardPx / SQUARE_PX);
  const size = Math.max(2, Math.round(CENTER_PX * (boardPx / SQUARE_PX)));
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const s = row * 8 + col;
      const squarePlane = planeB * (row - 3.5) + planeC * (col - 3.5);
      const zL = ((buf.squareMeanL[s] as number) - stats.median) * gain - squarePlane;
      const zEdge = (buf.squareEdge[s] as number) * gain;
      const satN = (buf.squareMeanSat[s] as number) / 255;
      const tpl = templateZ[s] as number;

      // Per-pixel template diff and mass ratios over the central region.
      let diffSum = 0;
      let whiteCnt = 0;
      let blackCnt = 0;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let n = 0;
      const stride = boardPx * 8;
      const y0 = row * boardPx + y0off;
      const x0 = col * boardPx + y0off;
      for (let dy = 0; dy < size; dy++) {
        const py = ((y0 + dy) | 0) * stride;
        for (let dx = 0; dx < size; dx++) {
          const p = py + ((x0 + dx) | 0);
          const px = (x0 + dx) / boardPx - 3.5; // col position in square units
          const pyy = (y0 + dy) / boardPx - 3.5; // row position in square units
          const pz = ((gray[p] as number) - stats.median) * gain - (planeB * pyy + planeC * px);
          const d = pz - tpl;
          diffSum += d < 0 ? -d : d;
          if (d > massThreshold) whiteCnt++;
          else if (-d > massThreshold) blackCnt++;
          if (pz < minZ) minZ = pz;
          if (pz > maxZ) maxZ = pz;
          n++;
        }
      }
      buf.templateDiff[s] = diffSum / n;
      buf.whiteMass[s] = whiteCnt / n;
      buf.blackMass[s] = blackCnt / n;
      buf.squareZ[s] = zL;

      const f = s * FEATURE_COUNT;
      buf.features[f + F_MEAN_Z] = zL;
      buf.features[f + F_EDGE] = zEdge;
      buf.features[f + F_SAT] = satN;
      buf.features[f + F_TEMPLATE_DIFF] = diffSum / n;
      buf.features[f + F_WHITE_MASS] = whiteCnt / n;
      buf.features[f + F_BLACK_MASS] = blackCnt / n;
      buf.features[f + F_MIN_Z] = minZ;
      buf.features[f + F_MAX_Z] = maxZ;
    }
  }
}

/** True when (row, col) is a dark square in canonical orientation (a8 dark). */
export function isDarkSquare(index: number): boolean {
  const row = index >> 3;
  const col = index & 7;
  return ((row + col) & 1) === 0;
}

/** Square name for a canonical index, e.g. 0 -> "a8". */
export function squareName(index: number): string {
  const row = index >> 3;
  const col = index & 7;
  return `${'abcdefgh'[col]}${8 - row}`;
}

/** Canonical index for a square name like "e4". Returns -1 when invalid. */
export function indexOfSquare(name: string): number {
  if (name.length !== 2) return -1;
  const col = name.charCodeAt(0) - 97;
  const rank = name.charCodeAt(1) - 49;
  if (col < 0 || col > 7 || rank < 0 || rank > 7) return -1;
  return (7 - rank) * 8 + col;
}

/**
 * Hand/occlusion heuristic.
 *
 * Wooden boards share chroma ranges with skin, so a GLOBAL skin fraction is
 * useless. Instead we measure skin ONLY inside squares whose classification
 * changed since the previous detection: a static board has no changed
 * squares (never triggers), while a hand sweeping the grid both changes
 * squares and shows skin chroma exactly there.
 *
 * Returns the skin fraction over the central pixels of changed squares
 * (0 when nothing changed).
 */
export function skinFractionInChanged(
  cb: Uint8Array,
  cr: Uint8Array,
  sat: Uint8Array,
  prev: Uint8Array | null,
  cur: Uint8Array,
  boardPx = SQUARE_PX
): number {
  if (!prev) return 0;
  const stride = boardPx * 8;
  const off = CENTER_OFF * (boardPx / SQUARE_PX);
  const size = Math.max(2, Math.round(CENTER_PX * (boardPx / SQUARE_PX)));
  let skin = 0;
  let total = 0;
  for (let s = 0; s < 64; s++) {
    if (prev[s] === cur[s]) continue;
    const row = s >> 3;
    const col = s & 7;
    const y0 = row * boardPx + off;
    const x0 = col * boardPx + off;
    for (let dy = 0; dy < size; dy++) {
      const py = ((y0 + dy) | 0) * stride;
      for (let dx = 0; dx < size; dx++) {
        const p = py + ((x0 + dx) | 0);
        total++;
        const cbv = cb[p] as number;
        const crv = cr[p] as number;
        if (cbv >= 77 && cbv <= 127 && crv >= 133 && crv <= 173 && (sat[p] as number) > 30) skin++;
      }
    }
  }
  return total ? skin / total : 0;
}
