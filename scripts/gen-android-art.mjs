/**
 * Regenerates every Android splash/launcher raster in
 * android/app/src/main/res at the exact dimensions of the Capacitor
 * template files (read from the PNG headers), using the shared icon lib.
 * Idempotent: run after `npx cap add android`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  drawIcon,
  drawSplashRect,
  drawForeground,
  downscale,
  encodePNG,
  canvasToRGBA
} from './icon-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'android', 'app', 'src', 'main', 'res');

function pngSize(file) {
  const d = readFileSync(file);
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
}

function writeCanvas(path, canvas, targetW, targetH) {
  const rgba = canvasToRGBA(canvas);
  let img;
  if (canvas.w === targetW && canvas.h === targetH) {
    img = { width: targetW, height: targetH, rgba };
  } else {
    img = downscale({ w: canvas.w, h: canvas.h, data: rgba }, targetW);
    if (img.height !== targetH) {
      // Non-square target: render directly instead of downscaling.
      const c = drawSplashRect(targetW * 2, targetH * 2);
      img = downscale({ w: c.w, h: c.h, data: canvasToRGBA(c) }, targetW);
    }
  }
  writeFileSync(path, encodePNG(img.width, img.height, img.rgba));
}

let count = 0;
for (const dir of readdirSync(res)) {
  const full = join(res, dir);
  if (!statSync(full).isDirectory()) continue;
  for (const file of readdirSync(full)) {
    if (!file.endsWith('.png')) continue;
    const path = join(full, file);
    const { w, h } = pngSize(path);
    if (file === 'splash.png') {
      writeCanvas(path, drawSplashRect(w * 2, h * 2), w, h);
      count++;
    } else if (file === 'ic_launcher_foreground.png') {
      writeCanvas(path, drawForeground(w * 2), w, h);
      count++;
    } else if (file === 'ic_launcher.png' || file === 'ic_launcher_round.png') {
      writeCanvas(path, drawIcon(w * 2), w, h);
      count++;
    }
  }
}
console.log(`android art: rewrote ${count} rasters`);
