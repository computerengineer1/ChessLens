/**
 * Live screen: camera + AR overlay + terminal log + eval bar + tracking.
 *
 * This is the orchestrator for camera-driven modes (Live, Video file, Demo).
 * It wires: CameraSource -> VisionClient (worker) -> Tracker -> EngineClient
 * -> OverlayRenderer, and emits the spec-style terminal log lines.
 */

import type { Move } from 'chess.js';
import type { AppSettings, Calibration, DetectionResult, VisionModel } from '../types.js';
import type { CameraSource } from '../camera/camera.js';
import { CameraError } from '../camera/camera.js';
import type { VisionClient, DetectionMessage } from '../vision/visionClient.js';
import { Tracker, type MoveConfirmedEvent, type TrackerEvent } from '../game/tracker.js';
import { GameState } from '../game/state.js';
import { EngineClient, formatEval, type BestMove, type EngineLine } from '../engine/engineClient.js';
import { OverlayRenderer } from './overlay.js';
import { EvalBar } from './evalbar.js';
import { LogPanel, logLines } from './logpanel.js';
import { el, clear } from './dom.js';
import { t } from './i18n.js';
import type { Screen } from './screens.js';
import { RateGate, type PerfBudgets } from '../util/timing.js';
import { showSheet, toast } from './toast.js';
import { ResyncSheet } from './resync.js';

const PIECE_WORDS: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king'
};

export interface LiveDeps {
  camera: CameraSource;
  vision: VisionClient;
  engine: EngineClient;
  log: LogPanel;
  perf: PerfBudgets;
  getSettings(): AppSettings;
  loadCalibration(cameraId: string): Calibration | null;
  saveCalibration(cal: Calibration): void;
  loadModel(cameraId: string): VisionModel | null;
  saveModel(cameraId: string, model: VisionModel): void;
  openCalibration(): void;
  openSettings(): void;
  openDebug(): void;
  openAnalysis(): void;
  keepAwake(): boolean;
  acquireWakeLock(): Promise<boolean>;
  releaseWakeLock(): void;
  onTrackerEvent?(ev: TrackerEvent): void;
}

export type LiveMode = 'live' | 'video' | 'demo';

export class LiveScreen implements Screen {
  readonly id = 'live';
  readonly root: HTMLElement;

  tracker: Tracker = new Tracker();
  private deps: LiveDeps;
  private mode: LiveMode = 'live';

  private videoWrap: HTMLElement;
  private overlayCanvas: HTMLCanvasElement;
  private overlay: OverlayRenderer;
  private evalBar: EvalBar;
  private moveChip: HTMLElement;
  private statusChip: HTMLElement;
  private bottomBar: HTMLElement;
  private calibrateBtn!: HTMLButtonElement;
  private scanBtn!: HTMLButtonElement;
  private resyncBtn!: HTMLButtonElement;
  private deviceSel!: HTMLSelectElement;
  private modeBtn!: HTMLButtonElement;
  private videoInput!: HTMLInputElement;
  private errorBox!: HTMLElement;
  private logHost: HTMLElement;

  private calibration: Calibration | null = null;
  private modelReady = false;
  private scanning = false;
  private visionGate = new RateGate(100); // ~10 Hz vision
  private active = false;
  private bestLine: EngineLine | null = null;
  private verifyNextDetection = false;
  private demoFeed: DemoFeed | null = null;
  private overlaySampler: ReturnType<typeof setInterval> | null = null;
  private labels = new Map<string, HTMLElement>();
  private resizeObs: ResizeObserver | null = null;

  constructor(deps: LiveDeps) {
    this.deps = deps;
    this.videoWrap = el('div', { class: 'video-wrap' });
    this.overlayCanvas = el('canvas', { class: 'overlay-canvas' });
    this.overlay = new OverlayRenderer(this.overlayCanvas);
    this.evalBar = new EvalBar();
    this.moveChip = el('div', { class: 'move-chip hidden' });
    this.statusChip = el('div', { class: 'status-chip', text: '' });
    this.logHost = el('div', { class: 'log-host' });
    this.bottomBar = el('div', { class: 'bottom-bar' });
    this.errorBox = el('div', { class: 'error-box hidden' });

    const topBar = el('div', { class: 'top-bar' }, [
      this.statusChip,
      el('div', { class: 'top-buttons' }, [
        this.iconButton('\u265f', 'nav.analysis', () => deps.openAnalysis()),
        this.iconButton('\u2699', 'nav.settings', () => deps.openSettings()),
        this.iconButton('\u2261', 'nav.debug', () => deps.openDebug())
      ])
    ]);

    this.videoWrap.append(deps.camera.video, this.overlayCanvas, this.moveChip, this.evalBar.root, topBar, this.errorBox);
    this.root = el('div', { class: 'screen-content live-screen' }, [this.videoWrap, this.logHost, this.bottomBar]);
    this.buildBottomBar();
    this.attachLog(deps.log);

    // Engine callbacks.
    deps.engine.setPvConverter((uciMoves, fen) => pvToSan(uciMoves, fen));
  }

  private iconButton(glyph: string, labelKey: string, fn: () => void): HTMLButtonElement {
    const b = el('button', { class: 'icon-btn', text: glyph, title: t(labelKey), 'aria-label': t(labelKey) });
    b.addEventListener('click', fn);
    return b;
  }

  private buildBottomBar(): void {
    this.calibrateBtn = el('button', { class: 'btn btn-primary', text: t('live.calibrate') });
    this.calibrateBtn.addEventListener('click', () => this.deps.openCalibration());
    this.scanBtn = el('button', { class: 'btn btn-primary hidden', text: t('live.scanStart') });
    this.scanBtn.addEventListener('click', () => this.startScan());
    this.resyncBtn = el('button', { class: 'btn btn-ghost', text: t('live.resync') });
    this.resyncBtn.addEventListener('click', () => this.openResync());
    this.modeBtn = el('button', { class: 'btn btn-ghost', text: t('live.pickVideo') });
    this.modeBtn.addEventListener('click', () => this.videoInput.click());
    this.videoInput = el('input', { type: 'file', accept: 'video/*', class: 'hidden' });
    this.videoInput.addEventListener('change', () => {
      const f = this.videoInput.files?.[0];
      if (f) void this.startVideoFile(f);
    });
    this.deviceSel = el('select', { class: 'device-select', title: t('live.pickDevice') });
    this.deviceSel.addEventListener('change', () => {
      void this.startCamera(this.deviceSel.value || undefined);
    });
    this.labels.set('live.calibrate', this.calibrateBtn);
    this.labels.set('live.scanStart', this.scanBtn);
    this.labels.set('live.resync', this.resyncBtn);
    this.labels.set('live.pickVideo', this.modeBtn);
    this.bottomBar.append(this.deviceSel, this.calibrateBtn, this.scanBtn, this.resyncBtn, this.modeBtn, this.videoInput);
  }

  attachLog(log: LogPanel): void {
    clear(this.logHost);
    this.logHost.append(log.root);
  }

  refreshI18n(): void {
    for (const [k, node] of this.labels) node.textContent = t(k);
    this.setStatus(this.statusChip.dataset.key ? t(this.statusChip.dataset.key) : '');
  }

  private setStatus(text: string, key?: string): void {
    this.statusChip.textContent = text;
    if (key) this.statusChip.dataset.key = key;
    else delete this.statusChip.dataset.key;
  }

  // ------------------------------------------------------------------ modes

  async startLiveMode(deviceId?: string): Promise<void> {
    this.mode = 'live';
    this.hideError();
    try {
      await this.deps.camera.startLive(deviceId);
      this.afterCameraStarted();
    } catch (err) {
      this.showCameraError(err);
    }
  }

  async startVideoFile(file: File): Promise<void> {
    this.mode = 'video';
    this.hideError();
    try {
      await this.deps.camera.startFile(file);
      this.afterCameraStarted();
    } catch (err) {
      this.showCameraError(err);
    }
  }

  async startDemoMode(feed: DemoFeed): Promise<void> {
    this.mode = 'demo';
    this.demoFeed = feed;
    this.hideError();
    feed.attach(this);
  }

  private afterCameraStarted(): void {
    this.loadDeviceList();
    const cam = this.deps.camera;
    cam.onFrame(() => {
      this.deps.perf.renderFps.tick();
      if (!this.visionGate.allow()) return;
      void this.pumpFrame();
    });
    const cal = this.deps.loadCalibration(cam.activeDeviceId);
    if (cal && cal.srcW > 0) {
      this.applyCalibration(cal, false);
      const model = this.deps.loadModel(cam.activeDeviceId);
      if (model) {
        this.deps.vision.setModel(model);
        this.modelReady = true;
        this.deps.log.log(logLines.waitingForGame());
        this.setStatus(t('live.waiting'), 'live.waiting');
      } else {
        this.setStatus(t('live.scanStart'), 'live.scanStart');
      }
    } else {
      this.setStatus(t('live.calibrate'), 'live.calibrate');
    }
    this.updateButtons();
    void this.ensureEngine();
    this.overlay.start();
  }

  private async pumpFrame(): Promise<void> {
    const t0 = performance.now();
    const bmp = await this.deps.camera.grabBitmap();
    this.deps.perf.frameGrabMs.record(performance.now() - t0);
    if (!bmp) return;
    await this.deps.vision.postFrame(bmp);
  }

  /** Demo feed pushes frames directly through the same worker path. */
  async pushDemoFrame(bitmap: ImageBitmap): Promise<void> {
    // Visualize the synthetic frame behind the overlay in demo mode.
    if (this.mode === 'demo') {
      const dc = this.ensureDemoCanvas();
      const c = dc.getContext('2d');
      if (c) {
        dc.width = bitmap.width;
        dc.height = bitmap.height;
        c.drawImage(bitmap, 0, 0);
      }
    }
    await this.deps.vision.postFrame(bitmap);
  }

  private demoCanvas: HTMLCanvasElement | null = null;
  private ensureDemoCanvas(): HTMLCanvasElement {
    if (!this.demoCanvas) {
      this.demoCanvas = el('canvas', { class: 'demo-canvas' });
      this.videoWrap.prepend(this.demoCanvas);
    }
    return this.demoCanvas;
  }

  private async loadDeviceList(): Promise<void> {
    const devices = await this.deps.camera.listDevices();
    clear(this.deviceSel);
    if (devices.length <= 1 && this.mode !== 'live') {
      this.deviceSel.classList.add('hidden');
      return;
    }
    this.deviceSel.classList.toggle('hidden', devices.length === 0);
    for (const d of devices) {
      const o = el('option', { value: d.deviceId, text: d.label });
      if (d.deviceId === this.deps.camera.activeDeviceId) o.selected = true;
      this.deviceSel.append(o);
    }
  }

  async startCamera(deviceId?: string): Promise<void> {
    if (this.mode === 'video' || this.mode === 'demo') return;
    await this.startLiveMode(deviceId);
  }

  private showCameraError(err: unknown): void {
    let key = 'err.cameraGeneric';
    let fixKey = 'err.cameraGenericFix';
    if (err instanceof CameraError) {
      if (err.code === 'denied') {
        key = 'err.cameraDenied';
        fixKey = 'err.cameraDeniedFix';
      } else if (err.code === 'missing') {
        key = 'err.cameraMissing';
        fixKey = 'err.cameraMissingFix';
      } else if (err.code === 'insecure') {
        key = 'err.cameraGeneric';
        fixKey = 'err.cameraGenericFix';
      }
    }
    clear(this.errorBox);
    this.errorBox.append(
      el('div', { class: 'error-title', text: `\u26a0 ${t(key)}` }),
      el('div', { class: 'error-fix', text: t(fixKey) }),
      (() => {
        const b = el('button', { class: 'btn btn-primary', text: t('common.retry') });
        b.addEventListener('click', () => void this.startCamera(this.deviceSel.value || undefined));
        return b;
      })()
    );
    this.errorBox.classList.remove('hidden');
    this.deps.log.log(`error: camera failed (${String(err)})`, 'error');
  }

  private hideError(): void {
    this.errorBox.classList.add('hidden');
  }

  // ------------------------------------------------------------ calibration

  applyCalibration(cal: Calibration, save: boolean): void {
    this.calibration = cal;
    if (save) this.deps.saveCalibration(cal);
    this.deps.vision.calibrate(cal);
    this.overlay.setCalibration(cal);
    this.overlay.setSourceSize(cal.srcW, cal.srcH);
    this.overlay.resize(this.deps.camera.video);
    this.calibrateBtn.textContent = t('live.recalibrate');
    this.labels.set('live.recalibrate', this.calibrateBtn);
    this.updateButtons();
  }

  onCalibrated(coverage: number): void {
    this.deps.log.log(logLines.calibrated(coverage));
  }

  // ------------------------------------------------------------------ scan

  /** Public entry used by the demo player (start-position scan). */
  startDemoScan(): void {
    this.startScan();
  }

  /** Public engine pre-warm entry (called by App for every mode). */
  startEngine(): void {
    void this.ensureEngine();
  }

  private startScan(): void {
    if (this.scanning || !this.calibration) return;
    this.scanning = true;
    this.scanBtn.disabled = true;
    this.setStatus(t('live.scanning'), 'live.scanning');
    this.deps.log.log(logLines.scanStart());
    // Truth = the tracker's current position (start position by default, or a
    // manually set position from the resync editor).
    const truth = this.tracker.state.occupancy(new Uint8Array(64));
    this.deps.vision.learn(truth, 8);
  }

  onLearnProgress(have: number, need: number): void {
    this.setStatus(`${t('live.scanning')} ${have}/${need}`);
  }

  onLearned(ok: boolean, model: VisionModel | null): void {
    this.scanning = false;
    this.scanBtn.disabled = false;
    if (!ok || !model) {
      toast(t('err.boardNotFound'), 'error');
      this.setStatus(t('live.scanStart'), 'live.scanStart');
      return;
    }
    this.modelReady = true;
    this.deps.saveModel(this.deps.camera.activeDeviceId, model);
    this.deps.log.log(logLines.scanDone());
    this.setStatus(t('live.waiting'), 'live.waiting');
    this.updateButtons();
    this.kickEngine();
  }

  // ----------------------------------------------------------------- engine

  private async ensureEngine(): Promise<void> {
    const ok = await this.deps.engine.start();
    if (ok) {
      const backend = this.deps.engine.getBackend();
      this.deps.log.log(logLines.engineReady(backend));
      if (backend === 'asmjs' && !this.deps.getSettings().engine.forceAsmJs) {
        this.deps.log.log(logLines.engineFallback(), 'warn');
        toast(t('live.engineAsmFallback'), 'warn');
      }
      if (this.modelReady) this.kickEngine();
    } else {
      this.deps.log.log(logLines.engineFailed(), 'error');
      toast(t('live.engineFailed'), 'error');
    }
  }

  private assistActive(): boolean {
    const assist = this.deps.getSettings().engine.assist;
    if (assist === 'both') return true;
    const turn = this.tracker.state.turn;
    return (assist === 'white' && turn === 'w') || (assist === 'black' && turn === 'b');
  }

  private kickEngine(): void {
    if (!this.modelReady) return;
    if (this.tracker.state.isGameOver()) return;
    if (!this.assistActive()) {
      this.deps.engine.stopSearch();
      this.overlay.setSuggestion(null);
      this.moveChip.classList.add('hidden');
      return;
    }
    this.deps.log.log(logLines.queryStockfish());
    const fen = this.tracker.fen();
    this.evalBar.setSideToMove(this.tracker.state.turn);
    this.deps.engine.analyze(fen);
  }

  onEngineInfo(line: EngineLine): void {
    if (line.multipv !== 1) return;
    this.bestLine = line;
    this.evalBar.update(line);
  }

  onEngineBestMove(mv: BestMove, searchMs: number): void {
    this.deps.perf.engineMs.record(searchMs);
    const state = this.tracker.state;
    const fromIdx = squareIndexOf(mv.from);
    const toIdx = squareIndexOf(mv.to);
    if (fromIdx < 0 || toIdx < 0) return;
    const piece = pieceAt(state, mv.from);
    const label = `${(PIECE_WORDS[piece] ?? piece).toUpperCase()} ${mv.from}\u2192${mv.to}`;
    this.overlay.setSuggestion({ from: fromIdx, to: toIdx, label });
    this.moveChip.textContent = label;
    this.moveChip.classList.remove('hidden');
    this.positionMoveChip(toIdx);
    const desc = `${PIECE_WORDS[piece] ?? piece} ${mv.from}\u2192${mv.to}`;
    this.deps.log.log(logLines.newMoveToRenderer(desc), 'engine');
    if (this.bestLine) {
      this.setStatus(
        `${t('live.suggestion')}: ${mv.uci}  ${t('live.eval')}: ${formatEval(this.bestLine, true, state.turn)}`,
      );
    }
  }

  private positionMoveChip(toIdx: number): void {
    const anchor = this.overlay.labelAnchor(toIdx);
    if (!anchor) return;
    this.moveChip.style.left = `${anchor.x}px`;
    this.moveChip.style.top = `${anchor.y}px`;
  }

  // -------------------------------------------------------------- detections

  onDetectionMessage(msg: DetectionMessage): void {
    this.deps.perf.visionHz.tick();
    this.deps.perf.visionMs.record(msg.timeMs);
    const det: DetectionResult = msg;
    if (msg.preview && msg.previewSize) {
      window.dispatchEvent(
        new CustomEvent('chesslens:preview', { detail: { data: msg.preview, size: msg.previewSize } })
      );
    }
    if (!this.modelReady) {
      if (!this.scanning && this.calibration) this.updateButtons();
      return;
    }
    if (this.verifyNextDetection && det.stable) {
      this.verifyNextDetection = false;
      const truth = this.tracker.lastConfirmed;
      let dist = 0;
      for (let i = 0; i < 64; i++) if (det.occupancy[i] !== truth[i]) dist++;
      if (dist > 2) {
        toast(t('resync.mismatch'), 'warn', 4000);
        this.deps.log.log('warn: camera disagrees with the resynced position', 'warn');
      }
    }
    const ev = this.tracker.onDetection(det);
    this.deps.onTrackerEvent?.(ev ?? { type: 'idle' });
    if (!ev) return;
    this.handleTrackerEvent(ev);
  }

  private handleTrackerEvent(ev: TrackerEvent): void {
    switch (ev.type) {
      case 'move':
        this.onMoveConfirmed(ev);
        break;
      case 'ambiguous': {
        const cands = ev.candidates.map((c) => `${c.move.san} (cost ${c.cost.toFixed(2)})`);
        this.deps.log.log(logLines.ambiguous(cands));
        this.showAmbiguousSheet(ev.candidates.map((c) => c.move));
        break;
      }
      case 'unstable':
        if (ev.reason === 'hand') this.setStatus(t('live.handDetected'), 'live.handDetected');
        else if (ev.reason === 'settling') this.setStatus(t('live.stability'), 'live.stability');
        else this.setStatus(t('live.stability'), 'live.stability');
        if (ev.reason === 'hand') this.deps.log.log(logLines.unstable('hand'));
        break;
      case 'resync-needed':
        this.deps.log.log(logLines.resyncNeeded(), 'warn');
        toast(t('resync.title'), 'warn');
        this.openResync();
        break;
      case 'need-scan':
        this.setStatus(t('live.scanStart'), 'live.scanStart');
        break;
      case 'idle':
        break;
    }
  }

  private onMoveConfirmed(ev: MoveConfirmedEvent): void {
    const state = this.tracker.state;
    const assist = this.deps.getSettings().engine.assist;
    const isPlayer =
      assist === 'both' ? ev.mover === 'w' : ev.mover === (assist === 'white' ? 'w' : 'b');

    // Truth feedback to the vision model (EMA adaptation).
    this.deps.vision.confirmTruth(state.occupancy(new Uint8Array(64)));

    const desc = describeMove(ev.move);
    const extras: string[] = [];
    if (ev.move.captured) extras.push(`takes ${PIECE_WORDS[ev.move.captured]}`);
    if (ev.checkmate) extras.push('checkmate');
    else if (ev.stalemate) extras.push('stalemate');
    else if (ev.check) extras.push('check');

    if (ev.reason === 'recovery' && ev.recovered > 0) {
      this.deps.log.log(logLines.recovered(ev.recovered));
    }
    if (ev.checkmate || ev.stalemate) {
      this.deps.log.log(logLines.finalMoveToRenderer(desc, extras), 'move');
      this.deps.log.log(logLines.gameOver(ev.checkmate ? 'checkmate' : 'stalemate'), 'move');
    } else if (isPlayer) {
      this.deps.log.log(logLines.playerMoveConfirmed(desc, extras), 'move');
    } else {
      this.deps.log.log(logLines.opponentTurnFinished(desc, extras), 'move');
    }

    this.overlay.setLastMove({ from: squareIndexOf(ev.move.from), to: squareIndexOf(ev.move.to) });
    this.evalBar.setSideToMove(state.turn);

    if (ev.promotion) {
      this.deps.log.log(logLines.promotion(PIECE_WORDS[ev.promotion] ?? ev.promotion));
      if (ev.promotionAlternatives.length > 1) this.showPromotionSheet(ev);
    }

    if (ev.gameOver) {
      this.overlay.setSuggestion(null);
      this.moveChip.classList.add('hidden');
      this.deps.engine.stopSearch();
      this.setStatus(ev.checkmate ? 'checkmate' : ev.stalemate ? 'stalemate' : 'game over');
      return;
    }
    this.setStatus(t('live.tracking'), 'live.tracking');
    this.kickEngine();
  }

  private showAmbiguousSheet(cands: Move[]): void {
    const list = el('div', { class: 'candidate-list' });
    cands.slice(0, 3).forEach((m, i) => {
      const b = el('button', { class: 'btn btn-primary candidate-btn', text: `${m.san}  \u00b7  ${describeMove(m)}` });
      b.addEventListener('click', () => {
        const ev = this.tracker.resolveAmbiguous(i);
        if (ev) this.onMoveConfirmed(ev);
      });
      list.append(b);
    });
    showSheet({
      title: t('live.confirmTitle'),
      body: t('live.confirmBody'),
      content: list,
      buttons: [{ label: t('common.cancel'), kind: 'ghost', onClick: () => undefined }],
      dismissable: true
    });
  }

  private showPromotionSheet(ev: MoveConfirmedEvent): void {
    const row = el('div', { class: 'promo-row' });
    for (const alt of ev.promotionAlternatives) {
      const p = alt.promotion;
      if (!p) continue;
      const b = el('button', {
        class: 'btn btn-ghost promo-btn',
        text: `${GLYPH[p]} ${t(`live.${p === 'q' ? 'queen' : p === 'r' ? 'rook' : p === 'b' ? 'bishop' : 'knight'}`)}`
      });
      b.addEventListener('click', () => {
        const changed = this.tracker.changePromotion(p as 'q' | 'r' | 'b' | 'n');
        if (changed) {
          this.deps.vision.confirmTruth(this.tracker.state.occupancy(new Uint8Array(64)));
          this.deps.log.log(logLines.promotion(PIECE_WORDS[p] ?? p));
          this.kickEngine();
        }
      });
      row.append(b);
    }
    showSheet({
      title: t('live.promotionTitle'),
      body: t('live.promotionBody'),
      content: row,
      buttons: [{ label: t('common.ok'), kind: 'primary', onClick: () => undefined }]
    });
  }

  // ----------------------------------------------------------------- resync

  openResync(): void {
    const sheet = new ResyncSheet({
      tracker: this.tracker,
      onApplied: (fen: string) => {
        this.deps.log.log(logLines.resyncApplied(fen));
        this.deps.vision.confirmTruth(this.tracker.lastConfirmed);
        this.verifyNextDetection = true;
        this.modelReady = true;
        this.setStatus(t('live.tracking'), 'live.tracking');
        this.kickEngine();
      }
    });
    sheet.show();
  }

  // ------------------------------------------------------------- lifecycle

  onShow(): void {
    this.active = true;
    if (this.deps.keepAwake()) void this.deps.acquireWakeLock();
    // Sample the overlay draw cost into the perf budgets twice a second.
    if (!this.overlaySampler) {
      this.overlaySampler = setInterval(() => {
        this.deps.perf.overlayMs.record(this.overlay.drawMs);
      }, 500);
    }
    this.videoWrap.prepend(this.deps.camera.video);
    this.videoWrap.append(this.overlayCanvas, this.moveChip, this.evalBar.root);
    this.attachLog(this.deps.log);
    requestAnimationFrame(() => {
      this.overlay.resize(this.deps.camera.video);
      this.overlay.start();
    });
    if (!this.resizeObs) {
      this.resizeObs = new ResizeObserver(() => this.overlay.resize(this.deps.camera.video));
      this.resizeObs.observe(this.videoWrap);
    }
    window.addEventListener('resize', this.onWinResize);
  }

  private onWinResize = (): void => {
    this.overlay.resize(this.deps.camera.video);
  };

  onHide(): void {
    this.active = false;
    this.overlay.stop();
    if (this.overlaySampler) clearInterval(this.overlaySampler);
    this.overlaySampler = null;
    this.deps.releaseWakeLock();
    window.removeEventListener('resize', this.onWinResize);
  }

  isActive(): boolean {
    return this.active;
  }

  private updateButtons(): void {
    const hasCal = !!this.calibration;
    this.scanBtn.classList.toggle('hidden', !hasCal || this.modelReady || this.mode === 'demo');
    this.resyncBtn.classList.toggle('hidden', !this.modelReady);
    this.modeBtn.classList.toggle('hidden', this.mode === 'demo');
    this.calibrateBtn.classList.toggle('hidden', this.mode === 'demo');
  }

  /** Full reset: new game, keep calibration+model. */
  newGame(): void {
    this.tracker.reset();
    this.overlay.setSuggestion(null);
    this.overlay.setLastMove(null);
    this.moveChip.classList.add('hidden');
    this.evalBar.reset();
    this.deps.engine.newGame();
    this.deps.log.log(logLines.waitingForGame());
    this.setStatus(t('live.waiting'), 'live.waiting');
  }

  setTrackerFen(fen: string): boolean {
    const ok = this.tracker.setPosition(fen);
    if (ok) {
      this.deps.vision.confirmTruth(this.tracker.lastConfirmed);
      this.kickEngine();
    }
    return ok;
  }

  dispose(): void {
    this.overlay.stop();
    this.resizeObs?.disconnect();
    this.demoFeed?.stop();
    this.deps.camera.onFrame(null);
  }
}

const GLYPH: Record<string, string> = { q: '\u265b', r: '\u265c', b: '\u265d', n: '\u265e' };

function squareIndexOf(name: string): number {
  const col = name.charCodeAt(0) - 97;
  const rank = name.charCodeAt(1) - 49;
  if (col < 0 || col > 7 || rank < 0 || rank > 7) return -1;
  return (7 - rank) * 8 + col;
}

function pieceAt(state: GameState, square: string): string {
  const p = state.chess.get(square as Parameters<GameState['chess']['get']>[0]);
  return p?.type ?? '?';
}

function describeMove(m: Move): string {
  return `${PIECE_WORDS[m.piece] ?? m.piece} ${m.from}\u2192${m.to}`;
}

/** Convert a UCI move list to SAN given a starting FEN (for PV display). */
export function pvToSan(uciMoves: string[], fen: string): string[] {
  try {
    const g = new GameState(fen);
    const out: string[] = [];
    for (const uci of uciMoves) {
      const m = g.applyUciOrSan(uci);
      if (!m) break;
      out.push(m.san);
    }
    return out;
  } catch {
    return [];
  }
}

/** Interface implemented by the demo feed (src/dev/demo.ts). */
export interface DemoFeed {
  attach(screen: LiveScreen): void;
  stop(): void;
}
