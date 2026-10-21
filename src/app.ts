/**
 * App: top-level orchestrator.
 *
 * Owns settings, i18n, screens, shared services (camera, vision worker,
 * engine, log, perf budgets) and wires them together. Created once by
 * main.ts.
 */

import type { AppSettings, Calibration, VisionThresholds } from './types.js';
import { loadSettings, saveSettings, loadCalibrationFor, saveCalibration as storeCalibration, loadModelFor, saveModel as storeModel, clearCalibrations, clearModels } from './util/storage.js';
import { setLang, t, onLangChange, detectInitialLang } from './ui/i18n.js';
import { ScreenManager } from './ui/screens.js';
import { FairPlayScreen } from './ui/fairplay.js';
import { LiveScreen } from './ui/live.js';
import { CalibrationScreen } from './ui/calibration.js';
import { SettingsScreen } from './ui/settings.js';
import { DebugScreen } from './ui/debugview.js';
import { AnalysisScreen } from './ui/analysis.js';
import { LogPanel, logLines } from './ui/logpanel.js';
import { CameraSource, WakeLock } from './camera/camera.js';
import { VisionClient } from './vision/visionClient.js';
import { EngineClient } from './engine/engineClient.js';
import { PerfBudgets } from './util/timing.js';
import { initOverlays, toast } from './ui/toast.js';
import { DemoPlayer } from './dev/demo.js';

export interface AppOptions {
  demo?: boolean;
}

export class App {
  settings: AppSettings;
  readonly perf = new PerfBudgets();
  readonly log = new LogPanel();
  readonly camera = new CameraSource();
  readonly vision: VisionClient;
  readonly engine: EngineClient;
  readonly wakeLock = new WakeLock();

  private screens: ScreenManager;
  private fairplay!: FairPlayScreen;
  private live!: LiveScreen;
  private calibration!: CalibrationScreen;
  private settingsScreen!: SettingsScreen;
  private debugScreen!: DebugScreen;
  private analysis!: AnalysisScreen;
  private opts: AppOptions;
  private demo: DemoPlayer | null = null;

  constructor(host: HTMLElement, opts: AppOptions = {}) {
    this.opts = opts;
    this.settings = loadSettings();
    if (!localStorageHasLang() && this.settings.lang === 'en') {
      // First run: follow the browser language.
      this.settings.lang = detectInitialLang();
    }
    setLang(this.settings.lang);

    initOverlays(host);
    this.screens = new ScreenManager(host);

    this.engine = new EngineClient(this.settings.engine, {
      onInfo: (line) => {
        if (this.screens.current() === 'analysis') this.analysis.onEngineInfo(line);
        else this.live.onEngineInfo(line);
      },
      onBestMove: (mv, ms) => {
        if (this.screens.current() === 'analysis') this.analysis.onEngineBestMove(mv);
        else this.live.onEngineBestMove(mv, ms);
      },
      onStatus: (status, backend, error) => {
        if (status === 'failed') this.log.log(logLines.engineFailed(), 'error');
        else if (error) this.log.log(`engine: ${error}`, 'warn');
        else if (status === 'ready') this.log.log(`engine backend: ${backend}`, 'engine');
      }
    });

    this.vision = new VisionClient({
      onDetection: (msg) => {
        this.debugScreen.setDetection(msg);
        this.live.onDetectionMessage(msg);
      },
      onCalibrated: (coverage) => this.live.onCalibrated(coverage),
      onLearned: (ok, model) => this.live.onLearned(ok, model),
      onLearnProgress: (have, need) => this.live.onLearnProgress(have, need),
      onError: (message) => this.log.log(`vision: ${message}`, 'error')
    });
    this.vision.setThresholds(this.settings.thresholds);

    this.buildScreens(host);
    onLangChange(() => this.refreshI18n());
  }

  private buildScreens(host: HTMLElement): void {
    this.fairplay = new FairPlayScreen(() => this.onFairPlayAccepted());

    this.live = new LiveScreen({
      camera: this.camera,
      vision: this.vision,
      engine: this.engine,
      log: this.log,
      perf: this.perf,
      getSettings: () => this.settings,
      loadCalibration: (id) => loadCalibrationFor(id),
      saveCalibration: (cal) => storeCalibration(cal),
      loadModel: (id) => loadModelFor(id),
      saveModel: (id, model) => storeModel(id, model),
      openCalibration: () => this.openCalibration(),
      openSettings: () => {
        this.lastMainScreen = this.screens.current() === 'analysis' ? 'analysis' : this.lastMainScreen;
        this.screens.show('settings');
      },
      openDebug: () => {
        this.vision.setPreview(true);
        this.screens.show('debug');
      },
      openAnalysis: () => void this.openAnalysis(),
      keepAwake: () => this.settings.keepAwake,
      acquireWakeLock: () => this.wakeLock.acquire(),
      releaseWakeLock: () => this.wakeLock.release()
    });

    this.calibration = new CalibrationScreen({
      camera: this.camera,
      onSaved: (cal) => this.onCalibrationSaved(cal),
      onCancel: () => this.screens.show('live'),
      getSavedCameraId: () => this.camera.activeDeviceId
    });

    this.analysis = new AnalysisScreen({ engine: this.engine, log: this.log });

    this.settingsScreen = new SettingsScreen({
      getSettings: () => this.settings,
      onChange: (patch) => this.patchSettings(patch),
      onEngineChange: (patch) => {
        this.settings.engine = { ...this.settings.engine, ...patch };
        saveSettings(this.settings);
        this.engine.updateSettings(patch);
        if (patch.forceAsmJs !== undefined) this.recreateEngineForBackendChange();
      },
      onThresholdChange: (patch) => {
        this.settings.thresholds = { ...this.settings.thresholds, ...patch };
        saveSettings(this.settings);
        this.vision.setThresholds(patch);
      },
      onResetAll: () => this.resetAll(),
      onClose: () => this.screens.show(this.lastMainScreen)
    });

    this.debugScreen = new DebugScreen({
      getSettings: () => this.settings,
      onThresholdChange: (patch) => {
        this.settings.thresholds = { ...this.settings.thresholds, ...patch };
        saveSettings(this.settings);
        this.vision.setThresholds(patch);
      },
      onTrackerConfigChange: (patch) => {
        Object.assign(this.live.tracker.config, patch);
      },
      getTrackerConfig: () => ({
        acceptCost: this.live.tracker.config.acceptCost,
        acceptMargin: this.live.tracker.config.acceptMargin,
        weakConfidence: this.live.tracker.config.weakConfidence,
        recoveryAcceptCost: this.live.tracker.config.recoveryAcceptCost,
        recoveryMargin: this.live.tracker.config.recoveryMargin,
        lostAfter: this.live.tracker.config.lostAfter
      }),
      getPerf: () => this.perf,
      getEngineStatus: () => `${this.engine.getStatus()} (${this.engine.getBackend()})`,
      getTrackerInfo: () => ({ fen: this.live.tracker.fen(), confirmed: this.live.tracker.lastConfirmed })
    });
    window.addEventListener('chesslens:close-debug', () => {
      this.vision.setPreview(false);
      this.screens.show(this.lastMainScreen);
    });
    window.addEventListener('chesslens:preview', ((ev: CustomEvent) => {
      this.debugScreen.setPreview(ev.detail.data as Uint8ClampedArray, ev.detail.size as number);
    }) as EventListener);

    for (const s of [this.fairplay, this.live, this.calibration, this.analysis, this.settingsScreen, this.debugScreen]) {
      this.screens.register(s);
    }
    void host;
  }

  private lastMainScreen = 'live';
  private started = false;

  /** Entry point from main.ts. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.settings.fairPlayAccepted) {
      this.screens.show('fairplay');
      return;
    }
    void this.enterMain();
  }

  private onFairPlayAccepted(): void {
    this.settings.fairPlayAccepted = true;
    saveSettings(this.settings);
    void this.enterMain();
  }

  private async enterMain(): Promise<void> {
    this.screens.show('live');
    this.lastMainScreen = 'live';
    this.log.log(`chesslens ar v${APP_VERSION} - engine and vision run fully on-device`);
    if (this.opts.demo || new URLSearchParams(location.search).get('demo') === '1') {
      await this.startDemo();
      return;
    }
    await this.live.startLiveMode();
    this.live.startEngine();
    this.log.log(logLines.waitingForGame());
  }

  private async startDemo(): Promise<void> {
    toast(t('demo.active'), 'info', 3500);
    this.log.log('demo: synthetic PGN playback mode (no camera needed)');
    this.demo = new DemoPlayer(this.log);
    await this.live.startDemoMode(this.demo);
    this.live.startEngine();
  }

  async openAnalysis(): Promise<void> {
    this.lastMainScreen = 'analysis';
    this.screens.show('analysis');
    void this.engine.start();
  }

  async openLive(): Promise<void> {
    this.lastMainScreen = 'live';
    this.screens.show('live');
    if (!this.camera.isRunning() && !this.demo) {
      await this.live.startLiveMode();
    }
  }

  private async openCalibration(): Promise<void> {
    this.lastMainScreen = 'live';
    if (!this.camera.isRunning()) {
      await this.live.startLiveMode();
    }
    this.screens.show('calibration');
  }

  private onCalibrationSaved(cal: Calibration): void {
    this.live.applyCalibration(cal, true);
    this.screens.show('live');
    toast(t('cal.saved'));
    if (this.settings.keepAwake) void this.wakeLock.acquire();
  }

  private patchSettings(patch: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    if (patch.lang) setLang(patch.lang);
    if (patch.keepAwake === false) this.wakeLock.release();
    if (patch.keepAwake === true && this.screens.current() === 'live') void this.wakeLock.acquire();
  }

  private recreateEngineForBackendChange(): void {
    // Force-asm.js toggled: restart the engine worker with the new backend.
    this.engine.updateSettings({ forceAsmJs: this.settings.engine.forceAsmJs });
    void this.engine.restart();
  }

  private resetAll(): void {
    clearCalibrations();
    clearModels();
    this.settings = loadSettings();
    this.settings.fairPlayAccepted = true; // do not nag again after reset
    saveSettings(this.settings);
    this.vision.setThresholds(this.settings.thresholds);
    toast(t('set.resetDone'));
    this.log.log('storage cleared (calibrations, models, settings)');
  }

  private refreshI18n(): void {
    this.fairplay.refreshI18n();
    this.live.refreshI18n();
    this.calibration.refreshI18n();
    this.settingsScreen.refreshI18n();
    this.debugScreen.refreshI18n();
    this.analysis.refreshI18n();
  }

  /** Called by main.ts when the window gains focus again (wake lock re-acquire). */
  onResume(): void {
    if (this.settings.keepAwake && this.screens.current() === 'live') void this.wakeLock.acquire();
  }

  setThresholdsLive(patch: Partial<VisionThresholds>): void {
    this.vision.setThresholds(patch);
  }

  /** Exposed for tests/debugging. */
  getScreenManager(): ScreenManager {
    return this.screens;
  }
}

export const APP_VERSION = '0.1.0';

function localStorageHasLang(): boolean {
  try {
    const raw = localStorage.getItem('chesslens.settings');
    return !!raw && raw.includes('"lang"');
  } catch {
    return false;
  }
}
