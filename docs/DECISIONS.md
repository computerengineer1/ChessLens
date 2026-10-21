# Decision log

Every non-obvious choice, with the reason and the rejected alternative.

## D-01 - Engine build: `stockfish-19-lite-single` (WASM, single thread)
**Chosen:** copy `bin/stockfish-19-lite-single.js` + `.wasm` (and the asm.js
fallback) from the `stockfish` npm package into `public/engine/`; run it as a
nested worker inside `src/engine/engine.worker.ts`.
**Why:** verified with `npm view` + package inspection: the lite-single build
is 1.8 MB, needs no SharedArrayBuffer, therefore **no COOP/COEP headers** -
required because GitHub Pages and Capacitor/Electron origins cannot provide
them. The loader documents `new Worker("stockfish-19-lite-single.js")` and
resolves its `.wasm` sibling by URL, which works from `public/` on every
target.
**Rejected:** multi-threaded builds (need COOP/COEP + cross-origin isolation);
loading the loader on the main thread (blocks UI).

## D-02 - No OpenCV.js; hand-written vision in typed arrays
**Chosen:** homography solver (8x8 Gaussian elimination), LUT warp, feature
extraction and a Gaussian classifier, all plain TypeScript with preallocated
buffers.
**Why:** OpenCV.js is ~8 MB and slow to initialize; the task only needs
empty/white/black per square. Pure TS runs identically in worker, Node tests
and browsers, and keeps the bundle small.
**Rejected:** any ML piece detector (spec forbids needing one; rules supply
piece types).

## D-03 - Synthetic renderer in pure TypeScript (no `@napi-rs/canvas`)
**Chosen:** `src/vision/synth.ts` paints the canonical board with rasterized
piece silhouettes and warps it through the *same* LUT code as production.
**Why:** the spec suggested `@napi-rs/canvas` as an example; a native dev-dep
would add CI matrix pain (prebuilds per OS) and could not run inside the
browser demo mode. The pure-TS renderer runs in Node (tests), workers and
browsers (demo) with zero dependencies and reuses production warp code, so
tests exercise the real path in both directions.
**Rejected:** node-canvas/@napi-rs/canvas (native binaries, no browser use).

## D-04 - Lighting normalization: robust median/scale + parity-removed plane detrend
**Chosen:** per-frame median & IQR scale for exposure/gain; a least-squares
luminance **plane** (row/col tilt) fitted on parity-removed values of
locally-empty-looking squares; templates stored in that normalized space.
**Why:** auto-exposure changes gain (median/scale kills it); side lighting
changes direction (plane kills it). Fitting the plane on raw values leaks the
checkerboard offset and the piece layout into the tilt estimate - parity
removal plus an empty-square gate (template distance < 12 z) keeps the fit
honest. Verified: accuracy >= 98% across randomized brightness/contrast/
gradient/noise/blur/perspective.
**Rejected:** histogram matching (slow), per-square independent gain (noisy).

## D-05 - Hand rejection: changed-square mass + skin chroma *inside changed squares*
**Chosen:** `handLikely = frameChanged > maxSimultaneousChanges && skinFractionInChanged > threshold`;
plus a freeze of the temporal filter while that condition holds.
**Why:** wooden boards sit inside the classic YCbCr skin range, so a global
skin fraction flags the board itself. Skin evidence only means something
where the observation *changed*. Requiring both terms eliminates false hands
from noise bursts while still catching real sweeps.
**Rejected:** global skin fraction (false positives on wood); variance blobs
alone (pieces are high-variance too).

## D-06 - Temporal filter: per-square adopt-after-3-frames (not majority-of-N)
**Chosen:** a square's published state changes only after 3 consecutive
identical raw classifications.
**Why:** majority-of-3 (and -5) still oscillate under period-2 noise on
borderline squares; the adopt-counter freezes oscillating squares at their
last stable value and admits real changes after ~300 ms at 10 Hz.
**Rejected:** median-of-N windows (oscillation survives odd windows),
Kalman/EMA on labels (labels are discrete).

## D-07 - Move inference cost + margins; promotions tie-break to queen
**Chosen:** mismatch cost per square scaled by observation confidence
(confident disagreement ~1.5, blurry ~0.25); accept when best <= `acceptCost`
and beats the first non-tied candidate by `acceptMargin`; exact cost ties
between promotions auto-queen and offer a one-tap under-promotion sheet;
exact ties between *different* moves open the confirm sheet.
**Why:** confidence weighting lets blurry squares disagree cheaply while
confident ones dominate; promotion occupancy maps are identical by
construction, so ties there are structural, not evidential.
**Rejected:** hard 0/1 mismatch counting (brittle), NLL over full softmax
(slower, no better in practice).

## D-08 - Recovery: beam search over 2-3 ply sequences, then resync sheet
**Chosen:** when no single move explains a stable observation, search legal
sequences depth 2 then 3 (beam 8, node cap 12k) with the same cost function;
after `lostAfter` failed stable detections, open the resync sheet
(tap-to-move / undo / FEN / PGN / position editor), then verify against the
camera and warn on mismatch.
**Why:** missed plies are the common real-world failure (app backgrounded,
fast moves); incremental expected maps keep the search cheap.
**Rejected:** full game-tree re-alignment (expensive), immediate resync on
first mismatch (hostile UX).

## D-09 - Electron serves over a privileged `app://` scheme
**Chosen:** `protocol.registerSchemesAsPrivileged({ scheme: 'app', standard,
secure, ... })` + `protocol.handle`, window loads `app://./index.html`.
**Why:** `file://` blocks Web Workers and is not a secure context, so
getUserMedia and the vision/engine workers would die. A standard+secure
custom scheme gives workers, fetch and camera permission one consistent
origin without COOP/COEP.
**Rejected:** bundling a local http server (extra surface), `--allow-file-access-from-files` (insecure flag).

## D-10 - Capacitor: Node 22 + Capacitor 8; Android committed, iOS generated in CI
**Chosen:** Capacitor 8 (latest stable; requires Node >= 22, which still
satisfies the project's "Node 20+ LTS" floor); `android/` committed;
`ios.yml` runs `npx cap add ios` on the macOS runner when missing, then
`scripts/patch-ios-plist.mjs` injects `NSCameraUsageDescription`.
**Why:** `cap add ios` needs CocoaPods (macOS only), so the iOS folder cannot
be generated on Windows/Linux dev machines; generating it in CI keeps the
repo honest. The plist patch is string-based to avoid a Ruby/plist toolchain.
**Rejected:** committing a hand-made ios/ tree (drifts from template), Capacitor 7 (not latest stable).

## D-11 - Icons/splash generated by code (deterministic PNG encoder)
**Chosen:** `scripts/icon-lib.mjs` rasterizes the neon board+lens mark and a
minimal zlib-based PNG encoder emits every size (web manifest, apple-touch,
favicon, Electron .ico via PNG-compressed ICO entries, Android splash and
launcher rasters at template dimensions).
**Why:** reproducible in CI and on any dev machine, zero binary assets to
review, zero native deps; the mark matches the in-app overlay language.
**Rejected:** AI-generated raster (non-reproducible), sharp/canvas (native).

## D-12 - Windows installer build verified in CI, not in the 1 GB dev sandbox
**Chosen:** `electron-builder.yml` validated locally by producing a Linux
AppImage end-to-end; the NSIS/portable `.exe` targets run on
`windows-latest` (and `windows.yml` doubles as local instructions).
**Why:** the sandbox (1 GB RAM) OOM-kills electron-builder's Windows path
(electron zip + app-builder + asar concurrently); the config, icons and
bundles are identical across targets and the Linux build proves them.
**Rejected:** shipping an unverified config (CI proves it on every push).

## D-13 - npm install needs `--legacy-peer-deps` on npm 10 (jsdom/canvas peer bug)
**Chosen:** document `npm install --legacy-peer-deps` for npm <= 10; commit
the lockfile so `npm ci` (CI, fresh clones on npm 11+) works without flags.
**Why:** npm 10.8's arborist crashes (`Cannot read properties of null
(reading 'edgesOut')`) resolving jsdom's optional `canvas` peer; npm 11+ and
`npm ci` are unaffected.
**Rejected:** dropping jsdom (DOM tests are valuable), pinning ancient jsdom.

## D-14 - Terminal log stays English + LTR in all locales
**Chosen:** log lines (`player move confirmed: ...`, `query stockfish with
board positioning`, ...) are engine-console artifacts, always LTR English;
all chrome UI is fully localized EN/AR with RTL layout.
**Why:** matches the reference recording exactly and keeps grep-able,
diff-able logs; Arabic RTL inside a monospace console harms readability.
**Rejected:** localizing log grammar (breaks the reference style).

## D-15 - PWA via `vite-plugin-pwa` injectManifest with a 12 MB precache cap
**Chosen:** workbox `precacheAndRoute(self.__WB_MANIFEST)` in `src/sw.ts`,
`maximumFileSizeToCacheInBytes: 12 MB`.
**Why:** the asm.js fallback engine alone is 3.2 MB (default cap 2 MB); the
whole point of the PWA is full offline analysis, so the engines belong in the
precache.
**Rejected:** runtime-only caching of engines (first offline launch would
lack analysis).

## D-16 - Wake lock: platform API with silent degradation
**Chosen:** `navigator.wakeLock.request('screen')` with re-acquire on
visibility changes; when a webview lacks the API the app logs nothing and
continues (screen may sleep).
**Why:** no free official Capacitor wake-lock plugin exists; adding a
community plugin would mean a native dependency for a cosmetic guarantee.
Browsers (the PWA path, where long sessions matter most) support the API.
**Rejected:** `@capacitor-community/*` wake-lock forks (unmaintained,
native surface), keeping a silent video playing (battery waste).

## D-17 - Temporal budget test asserts the spec's 15 ms on CI hardware
**Chosen:** `tests/perf.test.ts` asserts average detection < 15 ms (p95 <
40 ms for shared-runner jitter) at 640x360 on whatever machine runs the
suite; measured ~11 ms average / ~15 ms p95 on a 2-core CI-class sandbox.
**Why:** the spec's budget targets mid-range phones; asserting it on weaker
CI hardware is a conservative proxy that also guards regressions.
**Rejected:** device-farm benchmarks (not free), no assertion (regressions
would slip through).
