/**
 * Camera source abstraction: live getUserMedia, device enumeration/selection,
 * and a video-FILE source for testing without a board (mp4/webm as camera).
 *
 * Frame delivery uses requestVideoFrameCallback when available (perfectly
 * synced to the compositor, no tearing) and falls back to a 30 Hz timer.
 */

export type CameraErrorCode = 'denied' | 'missing' | 'generic' | 'insecure';

export class CameraError extends Error {
  code: CameraErrorCode;
  constructor(code: CameraErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export type FrameCallback = (video: HTMLVideoElement, now: number) => void;

/** Ideal constraints: rear camera, 1280x720 @ 30fps (spec performance budget). */
export function rearVideoConstraints(deviceId?: string): MediaStreamConstraints {
  const facing: MediaTrackConstraintSet['facingMode'] = deviceId ? undefined : { ideal: 'environment' };
  return {
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      ...(facing ? { facingMode: facing } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 }
    },
    audio: false
  };
}

function mapGetUserMediaError(err: unknown): CameraError {
  const e = err as { name?: string; message?: string };
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'camera permission denied');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('missing', 'no matching camera found');
    default:
      return new CameraError('generic', e?.message ?? String(err));
  }
}

export class CameraSource {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private objectUrl: string | null = null;
  private rvfcId = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private frameCb: FrameCallback | null = null;
  private running = false;
  activeDeviceId = '';

  constructor() {
    const v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('autoplay', '');
    v.muted = true;
    v.defaultMuted = true;
    this.video = v;
  }

  isRunning(): boolean {
    return this.running;
  }

  videoSize(): { w: number; h: number } {
    return { w: this.video.videoWidth, h: this.video.videoHeight };
  }

  async listDevices(): Promise<CameraDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch {
      return [];
    }
  }

  /** Start a live camera. Throws CameraError on failure. */
  async startLive(deviceId?: string): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const secure = typeof isSecureContext !== 'undefined' ? isSecureContext : false;
      throw new CameraError(secure ? 'generic' : 'insecure', 'getUserMedia unavailable');
    }
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(rearVideoConstraints(deviceId));
    } catch (err) {
      throw mapGetUserMediaError(err);
    }
    this.video.srcObject = this.stream;
    this.activeDeviceId = deviceId ?? (this.stream.getVideoTracks()[0]?.getSettings().deviceId ?? '');
    await this.video.play().catch(() => undefined);
    this.startFrameLoop();
  }

  /** Use a local video file as the camera source (Video file mode). */
  async startFile(file: File): Promise<void> {
    this.stop();
    this.objectUrl = URL.createObjectURL(file);
    this.video.srcObject = null;
    this.video.src = this.objectUrl;
    this.video.loop = true;
    await this.video.play().catch(() => undefined);
    this.activeDeviceId = `file:${file.name}`;
    this.startFrameLoop();
  }

  private startFrameLoop(): void {
    this.running = true;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      const step = (now: number): void => {
        if (!this.running) return;
        this.frameCb?.(v, now);
        this.rvfcId = v.requestVideoFrameCallback?.(step) ?? 0;
      };
      this.rvfcId = v.requestVideoFrameCallback(step);
    } else {
      this.timerId = setInterval(() => {
        if (this.running && !v.paused) this.frameCb?.(v, performance.now());
      }, 33);
    }
  }

  onFrame(cb: FrameCallback | null): void {
    this.frameCb = cb;
  }

  /** Grab the current frame as an ImageBitmap (transferred to the worker). */
  async grabBitmap(): Promise<ImageBitmap | null> {
    if (!this.running || this.video.readyState < 2) return null;
    try {
      return await createImageBitmap(this.video);
    } catch {
      return null;
    }
  }

  stop(): void {
    this.running = false;
    if (this.rvfcId) {
      const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
      v.cancelVideoFrameCallback?.(this.rvfcId);
      this.rvfcId = 0;
    }
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.load();
  }
}

/**
 * Screen wake lock with graceful degradation. Capacitor webviews without the
 * API simply report unsupported (documented limitation; Android WebView does
 * not expose Wake Lock API yet).
 */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  async acquire(): Promise<boolean> {
    this.wanted = true;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        // Re-acquire when the page becomes visible again.
        if (this.wanted && typeof document !== 'undefined') {
          document.addEventListener(
            'visibilitychange',
            () => {
              if (document.visibilityState === 'visible') void this.acquire();
            },
            { once: true }
          );
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  release(): void {
    this.wanted = false;
    void this.sentinel?.release();
    this.sentinel = null;
  }
}
