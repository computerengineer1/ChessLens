/**
 * Generates web/electron icons from scripts/icon-lib.mjs.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawIcon, downscale, encodePNG, canvasToRGBA } from './icon-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function writeIcon(path, size, supersample = 4) {
  const c = drawIcon(size * supersample);
  const img = downscale({ w: c.w, h: c.h, data: canvasToRGBA(c) }, size);
  writeFileSync(path, encodePNG(img.width, img.height, img.rgba));
  console.log(`icon: ${path} (${size}x${size})`);
}

function writeICO(path, pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.buf.length;
    entries.push(e, p.buf);
  }
  writeFileSync(path, Buffer.concat([header, ...entries]));
  console.log(`icon: ${path} (ICO, ${pngs.map((p) => p.size).join('+')}px)`);
}

mkdirSync(join(root, 'public', 'icons'), { recursive: true });
mkdirSync(join(root, 'assets'), { recursive: true });

writeIcon(join(root, 'public', 'icons', 'icon-512.png'), 512);
writeIcon(join(root, 'public', 'icons', 'icon-192.png'), 192);
writeIcon(join(root, 'public', 'icons', 'apple-touch-icon.png'), 180);
writeIcon(join(root, 'public', 'icons', 'favicon.png'), 64);
writeIcon(join(root, 'assets', 'icon.png'), 512, 2);
writeIcon(join(root, 'assets', 'icon-1024.png'), 1024, 1);
const icoSizes = [16, 32, 48, 256];
const pngs = icoSizes.map((size) => {
  const c = drawIcon(size * 4);
  const img = downscale({ w: c.w, h: c.h, data: canvasToRGBA(c) }, size);
  return { size, buf: encodePNG(img.width, img.height, img.rgba) };
});
writeICO(join(root, 'assets', 'icon.ico'), pngs);
console.log('icons done');
