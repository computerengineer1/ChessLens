/** Timing / FPS / performance-budget helpers. All allocation-light. */

export interface FpsSample {
  fps: number;
  frameCount: number;
  windowMs: number;
}

/** Rolling FPS meter over a time window. */
export class FpsMeter {
  private stamps: number[] = [];
  constructor(private windowMs = 2000) {}

  tick(now = performance.now()): void {
    this.stamps.push(now);
    const cutoff = now - this.windowMs;
    while (this.stamps.length > 0 && (this.stamps[0] as number) < cutoff) this.stamps.shift();
  }

  sample(now = performance.now()): FpsSample {
    const cutoff = now - this.windowMs;
    while (this.stamps.length > 0 && (this.stamps[0] as number) < cutoff) this.stamps.shift();
    const count = this.stamps.length;
    if (count < 2) return { fps: 0, frameCount: count, windowMs: this.windowMs };
    const span = (this.stamps[count - 1] as number) - (this.stamps[0] as number);
    const fps = span > 0 ? ((count - 1) * 1000) / span : 0;
    return { fps, frameCount: count, windowMs: this.windowMs };
  }

  reset(): void {
    this.stamps.length = 0;
  }
}

/** Min/avg/max duration tracker for a named budget line. */
export class BudgetMeter {
  private min = Infinity;
  private max = 0;
  private sum = 0;
  private n = 0;

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.min = Math.min(this.min, ms);
    this.max = Math.max(this.max, ms);
    this.sum += ms;
    this.n++;
  }

  snapshot(): { min: number; avg: number; max: number; n: number } {
    return {
      min: this.n ? this.min : 0,
      avg: this.n ? this.sum / this.n : 0,
      max: this.max,
      n: this.n
    };
  }

  reset(): void {
    this.min = Infinity;
    this.max = 0;
    this.sum = 0;
    this.n = 0;
  }
}

/** Central registry of performance budgets, printable by the debug panel. */
export class PerfBudgets {
  readonly renderFps = new FpsMeter(2000);
  readonly visionHz = new FpsMeter(4000);
  readonly visionMs = new BudgetMeter();
  readonly overlayMs = new BudgetMeter();
  readonly engineMs = new BudgetMeter();
  readonly frameGrabMs = new BudgetMeter();
  startedAt = performance.now();

  report(): Record<string, string> {
    const t = (b: BudgetMeter): string => {
      const s = b.snapshot();
      return `${s.avg.toFixed(1)}ms avg (${s.min.toFixed(1)}-${s.max.toFixed(1)}, n=${s.n})`;
    };
    return {
      'startup -> ready': `${((performance.now() - this.startedAt) / 1000).toFixed(2)}s`,
      'preview fps': this.renderFps.sample().fps.toFixed(1),
      'vision hz': this.visionHz.sample().fps.toFixed(1),
      'vision worker': t(this.visionMs),
      'overlay draw': t(this.overlayMs),
      'engine search': t(this.engineMs),
      'frame grab': t(this.frameGrabMs)
    };
  }

  reset(): void {
    this.renderFps.reset();
    this.visionHz.reset();
    this.visionMs.reset();
    this.overlayMs.reset();
    this.engineMs.reset();
    this.frameGrabMs.reset();
    this.startedAt = performance.now();
  }
}

/** Rate gate: returns true at most once every `intervalMs`. */
export class RateGate {
  private last = -Infinity;
  constructor(private intervalMs: number) {}

  allow(now = performance.now()): boolean {
    if (now - this.last >= this.intervalMs) {
      this.last = now;
      return true;
    }
    return false;
  }

  setInterval(ms: number): void {
    this.intervalMs = ms;
  }

  reset(): void {
    this.last = -Infinity;
  }
}

/** Format milliseconds as e.g. "12.3 ms". */
export function fmtMs(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}

/** Local HH:MM:SS timestamp used by the terminal log panel. */
export function timestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
