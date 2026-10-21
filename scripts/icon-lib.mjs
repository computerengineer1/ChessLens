/**
 * Shared icon raster library: minimal PNG encoder + the ChessLens neon
 * icon painter. Used by gen-icons.mjs (web/electron assets) and
 * gen-android-art.mjs (splash + launcher rasters at template sizes).
 */
/**
 * Generates all app icons deterministically (no external tools, no AI):
 * a dark rounded tile with a neon-cyan perspective chessboard grid, two
 * glowing green suggestion squares and a lens ring - the app's visual
 * language. Writes PNGs (pure encoder via node:zlib) into public/icons and
 * assets/icon.png + assets/icon.ico for Electron/electron-builder.
 */
import { deflateSync } from 'node:zlib';


// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit RGBA, filter 0).
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Drawing helpers (supersampled: render at 4x then box-downscale).
// ---------------------------------------------------------------------------
export function makeCanvas(w, h) {
  return { w, h, data: new Float64Array(w * h * 4) }; // RGBA floats 0..255
}

export function putPx(c, x, y, r, g, b, a = 1) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const sa = a;
  c.data[i] = c.data[i] * (1 - sa) + r * sa;
  c.data[i + 1] = c.data[i + 1] * (1 - sa) + g * sa;
  c.data[i + 2] = c.data[i + 2] * (1 - sa) + b * sa;
  c.data[i + 3] = Math.min(255, c.data[i + 3] + a * 255);
}

function fillQuad(c, pts, r, g, b, a) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(c.w - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(c.h - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inQuad(x + 0.5, y + 0.5, pts)) putPx(c, x, y, r, g, b, a);
    }
  }
}

function inQuad(px, py, pts) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % 4];
    const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

function strokeQuad(c, pts, width, r, g, b, aBase) {
  // Multi-pass "glow": draw the outline several times with growing width.
  const layers = [
    [width * 6, 0.05],
    [width * 4, 0.09],
    [width * 2.4, 0.15],
    [width * 1.5, 0.3],
    [width, 1]
  ];
  for (const [w, f] of layers) strokeQuadOnce(c, pts, w, r, g, b, aBase * f);
}

function strokeQuadOnce(c, pts, width, r, g, b, a) {
  for (let i = 0; i < 4; i++) strokeLine(c, pts[i], pts[(i + 1) % 4], width, r, g, b, a);
}

function strokeLine(c, p1, p2, width, r, g, b, a) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  fillQuad(
    c,
    [
      [x1 + nx, y1 + ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
      [x1 - nx, y1 - ny]
    ],
    r,
    g,
    b,
    a
  );
}

function strokeCircle(c, cx, cy, rad, width, r, g, b, a) {
  const steps = Math.max(48, Math.floor(rad * 2));
  for (let i = 0; i < steps; i++) {
    const t1 = (i / steps) * Math.PI * 2;
    const t2 = ((i + 1) / steps) * Math.PI * 2;
    strokeLine(
      c,
      [cx + Math.cos(t1) * rad, cy + Math.sin(t1) * rad],
      [cx + Math.cos(t2) * rad, cy + Math.sin(t2) * rad],
      width,
      r,
      g,
      b,
      a
    );
  }
}

export function downscale(src, outW) {
  const f = src.w / outW;
  const outH = Math.round(src.h / f);
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(y * f); sy < Math.min(src.h, Math.floor((y + 1) * f)); sy++) {
        for (let sx = Math.floor(x * f); sx < Math.min(src.w, Math.floor((x + 1) * f)); sx++) {
          const i = (sy * src.w + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          n++;
        }
      }
      const o = (y * outW + x) * 4;
      out[o] = n ? r / n : 0;
      out[o + 1] = n ? g / n : 0;
      out[o + 2] = n ? b / n : 0;
      out[o + 3] = n ? a / n : 255;
    }
  }
  return { width: outW, height: outH, rgba: out };
}

// ---------------------------------------------------------------------------
// The icon itself.
// ---------------------------------------------------------------------------
export function drawIcon(S) {
  const c = makeCanvas(S, S);
  // Background: dark navy tile with a subtle vertical gradient.
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const r = 9 + t * 6;
    const g = 12 + t * 8;
    const b = 18 + t * 12;
    for (let x = 0; x < S; x++) putPx(c, x, y, r, g, b, 1);
  }
  // Rounded-corner mask (alpha outside radius set to 0).
  const radius = S * 0.22;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = x < radius ? radius : x > S - radius ? S - radius : x;
      const cy = y < radius ? radius : y > S - radius ? S - radius : y;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) {
        const i = (y * S + x) * 4;
        c.data[i + 3] = 0;
      }
    }
  }

  // Perspective board grid (trapezoid, vanishing upward).
  const L = S * 0.14;
  const R = S * 0.86;
  const topL = S * 0.34;
  const topR = S * 0.66;
  const topY = S * 0.36;
  const botY = S * 0.82;
  const board = [
    [topL, topY],
    [topR, topY],
    [R, botY],
    [L, botY]
  ];
  // Dark board fill.
  fillQuad(c, board, 16, 24, 34, 0.9);
  // Neon outline.
  strokeQuad(c, board, Math.max(1.5, S * 0.008), 0, 240, 255, 0.95);
  // Grid lines: interpolate the trapezoid (perspective-correct enough for an icon).
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const gridW = Math.max(1, S * 0.004);
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    // Vertical-ish lines.
    const pTop = lerp(board[0], board[1], t);
    const pBot = lerp(board[3], board[2], t);
    strokeLine(c, pTop, pBot, gridW, 0, 240, 255, 0.4);
    // Horizontal-ish lines with slight perspective compression toward the top.
    const tt = Math.pow(t, 0.82);
    const pL = lerp(board[0], board[3], tt);
    const pR2 = lerp(board[1], board[2], tt);
    strokeLine(c, pL, pR2, gridW, 0, 240, 255, 0.4);
  }
  // Two green suggestion squares (from/to) + tiny arrow.
  const sq = (col, rowT, rowB) => {
    const tA = Math.pow(rowT, 0.82);
    const tB = Math.pow(rowB, 0.82);
    const cA = [col / 8, (col + 1) / 8];
    const p1 = lerp(lerp(board[0], board[1], cA[0]), lerp(board[3], board[2], cA[0]), tA);
    const p2 = lerp(lerp(board[0], board[1], cA[1]), lerp(board[3], board[2], cA[1]), tA);
    const p3 = lerp(lerp(board[0], board[1], cA[1]), lerp(board[3], board[2], cA[1]), tB);
    const p4 = lerp(lerp(board[0], board[1], cA[0]), lerp(board[3], board[2], cA[0]), tB);
    return [p1, p2, p3, p4];
  };
  const q1 = sq(2, 5 / 8, 6 / 8);
  const q2 = sq(4, 3 / 8, 4 / 8);
  fillQuad(c, q1, 0, 255, 140, 0.32);
  strokeQuadOnce(c, q1, Math.max(1.5, S * 0.007), 0, 255, 140, 0.9);
  fillQuad(c, q2, 0, 255, 140, 0.32);
  strokeQuadOnce(c, q2, Math.max(1.5, S * 0.007), 0, 255, 140, 0.9);
  const mid = (q) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
  const m1 = mid(q1);
  const m2 = mid(q2);
  strokeLine(c, m1, m2, Math.max(2, S * 0.012), 0, 255, 140, 0.85);
  // Arrow head.
  const ang = Math.atan2(m2[1] - m1[1], m2[0] - m1[0]);
  const hl = S * 0.05;
  fillQuad(
    c,
    [
      m2,
      [m2[0] - hl * Math.cos(ang - 0.5), m2[1] - hl * Math.sin(ang - 0.5)],
      [m2[0] - hl * Math.cos(ang + 0.5), m2[1] - hl * Math.sin(ang + 0.5)],
      [m2[0] - hl * Math.cos(ang), m2[1] - hl * Math.sin(ang)]
    ],
    0,
    255,
    140,
    0.95
  );
  // Lens ring in the top-left, echoing "ChessLens".
  strokeCircle(c, S * 0.27, S * 0.21, S * 0.09, Math.max(2, S * 0.014), 0, 240, 255, 0.55);
  strokeCircle(c, S * 0.27, S * 0.21, S * 0.05, Math.max(1, S * 0.006), 0, 240, 255, 0.85);
  return c;
}

/** Solid dark background + centered icon (splash screens). */
export function drawSplash(S) {
  const c = makeCanvas(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) putPx(c, x, y, 11, 14, 20, 1);
  const icon = drawIcon(Math.round(S * 0.52));
  const off = Math.round((S - icon.w) / 2);
  for (let y = 0; y < icon.w; y++) {
    for (let x = 0; x < icon.w; x++) {
      const i = (y * icon.w + x) * 4;
      const a = icon.data[i + 3] / 255;
      if (a <= 0) continue;
      putPx(c, off + x, off + y, icon.data[i], icon.data[i + 1], icon.data[i + 2], a);
    }
  }
  return c;
}

/** Icon centered in the adaptive-icon safe zone (66%) on transparency. */
export function drawForeground(S) {
  const c = makeCanvas(S, S);
  const icon = drawIcon(Math.round(S * 0.62));
  const off = Math.round((S - icon.w) / 2);
  for (let y = 0; y < icon.w; y++) {
    for (let x = 0; x < icon.w; x++) {
      const i = (y * icon.w + x) * 4;
      const a = icon.data[i + 3] / 255;
      if (a <= 0) continue;
      putPx(c, off + x, off + y, icon.data[i], icon.data[i + 1], icon.data[i + 2], a);
    }
  }
  return c;
}

/** Rectangular splash for non-square template sizes. */
export function drawSplashRect(W, Hh) {
  const c = makeCanvas(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) putPx(c, x, y, 11, 14, 20, 1);
  const S = Math.round(Math.min(W, Hh) * 0.55);
  const icon = drawIcon(S);
  const ox = Math.round((W - S) / 2);
  const oy = Math.round((Hh - S) / 2);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const a = icon.data[i + 3] / 255;
      if (a <= 0) continue;
      putPx(c, ox + x, oy + y, icon.data[i], icon.data[i + 1], icon.data[i + 2], a);
    }
  }
  return c;
}

export function canvasToRGBA(c) {
  const out = new Uint8ClampedArray(c.w * c.h * 4);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(c.data[i])));
  return out;
}
