/**
 * Bundles electron/main.ts -> electron/dist/main.mjs (ESM) and
 * electron/preload.ts -> electron/dist/preload.cjs (CJS; sandboxed
 * preloads must be CommonJS). Uses rolldown (Vite 8's bundler, already a
 * dependency of vite - no extra package needed).
 */
import { build } from 'rolldown';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'electron', 'dist');
mkdirSync(out, { recursive: true });

await build({
  input: join(root, 'electron', 'main.ts'),
  external: ['electron'],
  platform: 'node',
  output: { file: join(out, 'main.mjs'), format: 'es' }
});

await build({
  input: join(root, 'electron', 'preload.ts'),
  external: ['electron'],
  platform: 'node',
  output: { file: join(out, 'preload.cjs'), format: 'cjs' }
});

console.log('electron bundles written to electron/dist');
