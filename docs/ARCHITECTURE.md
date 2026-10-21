# Architecture

ChessLens AR is a **fully on-device** chess analysis app: the camera sees a real
board, a self-supervised vision pipeline tracks the game move by move, and
Stockfish 19 (lite single-threaded WebAssembly) analyzes every confirmed
position. Nothing leaves the device: no backend, no accounts, no telemetry.

## Runtime topology

```
                 +------------------------------------------------------+
 camera / video  |  main thread                                         |
 file / demo  -> |  CameraSource --(ImageBitmap, transfer)-->+          |
                 |                                           |          |
                 |  +-------------------+   +----------------v-------+  |
                 |  | OverlayRenderer   |   | vision.worker.ts       |  |
                 |  | neon outline,     |   |  OffscreenCanvas 640x  |  |
                 |  | green squares,    |   |  360 -> warp LUT ->    |  |
                 |  | arrow, label      |   |  features -> classify  |  |
                 |  +--------^----------+   +-----------+------------+  |
                 |           |                          | Detection     |
                 |  +--------+----------+   +-----------v------------+  |
                 |  | EvalBar / LogPanel|   | Tracker (chess.js)     |  |
                 |  +--------^----------+   |  stability, inference, |  |
                 |           |              |  recovery, resync      |  |
                 |           |              +-----------+------------+  |
                 |  +--------+----------+               |               |
                 |  | engine.worker.ts  |<-- UCI ------+---------------+ |
                 |  |  nested worker:   |               |                |
                 |  |  stockfish-19-    |   EngineClient (UCI parse,     |
                 |  |  lite-single.wasm |   movetime/skill/multipv)      |
                 |  |  (asm.js fallback)|                                |
                 |  +-------------------+                                |
                 +------------------------------------------------------+
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/vision/homography.ts` | 4-point projective transform solver (8x8 Gaussian elimination), inverse, reprojection error |
| `src/vision/warp.ts` | Precomputed sampling LUT (Float32Array, bilinear), plane warping (gray/sat/Cb/Cr), downscale |
| `src/vision/features.ts` | Per-square features on the central 60%: z-luminance, edge energy, saturation, template diff, white/black mass; lighting plane detrend; skin chroma in changed squares |
| `src/vision/occupancy.ts` | Self-supervised 6-class Gaussian model (dark/light x empty/white/black), EMA template adaptation, softmax confidence |
| `src/vision/pipeline.ts` | Frame -> planes -> features -> classification -> temporal adopt-filter -> stability; scan/learn; pure TS so tests run the exact production code |
| `src/vision/vision.worker.ts` | Worker host: ImageBitmap intake, learn averaging, preview stream |
| `src/vision/synth.ts` | Synthetic board renderer (piece silhouettes, perspective, lighting, noise, blur, hand blobs) used by tests and `?demo=1` |
| `src/game/state.ts` | chess.js wrapper; canonical occupancy maps; O(1) expected-map builder (castling/en-passant aware) |
| `src/game/tracker.ts` | Stability gating, confidence-weighted move inference, ambiguity sheets, promotion handling, resync entry points |
| `src/game/recovery.ts` | Beam search over 2-3 ply sequences explaining an observation (missed moves) |
| `src/engine/engine.worker.ts` | Dedicated worker spawning the Stockfish loader as a nested worker; WASM->asm.js watchdog fallback |
| `src/engine/engineClient.ts` | UCI wrapper: prewarm, options, `go movetime`, `stop` on position change, info/bestmove parsing, eval formatting |
| `src/camera/camera.ts` | getUserMedia (rear, 1280x720@30), device picker, video-file source, `requestVideoFrameCallback` pump, Wake Lock |
| `src/ui/*` | Screens (fair-play, live, calibration, analysis, settings, debug), overlay renderer, terminal log, eval bar, virtual board, resync sheet, i18n EN/AR |
| `src/dev/demo.ts` | Synthetic PGN playback through the real worker pipeline |
| `electron/` | Main process (privileged `app://` scheme, camera permissions), sandboxed preload |
| `scripts/` | Engine copy, icon/splash raster generation (pure PNG encoder), iOS plist patch, workflow validator, electron bundler |
| `.github/workflows/` | Pages, Android, iOS (unsigned IPA), Windows, tag releases |

## Canonical coordinate convention

Everything vision-related speaks one language: a warped 512x512 top-down board
(64 px/square) with **a8 at top-left and White at the bottom**. Square index
`i = row*8 + col`, row 0 = rank 8, col 0 = file a. Calibration maps the four
physical board corners to this canonical quad (the UI's rotate/flip controls
choose which physical corner is a8), so every downstream module is
orientation-agnostic.

## Why no piece-type recognition

The app knows the start position and the rules. For each square it only needs
empty/white/black; piece *types* come from the tracked game state (chess.js).
This makes the vision problem tiny, fast and self-supervised: one scan of a
known position teaches six Gaussian classes, and every confirmed move keeps
the templates adapted to lighting drift.

## Temporal filtering

Raw per-square classifications are debounced: a square's published state
changes only after the raw classifier repeats the new state for
`ADOPT_FRAMES = 3` consecutive frames. Period-2 noise oscillation can never
flip the published map; real moves appear after ~300 ms at 10 Hz vision.
Stability (spec: ~5 identical detections) is then measured on the published
map, and the tracker additionally requires no skin-chroma sweep and <= 4
changed squares before scoring moves.

## Engine threading model

The Stockfish npm build `stockfish-19-lite-single` is single-threaded and does
**not** use SharedArrayBuffer, therefore the app needs **no COOP/COEP
headers** - which matters because GitHub Pages, Capacitor webviews and the
Electron custom scheme cannot all provide them. The loader runs as a nested
worker inside `engine.worker.ts`, which adds an init watchdog and automatic
asm.js fallback for webviews without WASM.

## Offline / PWA

`src/sw.ts` (workbox injectManifest) precaches the app shell **and**
`engine/*.wasm|js` (12 MB limit), so after first load the app runs with the
radio off. Native shells (Capacitor/Electron) ship the same assets locally.
