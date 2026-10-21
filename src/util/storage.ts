import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Calibration,
  type EngineSettings,
  type VisionModel,
  type VisionThresholds
} from '../types.js';

const NS = 'chesslens';
const VERSION = 1;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Small in-memory fallback so the app (and tests) keep working when
 * localStorage is unavailable or throws (private mode, some webviews).
 */
class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function detectBackend(): StorageLike {
  try {
    const probe = '__chesslens_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return new MemoryStorage();
  }
}

let backend: StorageLike | null = null;

/** Replace the backing store (used by tests and headless environments). */
export function setStorageBackend(next: StorageLike | null): void {
  backend = next;
}

function store(): StorageLike {
  if (!backend) backend = detectBackend();
  return backend;
}

function key(name: string): string {
  return `${NS}.${name}`;
}

export function readJSON<T>(name: string): T | null {
  const raw = store().getItem(key(name));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(name: string, value: unknown): boolean {
  try {
    store().setItem(key(name), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(name: string): void {
  try {
    store().removeItem(key(name));
  } catch {
    /* ignore */
  }
}

export function bytesUsed(): number {
  let total = 0;
  for (const name of ['settings', 'models', 'calibrations', 'fairplay']) {
    const raw = store().getItem(key(name));
    if (raw) total += raw.length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function mergeEngine(base: EngineSettings, raw: unknown): EngineSettings {
  if (!isRecord(raw)) return { ...base };
  const out = { ...base };
  if (typeof raw.skill === 'number') out.skill = clampInt(raw.skill, 0, 20);
  if (typeof raw.multipv === 'number') out.multipv = clampInt(raw.multipv, 1, 3);
  if (typeof raw.movetime === 'number') out.movetime = clampInt(raw.movetime, 0, 10000);
  if (typeof raw.depthCap === 'number') out.depthCap = clampInt(raw.depthCap, 1, 40);
  if (raw.assist === 'white' || raw.assist === 'black' || raw.assist === 'both') out.assist = raw.assist;
  if (typeof raw.forceAsmJs === 'boolean') out.forceAsmJs = raw.forceAsmJs;
  return out;
}

function mergeThresholds(base: VisionThresholds, raw: unknown): VisionThresholds {
  if (!isRecord(raw)) return { ...base };
  const out = { ...base };
  if (typeof raw.stableFrames === 'number') out.stableFrames = clampInt(raw.stableFrames, 1, 30);
  if (typeof raw.skinFraction === 'number') out.skinFraction = clampNum(raw.skinFraction, 0.005, 0.6);
  if (typeof raw.maxSimultaneousChanges === 'number') {
    out.maxSimultaneousChanges = clampInt(raw.maxSimultaneousChanges, 1, 32);
  }
  if (typeof raw.massThreshold === 'number') out.massThreshold = clampNum(raw.massThreshold, 4, 90);
  if (typeof raw.confidenceTemperature === 'number') {
    out.confidenceTemperature = clampNum(raw.confidenceTemperature, 0.05, 4);
  }
  if (typeof raw.templateEma === 'number') out.templateEma = clampNum(raw.templateEma, 0, 0.5);
  if (typeof raw.classEma === 'number') out.classEma = clampNum(raw.classEma, 0, 0.5);
  return out;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function clampNum(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
}

/** Load settings, tolerating older/partial payloads by merging over defaults. */
export function loadSettings(): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  const raw = readJSON<Record<string, unknown>>('settings');
  if (!isRecord(raw) || raw.version !== VERSION) return base;
  if (raw.lang === 'en' || raw.lang === 'ar') base.lang = raw.lang;
  if (typeof raw.fairPlayAccepted === 'boolean') base.fairPlayAccepted = raw.fairPlayAccepted;
  if (typeof raw.showDebug === 'boolean') base.showDebug = raw.showDebug;
  if (typeof raw.keepAwake === 'boolean') base.keepAwake = raw.keepAwake;
  base.engine = mergeEngine(base.engine, raw.engine);
  base.thresholds = mergeThresholds(base.thresholds, raw.thresholds);
  return base;
}

export function saveSettings(settings: AppSettings): boolean {
  return writeJSON('settings', { version: VERSION, ...settings });
}

// ---------------------------------------------------------------------------
// Calibrations (one per camera id)
// ---------------------------------------------------------------------------

const MAX_CALIBRATIONS = 8;

function isValidCalibration(c: unknown): c is Calibration {
  if (!isRecord(c)) return false;
  if (!Array.isArray(c.corners) || c.corners.length !== 8) return false;
  if (!c.corners.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return typeof c.srcW === 'number' && typeof c.srcH === 'number' && typeof c.cameraId === 'string';
}

export function loadCalibrations(): Map<string, Calibration> {
  const out = new Map<string, Calibration>();
  const raw = readJSON<unknown[]>('calibrations');
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (isValidCalibration(item)) out.set(item.cameraId, item);
  }
  return out;
}

export function saveCalibration(cal: Calibration): boolean {
  const all = loadCalibrations();
  all.set(cal.cameraId, cal);
  const list = [...all.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_CALIBRATIONS);
  return writeJSON('calibrations', list);
}

export function loadCalibrationFor(cameraId: string): Calibration | null {
  return loadCalibrations().get(cameraId) ?? null;
}

export function clearCalibrations(): void {
  remove('calibrations');
}

// ---------------------------------------------------------------------------
// Vision models (one per camera id)
// ---------------------------------------------------------------------------

function isValidModel(m: unknown): m is VisionModel {
  if (!isRecord(m)) return false;
  return Array.isArray(m.classMean) && Array.isArray(m.classStd) && Array.isArray(m.templateZ);
}

export function loadModels(): Map<string, VisionModel> {
  const out = new Map<string, VisionModel>();
  const raw = readJSON<Record<string, unknown>>('models');
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (isValidModel(v)) out.set(k, v);
  }
  return out;
}

export function saveModel(cameraId: string, model: VisionModel): boolean {
  const all = loadModels();
  all.set(cameraId, model);
  const obj: Record<string, VisionModel> = {};
  for (const [k, v] of all) obj[k] = v;
  return writeJSON('models', obj);
}

export function loadModelFor(cameraId: string): VisionModel | null {
  return loadModels().get(cameraId) ?? null;
}

export function clearModels(): void {
  remove('models');
}

export const __testing = { MemoryStorage, VERSION };
