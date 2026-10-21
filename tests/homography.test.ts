import { describe, expect, it } from 'vitest';
import {
  homographyFromQuads,
  applyH,
  invertH,
  multiplyH,
  identityH,
  reprojError,
  solveLinear
} from '../src/vision/homography.js';

describe('linear solver', () => {
  it('solves a well-conditioned system', () => {
    // 2x + y = 5 ; x - y = 1  -> x=2, y=1
    const A = new Float64Array([2, 1, 1, -1]);
    const b = new Float64Array([5, 1]);
    const x = solveLinear(A, b, 2);
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(2, 9);
    expect(x![1]).toBeCloseTo(1, 9);
  });

  it('returns null on singular systems', () => {
    const A = new Float64Array([1, 2, 2, 4]);
    const b = new Float64Array([1, 2]);
    expect(solveLinear(A, b, 2)).toBeNull();
  });
});

describe('homography', () => {
  const src = [10, 20, 300, 25, 310, 220, 8, 210];
  const dst = [0, 0, 512, 0, 512, 512, 0, 512];

  it('maps the four correspondences exactly', () => {
    const H = homographyFromQuads(src, dst);
    expect(H).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const p = applyH(H!, src[i * 2] as number, src[i * 2 + 1] as number);
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(dst[i * 2] as number, 6);
      expect(p!.y).toBeCloseTo(dst[i * 2 + 1] as number, 6);
    }
    expect(reprojError(H!, src, dst)).toBeLessThan(1e-6);
  });

  it('invertH round-trips points', () => {
    const H = homographyFromQuads(src, dst)!;
    const Hi = invertH(H)!;
    const p = applyH(H, 137.5, 91.25)!;
    const q = applyH(Hi, p.x, p.y)!;
    expect(q.x).toBeCloseTo(137.5, 6);
    expect(q.y).toBeCloseTo(91.25, 6);
  });

  it('multiplyH with identity is a no-op', () => {
    const H = homographyFromQuads(src, dst)!;
    const I = identityH();
    const R = multiplyH(H, I);
    for (let i = 0; i < 9; i++) expect(R[i]).toBeCloseTo(H[i] as number, 9);
  });

  it('preserves incidence: trapezoid diagonal intersection maps to center', () => {
    // Perspective does NOT preserve midpoints of edges, but it does preserve
    // line intersections. The diagonals of the board quad meet at the board
    // center in both spaces.
    const trap = [160, 60, 480, 60, 620, 340, 20, 340];
    const H = homographyFromQuads(trap, dst)!;
    // Intersection of the two diagonals of the trapezoid:
    //   line (160,60)-(620,340) and line (480,60)-(20,340) meet at x=320,
    //   y = 60 + 280 * (320-160)/460.
    const y = 60 + 280 * ((320 - 160) / 460);
    const p = applyH(H, 320, y)!;
    expect(p.x).toBeCloseTo(256, 6);
    expect(p.y).toBeCloseTo(256, 6);
  });

  it('rejects degenerate quads', () => {
    const bad = [0, 0, 10, 0, 20, 0, 30, 0]; // collinear
    expect(homographyFromQuads(bad, dst)).toBeNull();
  });
});
