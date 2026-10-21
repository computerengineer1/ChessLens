/**
 * Perspective warp with a precomputed lookup table.
 *
 * The LUT stores, for every destination pixel, the (sx, sy) source
 * coordinates as float32 pairs (or -1,-1 when outside the source image).
 * Building it is O(dstW*dstH) and happens once per calibration; per-frame
 * warping is then pure bilinear sampling with zero allocations.
 */

import { type H3, invertH } from './homography.js';

export const WARP_SIZE = 512; // canonical warped board is 512x512 (64px/square)
export const SQUARE_PX = 64;

export interface WarpLUT {
  /** Interleaved (sx, sy) per destination pixel, -1 for out-of-bounds. */
  coords: Float32Array;
  dstW: number;
  dstH: number;
  srcW: number;
  srcH: number;
}

/**
 * Build the sampling LUT for H (src -> dst).
 * Out-of-bounds destination pixels get (-1, -1).
 */
export function buildWarpLUT(H: H3, dstW: number, dstH: number, srcW: number, srcH: number): WarpLUT | null {
  const Hi = invertH(H);
  if (!Hi) return null;
  const coords = new Float32Array(dstW * dstH * 2);
  for (let dy = 0; dy < dstH; dy++) {
    // Pixel-center convention: destination point is (dx + 0.5, dy + 0.5).
    // Row terms that depend only on y are hoisted out of the inner loop.
    const y = dy + 0.5;
    const sxY = Hi[1] * y + Hi[2];
    const syY = Hi[4] * y + Hi[5];
    const wY = Hi[7] * y + Hi[8];
    for (let dx = 0; dx < dstW; dx++) {
      const x = dx + 0.5;
      const w = Hi[6] * x + wY;
      const idx = (dy * dstW + dx) * 2;
      if (Math.abs(w) < 1e-9) {
        coords[idx] = -1;
        coords[idx + 1] = -1;
        continue;
      }
      const sx = (Hi[0] * x + sxY) / w;
      const sy = (Hi[3] * x + syY) / w;
      if (sx < 0 || sy < 0 || sx > srcW - 1 || sy > srcH - 1) {
        coords[idx] = -1;
        coords[idx + 1] = -1;
      } else {
        coords[idx] = sx;
        coords[idx + 1] = sy;
      }
    }
  }
  return { coords, dstW, dstH, srcW, srcH };
}

/** Fraction of destination pixels covered by the source image (calibration quality). */
export function lutCoverage(lut: WarpLUT): number {
  let ok = 0;
  const n = lut.dstW * lut.dstH;
  for (let i = 0; i < n; i++) {
    if (lut.coords[i * 2] >= 0) ok++;
  }
  return ok / n;
}

/**
 * Warp an RGBA source frame into separate grayscale / saturation / chroma
 * planes of the destination, via bilinear sampling. Preallocated outputs.
 */
export function warpPlanes(
  lut: WarpLUT,
  rgba: Uint8ClampedArray | Uint8Array,
  gray: Uint8Array,
  sat: Uint8Array,
  cb: Uint8Array,
  cr: Uint8Array
): void {
  const { coords, dstW, dstH, srcW } = lut;
  const n = dstW * dstH;
  for (let i = 0; i < n; i++) {
    const sx = coords[i * 2] as number;
    const sy = coords[i * 2 + 1] as number;
    if (sx < 0) {
      gray[i] = 0;
      sat[i] = 0;
      cb[i] = 128;
      cr[i] = 128;
      continue;
    }
    const x0 = sx | 0;
    const y0 = sy | 0;
    const fx = sx - x0;
    const fy = sy - y0;
    const x1 = Math.min(x0 + 1, srcW - 1);
    const base0 = (y0 * srcW + x0) * 4;
    const base1 = (y0 * srcW + x1) * 4;
    const stride = srcW * 4;
    const base2 = base0 + stride;
    const base3 = base1 + stride;
    const w00 = (1 - fx) * (1 - fy);
    const w01 = fx * (1 - fy);
    const w10 = (1 - fx) * fy;
    const w11 = fx * fy;

    const r =
      (rgba[base0] as number) * w00 + (rgba[base1] as number) * w01 +
      (rgba[base2] as number) * w10 + (rgba[base3] as number) * w11;
    const g =
      (rgba[base0 + 1] as number) * w00 + (rgba[base1 + 1] as number) * w01 +
      (rgba[base2 + 1] as number) * w10 + (rgba[base3 + 1] as number) * w11;
    const b =
      (rgba[base0 + 2] as number) * w00 + (rgba[base1 + 2] as number) * w01 +
      (rgba[base2 + 2] as number) * w10 + (rgba[base3 + 2] as number) * w11;

    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;

    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat[i] = mx > 0 ? (((mx - mn) / mx) * 255) | 0 : 0;

    // JPEG-style YCbCr chroma (skin detection).
    let cbv = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    let crv = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    cbv = cbv < 0 ? 0 : cbv > 255 ? 255 : cbv;
    crv = crv < 0 ? 0 : crv > 255 ? 255 : crv;
    cb[i] = cbv;
    cr[i] = crv;
  }
}

/**
 * Warp RGBA -> RGBA (used by the calibration preview and debug view).
 * dst must be preallocated with dstW*dstH*4 bytes.
 */
export function warpRGBA(
  lut: WarpLUT,
  rgba: Uint8ClampedArray | Uint8Array,
  dst: Uint8ClampedArray
): void {
  const { coords, dstW, dstH, srcW } = lut;
  const n = dstW * dstH;
  for (let i = 0; i < n; i++) {
    const sx = coords[i * 2] as number;
    const sy = coords[i * 2 + 1] as number;
    const o = i * 4;
    if (sx < 0) {
      dst[o] = 0;
      dst[o + 1] = 0;
      dst[o + 2] = 0;
      dst[o + 3] = 255;
      continue;
    }
    const x0 = sx | 0;
    const y0 = sy | 0;
    const fx = sx - x0;
    const fy = sy - y0;
    const x1 = Math.min(x0 + 1, srcW - 1);
    const base0 = (y0 * srcW + x0) * 4;
    const base1 = (y0 * srcW + x1) * 4;
    const stride = srcW * 4;
    const base2 = base0 + stride;
    const base3 = base1 + stride;
    const w00 = (1 - fx) * (1 - fy);
    const w01 = fx * (1 - fy);
    const w10 = (1 - fx) * fy;
    const w11 = fx * fy;
    for (let c = 0; c < 3; c++) {
      dst[o + c] =
        (rgba[base0 + c] as number) * w00 + (rgba[base1 + c] as number) * w01 +
        (rgba[base2 + c] as number) * w10 + (rgba[base3 + c] as number) * w11;
    }
    dst[o + 3] = 255;
  }
}

/** Downscale RGBA into a smaller RGBA buffer (box filter, preallocated). */
export function downscaleRGBA(
  src: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number
): void {
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(srcH, Math.ceil((y + 1) * sy));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(srcW, Math.ceil((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        const rowBase = yy * srcW * 4;
        for (let xx = x0; xx < x1; xx++) {
          const p = rowBase + xx * 4;
          r += src[p] as number;
          g += src[p + 1] as number;
          b += src[p + 2] as number;
          n++;
        }
      }
      const o = (y * dstW + x) * 4;
      dst[o] = n ? r / n : 0;
      dst[o + 1] = n ? g / n : 0;
      dst[o + 2] = n ? b / n : 0;
      dst[o + 3] = 255;
    }
  }
}
