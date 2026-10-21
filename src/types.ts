/**
 * Shared types for ChessLens AR.
 *
 * Canonical board indexing (used everywhere in vision + game code):
 *   index i (0..63), row = i >> 3, col = i & 7
 *   row 0 = rank 8 (top of the warped image), col 0 = file 'a' (left)
 *   => index 0 is a8, index 63 is h1. White always at the bottom.
 * The calibration step warps the camera view into exactly this orientation.
 */

export const EMPTY = 0;
export const WHITE = 1;
export const BLACK = 2;

export type Occupancy = 0 | 1 | 2;

/** Board orientation options chosen during calibration. */
export type PlayerSide = 'white' | 'black';

/** 4 corner points in the source (camera) frame, x/y interleaved. */
export type CornerQuad = [number, number, number, number, number, number, number, number];

export interface Calibration {
  /**
   * Physical board corners in full-resolution camera coordinates,
   * indexed by canonical corner:
   *   0 -> a8 (top-left), 1 -> h8 (top-right), 2 -> h1 (bottom-right), 3 -> a1 (bottom-left)
   * The calibration UI assigns handles to these slots according to the
   * chosen orientation / rotation so the warp output is always canonical.
   */
  corners: CornerQuad;
  /** Camera frame size the corners refer to. */
  srcW: number;
  srcH: number;
  cameraId: string;
  createdAt: number;
}

/** Square classification feature vector layout (see vision/features.ts). */
export const FEATURE_COUNT = 8;
export const F_MEAN_Z = 0;
export const F_EDGE = 1;
export const F_SAT = 2;
export const F_TEMPLATE_DIFF = 3;
export const F_WHITE_MASS = 4;
export const F_BLACK_MASS = 5;
/** Darkest center pixel in z-space: white pieces carry a dark outline ring
 *  even under blur - separates white-on-light from empty-light. */
export const F_MIN_Z = 6;
/** Brightest center pixel in z-space: black pieces carry a light rim -
 *  separates black-on-dark from empty-dark. */
export const F_MAX_Z = 7;

/** Serializable vision model: class statistics + per-square templates. */
export interface VisionModel {
  version: 1;
  /** Class stats: 6 classes (parity x occupancy) x FEATURE_COUNT mean/var. */
  classMean: number[];
  classStd: number[];
  /** Per-square learned "empty" luminance in normalized z-space. */
  templateZ: number[];
  /** Per-square count of EMA updates (for diagnostics). */
  updates: number[];
  createdAt: number;
}

export interface DetectionResult {
  frameId: number;
  /** Observed occupancy per square (argmax classification). */
  occupancy: Uint8Array;
  /** Confidence 0..1 of the argmax class per square. */
  confidence: Float32Array;
  /** Per-square feature vectors (FEATURE_COUNT each) - debug/tuning. */
  features: Float32Array;
  /** Number of squares that differ from the previous detection. */
  changedSquares: number;
  /** True when the argmax map has been identical for `stableFrames` detections. */
  stable: boolean;
  /** Skin-tone blob or mass-change heuristic says a hand is likely over the board. */
  handLikely: boolean;
  /** Applied global brightness normalization (median/scale) for diagnostics. */
  normMedian: number;
  normScale: number;
  /** Worker-side processing time in ms. */
  timeMs: number;
  /** Whether the model was initialized when this detection ran. */
  modelReady: boolean;
}

export interface VisionThresholds {
  /** Consecutive identical detections required before "stable". */
  stableFrames: number;
  /** Fraction of warped-board pixels that are skin-tone before handLikely. */
  skinFraction: number;
  /** More than this many squares changing at once => unstable (hand). */
  maxSimultaneousChanges: number;
  /** Pixel deviation (z-space) counted as white/black mass. */
  massThreshold: number;
  /** Softmax temperature for confidence. */
  confidenceTemperature: number;
  /** EMA rate for template updates after confirmed moves. */
  templateEma: number;
  /** EMA rate for class-stat updates after confirmed moves. */
  classEma: number;
}

export const DEFAULT_THRESHOLDS: VisionThresholds = {
  stableFrames: 5,
  skinFraction: 0.05,
  maxSimultaneousChanges: 4,
  massThreshold: 22,
  confidenceTemperature: 0.35,
  templateEma: 0.05,
  classEma: 0.02
};

export type AssistSide = 'white' | 'black' | 'both';
export type AppMode = 'live' | 'video' | 'analysis' | 'demo';

export interface EngineSettings {
  /** Skill Level 0..20 */
  skill: number;
  /** MultiPV 1..3 */
  multipv: number;
  /** go movetime in ms (0 = use per-platform default) */
  movetime: number;
  /** depth cap */
  depthCap: number;
  assist: AssistSide;
  /** Force asm.js backend (auto-fallback also exists). */
  forceAsmJs: boolean;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  skill: 15,
  multipv: 1,
  movetime: 0,
  depthCap: 18,
  assist: 'white',
  forceAsmJs: false
};

export interface AppSettings {
  lang: 'en' | 'ar';
  engine: EngineSettings;
  thresholds: VisionThresholds;
  fairPlayAccepted: boolean;
  showDebug: boolean;
  /** Keep the screen awake where supported. */
  keepAwake: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  lang: 'en',
  engine: DEFAULT_ENGINE_SETTINGS,
  thresholds: DEFAULT_THRESHOLDS,
  fairPlayAccepted: false,
  showDebug: false,
  keepAwake: true
};
