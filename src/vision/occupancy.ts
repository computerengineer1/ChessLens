/**
 * Per-square occupancy classification: empty / white piece / black piece.
 *
 * Self-supervised: the model is learned from a scan of a KNOWN position
 * (the game start position by default). Six classes are formed
 * (dark/light square x empty/white/black) and described by Gaussian
 * statistics over the feature vectors from features.ts. Per-square
 * "empty" luminance templates adapt over time with an EMA so lighting
 * drift does not break classification.
 *
 * No piece-TYPE recognition happens anywhere: types come from the tracked
 * game state (see game/tracker.ts).
 */

import {
  BLACK,
  EMPTY,
  FEATURE_COUNT,
  F_MEAN_Z,
  F_MIN_Z,
  F_MAX_Z,
  WHITE,
  type VisionModel
} from '../types.js';
import { isDarkSquare } from './features.js';

/** classIndex = parity * 3 + state, parity: 0 dark, 1 light; state: 0/1/2. */
export const CLASS_COUNT = 6;

export function classIndex(squareIndex: number, state: number): number {
  return (isDarkSquare(squareIndex) ? 0 : 3) + state;
}

export function stateFromClass(cls: number): number {
  return cls % 3;
}

export interface ClassifierModel {
  classMean: Float32Array; // CLASS_COUNT * FEATURE_COUNT
  classStd: Float32Array;
  templateZ: Float32Array; // 64
  updates: Float32Array; // 64
  initialized: boolean;
}

/** Per-feature std floors so no single feature can dominate with ~0 variance. */
const STD_FLOOR = new Float32Array([3, 2, 0.04, 3, 0.05, 0.05, 6, 6]);

export function createModel(): ClassifierModel {
  const m: ClassifierModel = {
    classMean: new Float32Array(CLASS_COUNT * FEATURE_COUNT),
    classStd: new Float32Array(CLASS_COUNT * FEATURE_COUNT),
    templateZ: new Float32Array(64),
    updates: new Float32Array(64),
    initialized: false
  };
  for (let i = 0; i < m.classStd.length; i++) m.classStd[i] = STD_FLOOR[i % FEATURE_COUNT] as number;
  return m;
}

export function modelToSerializable(m: ClassifierModel, cameraId?: string): VisionModel {
  void cameraId;
  return {
    version: 1,
    classMean: Array.from(m.classMean),
    classStd: Array.from(m.classStd),
    templateZ: Array.from(m.templateZ),
    updates: Array.from(m.updates),
    createdAt: Date.now()
  };
}

export function modelFromSerializable(v: VisionModel): ClassifierModel | null {
  if (
    v.classMean.length !== CLASS_COUNT * FEATURE_COUNT ||
    v.classStd.length !== CLASS_COUNT * FEATURE_COUNT ||
    v.templateZ.length !== 64
  ) {
    return null;
  }
  const m = createModel();
  m.classMean.set(v.classMean);
  m.classStd.set(v.classStd);
  m.templateZ.set(v.templateZ);
  if (v.updates?.length === 64) m.updates.set(v.updates);
  m.initialized = true;
  return m;
}

/**
 * Bootstrap the per-square "empty" templates (z-space) from a known
 * position. Ranks without pieces give direct empty samples; squares that
 * hold a piece inherit the parity mean so features are computable
 * immediately. MUST run BEFORE computeFeatures() during a scan, otherwise
 * class statistics would be learned in a different feature space.
 */
export function bootstrapTemplates(
  m: ClassifierModel,
  squareMeanL: Float32Array,
  stats: { median: number; scale: number; planeB?: number; planeC?: number },
  truth: Uint8Array
): void {
  const gain = 60 / Math.max(stats.scale, 8);
  const planeB = stats.planeB ?? 0;
  const planeC = stats.planeC ?? 0;
  const zOf = (s: number): number => {
    const row = s >> 3;
    const col = s & 7;
    return (
      ((squareMeanL[s] as number) - stats.median) * gain -
      (planeB * (row - 3.5) + planeC * (col - 3.5))
    );
  };
  let darkSum = 0;
  let darkN = 0;
  let lightSum = 0;
  let lightN = 0;
  for (let s = 0; s < 64; s++) {
    if (truth[s] !== EMPTY) continue;
    const z = zOf(s);
    if (isDarkSquare(s)) {
      darkSum += z;
      darkN++;
    } else {
      lightSum += z;
      lightN++;
    }
  }
  const darkMean = darkN ? darkSum / darkN : -35;
  const lightMean = lightN ? lightSum / lightN : 35;
  for (let s = 0; s < 64; s++) {
    if (truth[s] === EMPTY) {
      m.templateZ[s] = zOf(s);
      m.updates[s] = 1;
    } else {
      m.templateZ[s] = isDarkSquare(s) ? darkMean : lightMean;
      m.updates[s] = 0;
    }
  }
}

/**
 * Learn Gaussian class statistics (6 classes x FEATURE_COUNT) from one
 * averaged feature set whose ground-truth occupancy is known.
 */
export function learnClassStats(m: ClassifierModel, features: Float32Array, truth: Uint8Array): void {
  const sum = new Float64Array(CLASS_COUNT * FEATURE_COUNT);
  const sum2 = new Float64Array(CLASS_COUNT * FEATURE_COUNT);
  const count = new Int32Array(CLASS_COUNT);
  for (let s = 0; s < 64; s++) {
    const cls = classIndex(s, truth[s] as number);
    count[cls]++;
    for (let f = 0; f < FEATURE_COUNT; f++) {
      const x = features[s * FEATURE_COUNT + f] as number;
      sum[cls * FEATURE_COUNT + f] += x;
      sum2[cls * FEATURE_COUNT + f] += x * x;
    }
  }
  for (let cls = 0; cls < CLASS_COUNT; cls++) {
    const parity = cls < 3 ? 0 : 1;
    const state = cls % 3;
    for (let f = 0; f < FEATURE_COUNT; f++) {
      const i = cls * FEATURE_COUNT + f;
      if (count[cls] >= 2) {
        const mean = (sum[i] as number) / count[cls];
        const varc = Math.max(0, (sum2[i] as number) / count[cls] - mean * mean);
        m.classMean[i] = mean;
        m.classStd[i] = Math.max(Math.sqrt(varc), STD_FLOOR[f] as number);
      } else {
        const emptyMean = (() => {
          const ec = parity * 3;
          return count[ec] > 0 ? (sum[ec * FEATURE_COUNT + F_MEAN_Z] as number) / count[ec] : parity === 0 ? -35 : 35;
        })();
        m.classMean[i] = priorMean(f, state, parity, emptyMean);
        m.classStd[i] = 4 * (STD_FLOOR[f] as number) + Math.abs(m.classMean[i] as number) * 0.25;
      }
    }
  }
  m.initialized = true;
}

/**
 * Convenience wrapper used when features were already computed with valid
 * templates (rare; the pipeline uses bootstrapTemplates + learnClassStats).
 */
export function learnModel(m: ClassifierModel, features: Float32Array, truth: Uint8Array): void {
  learnClassStats(m, features, truth);
}

function priorMean(f: number, state: number, parity: number, emptyZ: number): number {
  switch (f) {
    case F_MEAN_Z:
      if (state === EMPTY) return emptyZ;
      return state === WHITE ? emptyZ + (parity === 0 ? 55 : 25) : emptyZ - (parity === 1 ? 55 : 25);
    case F_MIN_Z:
      if (state === EMPTY) return emptyZ - 10;
      return state === WHITE ? -130 : emptyZ - 40;
    case F_MAX_Z:
      if (state === EMPTY) return emptyZ + 10;
      return state === BLACK ? 120 : emptyZ + 40;
    default:
      return state === EMPTY ? 0 : 0.3;
  }
}

/**
 * Classify one square. Returns the state (0/1/2) and softmax confidence
 * over the three classes allowed for the square's parity.
 */
let llScratch: Float64Array | null = null;
let probeScratch: { state: number; conf: number } | null = null;

export function classifySquare(
  m: ClassifierModel,
  features: Float32Array,
  s: number,
  temperature: number,
  out?: { state: number; conf: number }
): { state: number; conf: number } {
  const res = out ?? { state: EMPTY, conf: 0 };
  if (!m.initialized) {
    res.state = EMPTY;
    res.conf = 0;
    return res;
  }
  const parity = isDarkSquare(s) ? 0 : 1;
  const logLik = llScratch ?? (llScratch = new Float64Array(3));
  let maxLL = -Infinity;
  for (let k = 0; k < 3; k++) {
    const cls = parity * 3 + k;
    let ll = 0;
    for (let f = 0; f < FEATURE_COUNT; f++) {
      const x = features[s * FEATURE_COUNT + f] as number;
      const mu = m.classMean[cls * FEATURE_COUNT + f] as number;
      const sd = m.classStd[cls * FEATURE_COUNT + f] as number;
      const d = x - mu;
      ll += -(d * d) / (2 * sd * sd) - Math.log(sd);
    }
    logLik[k] = ll;
    if (ll > maxLL) maxLL = ll;
  }
  let sumExp = 0;
  for (let k = 0; k < 3; k++) {
    const z = Math.max(-60, Math.min(60, ((logLik[k] as number) - maxLL) / temperature));
    logLik[k] = Math.exp(z);
    sumExp += logLik[k] as number;
  }
  let best = 0;
  for (let k = 1; k < 3; k++) if ((logLik[k] as number) > (logLik[best] as number)) best = k;
  res.state = best;
  res.conf = sumExp > 0 ? (logLik[best] as number) / sumExp : 0;
  return res;
}

/** Classify all 64 squares into occupancy + confidence arrays. */
export function classifyAll(
  m: ClassifierModel,
  features: Float32Array,
  occupancy: Uint8Array,
  confidence: Float32Array,
  temperature: number
): void {
  const probe = probeScratch ?? (probeScratch = { state: EMPTY, conf: 0 });
  for (let s = 0; s < 64; s++) {
    classifySquare(m, features, s, temperature, probe);
    occupancy[s] = probe.state;
    confidence[s] = probe.conf;
  }
}

/**
 * EMA update after a confirmed move: for every square whose classification
 * matched ground truth, adapt the empty template and the class statistics.
 */
export function updateModel(
  m: ClassifierModel,
  features: Float32Array,
  truth: Uint8Array,
  classified: Uint8Array,
  templateEma: number,
  classEma: number
): void {
  if (!m.initialized) return;
  for (let s = 0; s < 64; s++) {
    if (classified[s] !== truth[s]) continue;
    const cls = classIndex(s, truth[s] as number);
    for (let f = 0; f < FEATURE_COUNT; f++) {
      const i = cls * FEATURE_COUNT + f;
      const x = features[s * FEATURE_COUNT + f] as number;
      m.classMean[i] = (1 - classEma) * (m.classMean[i] as number) + classEma * x;
      const d = x - (m.classMean[i] as number);
      const sd = m.classStd[i] as number;
      const newVar = (1 - classEma) * sd * sd + classEma * d * d;
      m.classStd[i] = Math.max(Math.sqrt(newVar), STD_FLOOR[f] as number);
    }
    if (truth[s] === EMPTY) {
      const z = features[s * FEATURE_COUNT + F_MEAN_Z] as number;
      m.templateZ[s] = (1 - templateEma) * (m.templateZ[s] as number) + templateEma * z;
      m.updates[s]++;
    }
  }
}

/** Human-readable occupancy label for logs/debug. */
export function occupancyLabel(state: number): 'empty' | 'white' | 'black' {
  return state === WHITE ? 'white' : state === BLACK ? 'black' : 'empty';
}
