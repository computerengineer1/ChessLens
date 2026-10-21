import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_URL lets CI deploy under a GitHub Pages project path (e.g. /ChessLensAR/).
// Locally and inside Electron/Capacitor it stays '/', and index.html references
// assets relatively so a plain static host also works.
const base = process.env.BASE_URL ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 900
  },
  worker: {
    format: 'es'
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks'
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      injectManifest: {
        // Engine binaries are huge but must work offline: cache them explicitly.
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,ico,webmanifest}'],
        globIgnores: ['**/node_modules/**'],
        // The asm.js fallback engine is ~3.2 MB: raise the precache limit so
        // the whole engine ships in the offline cache.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024
      },
      manifest: {
        name: 'ChessLens AR',
        short_name: 'ChessLens',
        description: 'Live AR chess analysis from your camera. On-device Stockfish. Works offline.',
        theme_color: '#0b0e14',
        background_color: '#0b0e14',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      devOptions: { enabled: false }
    })
  ]
});
