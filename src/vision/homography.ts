/**
 * Projective transform (homography) utilities.
 *
 * A homography H maps source points to destination points:
 *   [x', y', w']^T = H [x, y, 1]^T,  (u, v) = (x'/w', y'/w')
 *
 * H is stored row-major as a 9-element array with H[8] = 1.
 * The 4-point solver builds the classic 8x8 linear system and solves it
 * with partial-pivoted Gaussian elimination - no external dependencies.
 */

export type H3 = Float64Array; // length 9

/** Solve a dense linear system A x = b in place (Gaussian elimination, partial pivot). */
export function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(n * (n + 1));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) M[r * (n + 1) + c] = A[r * n + c];
    M[r * (n + 1) + n] = b[r];
  }
  for (let col = 0; col < n; col++) {
    // pivot
    let best = col;
    let bestAbs = Math.abs(M[col * (n + 1) + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r * (n + 1) + col]);
      if (v > bestAbs) {
        bestAbs = v;
        best = r;
      }
    }
    if (bestAbs < 1e-12) return null; // singular
    if (best !== col) {
      for (let c = col; c <= n; c++) {
        const tmp = M[col * (n + 1) + c];
        M[col * (n + 1) + c] = M[best * (n + 1) + c];
        M[best * (n + 1) + c] = tmp;
      }
    }
    // eliminate
    const piv = M[col * (n + 1) + col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r * (n + 1) + col] / piv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r * (n + 1) + c] -= f * M[col * (n + 1) + c];
    }
  }
  // back substitution
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r * (n + 1) + n];
    for (let c = r + 1; c < n; c++) s -= M[r * (n + 1) + c] * (x[c] as number);
    x[r] = s / M[r * (n + 1) + r];
  }
  return x;
}

/**
 * Compute the homography mapping src quad -> dst quad.
 * src/dst are 8-element arrays: [x0,y0,x1,y1,x2,y2,x3,y3].
 * Returns null when the system is degenerate (collinear/duplicate points).
 */
export function homographyFromQuads(
  src: ArrayLike<number>,
  dst: ArrayLike<number>,
  out?: H3
): H3 | null {
  const A = new Float64Array(64);
  const b = new Float64Array(8);
  for (let i = 0; i < 4; i++) {
    const x = src[i * 2] as number;
    const y = src[i * 2 + 1] as number;
    const u = dst[i * 2] as number;
    const v = dst[i * 2 + 1] as number;
    // Row 2i:   x*h0 + y*h1 + h2 - u*x*h6 - u*y*h7 = u
    const r0 = (i * 2) * 8;
    A[r0 + 0] = x; A[r0 + 1] = y; A[r0 + 2] = 1;
    A[r0 + 3] = 0; A[r0 + 4] = 0; A[r0 + 5] = 0;
    A[r0 + 6] = -u * x; A[r0 + 7] = -u * y;
    b[i * 2] = u;
    // Row 2i+1: x*h3 + y*h4 + h5 - v*x*h6 - v*y*h7 = v
    const r1 = (i * 2 + 1) * 8;
    A[r1 + 0] = 0; A[r1 + 1] = 0; A[r1 + 2] = 0;
    A[r1 + 3] = x; A[r1 + 4] = y; A[r1 + 5] = 1;
    A[r1 + 6] = -v * x; A[r1 + 7] = -v * y;
    b[i * 2 + 1] = v;
  }
  const h = solveLinear(A, b, 8);
  if (!h) return null;
  const H = out ?? new Float64Array(9);
  for (let i = 0; i < 8; i++) H[i] = h[i] as number;
  H[8] = 1;
  return H;
}

/** Apply H to a point. Returns [u, v] or null when w ~ 0. */
export function applyH(H: H3, x: number, y: number, out?: { x: number; y: number }): { x: number; y: number } | null {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-12) return null;
  const u = (H[0] * x + H[1] * y + H[2]) / w;
  const v = (H[3] * x + H[4] * y + H[5]) / w;
  if (out) {
    out.x = u;
    out.y = v;
    return out;
  }
  return { x: u, y: v };
}

/** Invert a 3x3 homography. Returns null when singular. */
export function invertH(H: H3, out?: H3): H3 | null {
  const [a, b, c, d, e, f, g, h, i] = H as unknown as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const Hc = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const R = out ?? new Float64Array(9);
  R[0] = A * inv; R[1] = D * inv; R[2] = G * inv;
  R[3] = B * inv; R[4] = E * inv; R[5] = Hc * inv;
  R[6] = C * inv; R[7] = F * inv; R[8] = I * inv;
  return R;
}

/** Multiply two homographies: R = A * B. */
export function multiplyH(A: H3, B: H3, out?: H3): H3 {
  const R = out ?? new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      R[r * 3 + c] =
        A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return R;
}

/** Identity homography. */
export function identityH(out?: H3): H3 {
  const H = out ?? new Float64Array(9);
  H.fill(0);
  H[0] = 1; H[4] = 1; H[8] = 1;
  return H;
}

/**
 * Reprojection quality metric: mean pixel error of H mapping src -> dst
 * over the 4 correspondences. Used by the calibration UI.
 */
export function reprojError(H: H3, src: ArrayLike<number>, dst: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const p = applyH(H, src[i * 2] as number, src[i * 2 + 1] as number);
    if (!p) return Infinity;
    const dx = p.x - (dst[i * 2] as number);
    const dy = p.y - (dst[i * 2 + 1] as number);
    total += Math.hypot(dx, dy);
  }
  return total / 4;
}
