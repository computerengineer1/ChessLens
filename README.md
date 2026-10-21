# ChessLens AR ♟️📷

Point your phone or PC camera at a **real chessboard**. ChessLens AR
calibrates once, then **tracks the game from the camera alone**, runs
**Stockfish 19 on-device** after every confirmed move, and paints a live
**neon AR overlay** (glowing board outline, green from/to squares,
perspective arrow, eval bar, terminal log) on top of the video.

- **100% offline** after install - engine *and* vision run on-device.
- **100% free** - no API keys, no cloud, no Apple Developer account, no Play
  fee. Builds on GitHub Actions free tier, hosts on GitHub Pages.
- **No piece-type ML**: the app knows the rules, so vision only decides
  *empty / white / black* per square (self-supervised, one scan).
- **GPL-3.0-only** (Stockfish is GPLv3). See `LICENSE` and `NOTICE`.

> **Fair play:** ChessLens is for analysis, training, and casual games with
> your opponent's consent. **Do not use it in rated, online, or tournament
> games.** The app shows this notice on first launch and has no stealth
> features by design.

---

## Quick start (dev machine: Windows 11, PowerShell)

Requirements: **Node.js 22 LTS** (Capacitor 8 requires >= 22; any "20+" LTS
>= 22 works), **git**. Everything below is PowerShell.

```powershell
# 1) clone your repo
git clone https://github.com/<your-user>/ChessLensAR.git
cd ChessLensAR

# 2) install (npm 10 needs the flag once; npm 11+ / npm ci do not)
npm install --legacy-peer-deps

# 3) run in the browser (camera live; add ?demo=1 for a synthetic game)
npm run dev
#    open http://localhost:5173        (camera mode)
#    open http://localhost:5173/?demo=1 (demo playback, no board needed)

# 4) gates
npm run typecheck
npm test
npm run build
```

First run in the browser: accept the fair-play notice → allow camera →
**Calibrate** (drag the 4 handles onto the outer corners of the 8x8 grid,
use the loupe, pick your side) → **Scan start position** (board in the
initial setup, ~1 s) → play. The engine pre-warms in the background.

### Create the GitHub repo, push, enable Pages, tag a release (PowerShell)

```powershell
# one-time git identity
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"

# create an empty PUBLIC repo named ChessLensAR on github.com (web UI), then:
git remote add origin https://github.com/<your-user>/ChessLensAR.git
git push -u origin main

# GitHub Pages: Settings -> Pages -> Source: "GitHub Actions"
# (the web.yml workflow deploys on every push to main)
# URL will be: https://<your-user>.github.io/ChessLensAR/

# tag a release (builds APK + IPA + EXE and attaches them to a Release):
git tag v0.1.0
git push origin v0.1.0
# then: github.com/<your-user>/ChessLensAR/releases -> download from the
# newest release assets.
```

### Download & install the builds

- **Android APK** (`ChessLensAR-...-debug.apk` or signed `-release.apk`):
  copy to the phone, tap it, and allow **"install unknown apps"** for your
  file manager/browser when prompted. That's it - no Play Store needed.
- **Windows** (`...-portable.exe` runs from anywhere; `...-setup.exe` is the
  NSIS installer). Camera permission prompt appears on first use.
- **Unsigned IPA** (`ChessLens-unsigned.ipa`): free sideloading, see below.
- **iPhone without a PC / no sideloading:** open the GitHub Pages URL in
  Safari and **Add to Home Screen** (PWA). Android/PC browsers work too.

#### Installing the unsigned IPA for free (Sideloadly or AltStore)

1. Create a **free Apple ID** (any normal Apple account works).
2. **Sideloadly**: install Sideloadly on Windows, connect the iPhone (trust
   the computer), drag `ChessLens-unsigned.ipa` in, enter your Apple ID,
   click Start. Or **AltStore**: install AltServer, then AltStore on the
   phone, and "Install .ipa" from the AltStore app.
3. On the iPhone: **Settings -> General -> VPN & Device Management ->
   trust your developer profile**.
4. **Re-sign every 7 days**: free Apple IDs only sign apps for 7 days.
   Re-run Sideloadly/AltStore weekly (AltStore auto-refreshes while on the
   same Wi-Fi as AltServer).

---

## Modes

| Mode | What it is |
| --- | --- |
| **Live camera** | rear camera 1280x720@30, vision at ~10 Hz in a worker |
| **Video file** | load any mp4 of a board as the camera source (testing) |
| **Analysis only** | no camera: virtual board, tap-to-move, engine lines |
| **Demo (`?demo=1`)** | synthetic PGN played through the real pipeline; Electron: `--demo` |

Languages: **English and Arabic** (full RTL; the terminal log stays LTR).

---

## Known limitations & tuning guide

Reality is messier than a synth renderer. What needs real-world tuning, and
how to do it:

**Lighting.** Avoid a single strong side light or a lamp reflecting in
glossy boards; diffuse daylight or a ceiling light works best. The pipeline
removes global exposure changes and a linear light-direction plane every
frame, but hard shadows across half the board defeat any normalisation. If
squares flicker between empty/piece, open **Debug** and watch per-square
confidence while you move the lamp.

**Camera angle & tripod.** Keep the whole 8x8 grid inside the frame with
margin, camera at 30-60° elevation, roughly behind your side. Extreme
oblique angles shrink the far ranks to a few pixels and accuracy drops.
A cheap phone tripod (or a bookshelf) dramatically improves tracking: the
calibration stays valid and the stability gate passes faster. Re-calibrate
(`Recalibrate`) after moving the phone - calibrations are stored per camera.

**Hands.** Keep hands out of the grid while not moving; the tracker waits
out skin-coloured sweeps automatically. Wearing non-skin-coloured sleeves
helps on glossy boards.

**The Debug panel is the tuning console.** Top-bar `☰` opens it: warped
top-down board with the classification tint and per-square confidence, a
feature dump for the tapped square (z-lum, edge, sat, template diff, white
mass, black mass), FPS / vision-Hz / per-stage ms budgets, engine status,
and **live sliders** for every vision threshold
(`stableFrames`, `skinFraction`, `maxSimultaneousChanges`, `massThreshold`,
`confidenceTemperature`, `templateEma`, `classEma`) plus tracker behaviour
via Settings. Rules of thumb:

- Squares flip-flop while nothing moves -> raise `stableFrames` (5 -> 7).
- Moves confirm only after you wave the hand away slowly -> lower
  `stableFrames` (5 -> 4) or raise `massThreshold`.
- Hand over board still confirms a wrong move -> lower `skinFraction`
  (0.05 -> 0.03).
- Dim rooms misread white pieces on light squares -> raise `massThreshold`
  slightly (22 -> 26) and improve lighting.
- Too many "Confirm move" sheets -> your camera is noisy: raise
  `confidenceTemperature` a touch (0.35 -> 0.5) to soften over-confident
  wrong reads, or clean the lens.

**Engine strength/speed.** Settings: skill 0-20, MultiPV 1-3, think time
(default 700 ms mobile / 1200 ms desktop, depth cap 18). The lite engine is
single-threaded by design (no COOP/COEP anywhere); on a phone expect
~1500-2000 Elo at these settings.

**Webviews.** On old Android WebViews without WASM the app automatically
falls back to the asm.js engine and says so in the log. iOS requires 14.3+
for `getUserMedia` in WKWebView; the PWA in Safari is the supported iPhone
path without sideloading.

**Wake lock.** Browsers keep the screen on via the Wake Lock API; some
WebViews don't expose it - the app degrades silently (screen may sleep).

---

## Repository layout & developer docs

- `docs/ARCHITECTURE.md` - module map, coordinate convention, data flow.
- `docs/DECISIONS.md` - every trade-off with rejected alternatives.
- `tests/` - synthetic-renderer harness: >= 98% classification accuracy over
  randomized conditions, Opera Game + en-passant + promotion PGN replays
  through the *real* pipeline, recovery/occlusion tests, engine smoke test.
- `.github/workflows/` - `web.yml` (Pages), `android.yml` (debug APK +
  signed release when keystore secrets exist), `ios.yml` (unsigned IPA),
  `windows.yml` (portable + NSIS), `release.yml` (tag -> GitHub Release).

Optional Android signing secrets (repo Settings -> Secrets):
`ANDROID_KEYSTORE_B64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`,
`ANDROID_STORE_PASSWORD`. Without them you still get a debug APK.

---

## العربية (Arabic)

**تشسنج لنز للواقع المعزز**: وجّه كاميرا هاتفك أو حاسوبك إلى رقعة شطرنج
حقيقية. يعاير التطبيق الرقعة مرة واحدة، ثم **يتتبع اللعبات من الكاميرا فقط**،
ويشغّل **محرك Stockfish 19 على جهازك** بعد كل نقلة مؤكدة، ويرسم طبقة واقع
معزّز مباشرة (إطار نيون حول الرقعة، مربعان أخضران للنقلة المقترحة، سهم
منظوري، شريط تقييم، وسجل طرفي).

- **يعمل بدون إنترنت بالكامل** بعد التثبيت - المحرك والرؤية على جهازك.
- **مجاني 100%** - لا مفاتيح API ولا سحابة ولا حساب مطور آبل ولا رسوم متجر.
- **رخصة GPL-3.0** (انظر `LICENSE` و `NOTICE`).

> **تنبيه اللعب النزيه:** التطبيق للتحليل والتدريب والألعاب الودية بموافقة
> خصمك. **لا تستخدمه في المباريات المصنّفة أو عبر الإنترنت أو البطولات.**

**خطوات البدء (PowerShell على ويندوز 11):**

```powershell
git clone https://github.com/<your-user>/ChessLensAR.git
cd ChessLensAR
npm install --legacy-peer-deps
npm run dev          # ثم افتح http://localhost:5173
npm test             # اختبارات الرؤية والتتبع والمحرك
npm run build        # بناء نسخة الإنتاج
```

**إنشاء المستودع والنشر:** أنشئ مستودعًا عامًا باسم `ChessLensAR` على
GitHub، ثم:

```powershell
git remote add origin https://github.com/<your-user>/ChessLensAR.git
git push -u origin main
git tag v0.1.0
git push origin v0.1.0   # يبني APK و IPA و EXE وينشرها في Release
```

فعّل GitHub Pages من: Settings -> Pages -> Source: GitHub Actions.

**تثبيت APK على أندرويد:** انقل الملف إلى الهاتف وافتحه وفعّل «السماح
بالتثبيت من مصادر غير معروفة». **تثبيت IPA المجاني على آيفون:** استخدم
Sideloadly أو AltStore مع معرف آبل مجاني، وثِق بالشهادة من إعدادات الجهاز،
وأعد التوقيع كل 7 أيام. أو افتح رابط GitHub Pages في سفاري وأضفه إلى الشاشة
الرئيسية (تطبيق ويب).

**اللغات:** واجهة كاملة بالعربية مع اتجاه RTL؛ السجل الطرفي يبقى باتجاه
LTR عمدًا.

**حدود معروفة ودليل المعايرة:** الإضاءة الجانبية القوية والظلال الحادة
تربك التصنيف؛ استخدم إضاءة منتشرة. ثبّت الهاتف (حامل صغير) وأعد المعايرة عند
تحريكه. لوحة «تشخيص» تعرض الرقعة المصححة وثقة كل مربع وجميع العتبات كمنزلقات
حيّة: ارفع `stableFrames` إذا تقلبت المربعات دون حركة، واخفض `skinFraction`
إذا أكدت نقلة خاطئة أثناء وجود يدك فوق الرقعة.

---

## License

GPL-3.0-only - see `LICENSE`. Third-party credits (Stockfish, chess.js,
Capacitor, Electron, Vite, workbox) in `NOTICE`.
