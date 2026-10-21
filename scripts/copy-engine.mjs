/**
 * Copies the Stockfish engine files from node_modules into public/engine/.
 *
 * Uses the LITE SINGLE-THREADED WASM build (stockfish-19-lite-single.*):
 * no SharedArrayBuffer => no COOP/COEP headers needed => works on GitHub
 * Pages, Capacitor webviews and Electron without any server config.
 * The asm.js build is copied as an automatic fallback for old webviews.
 *
 * Verified against the real package layout (stockfish@19):
 *   node_modules/stockfish/bin/stockfish-19-lite-single.js   (worker loader)
 *   node_modules/stockfish/bin/stockfish-19-lite-single.wasm (engine)
 *   node_modules/stockfish/bin/stockfish-19-asm.js           (asm.js fallback)
 *   node_modules/stockfish/Copying.txt                       (GPLv3 license)
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(root, 'node_modules', 'stockfish', 'bin');
const outDir = join(root, 'public', 'engine');

if (!existsSync(binDir)) {
  console.error('copy-engine: node_modules/stockfish/bin not found. Run `npm install` first.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// Discover the lite-single pair by pattern so a stockfish minor bump
// (e.g. 19.x -> 20) does not silently break the copy.
const files = readdirSync(binDir);
const liteSingleJs = files.find((f) => /^stockfish-\d+(\.\d+)*-lite-single\.js$/.test(f));
const liteSingleWasm = liteSingleJs ? liteSingleJs.replace(/\.js$/, '.wasm') : null;
const asmJs = files.find((f) => /^stockfish-\d+(\.\d+)*-asm\.js$/.test(f));

if (!liteSingleJs || !liteSingleWasm || !existsSync(join(binDir, liteSingleWasm)) || !asmJs) {
  console.error('copy-engine: expected lite-single js/wasm and asm.js builds not found in', binDir);
  console.error('found:', files.join(', '));
  process.exit(1);
}

// Stable names consumed by src/engine/engineClient.ts.
const copies = [
  [liteSingleJs, 'stockfish-19-lite-single.js'],
  [liteSingleWasm, 'stockfish-19-lite-single.wasm'],
  [asmJs, 'stockfish-19-asm.js']
];
for (const [src, dst] of copies) {
  copyFileSync(join(binDir, src), join(outDir, dst));
  console.log(`copy-engine: ${src} -> public/engine/${dst}`);
}

// Keep the engine license next to the binaries (GPL compliance).
const copying = join(root, 'node_modules', 'stockfish', 'Copying.txt');
if (existsSync(copying)) {
  copyFileSync(copying, join(outDir, 'Copying.txt'));
  console.log('copy-engine: Copying.txt -> public/engine/Copying.txt');
}
