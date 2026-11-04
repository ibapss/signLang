import type { Delegate } from './landmarks/types';

/**
 * Picks GPU or CPU in "auto" mode from measured speed, not just from whether the
 * GPU delegate initializes. A GPU delegate that initializes but runs on a
 * software renderer can be 20× slower than CPU (measured in headless Chromium).
 *
 * Flow: run GPU for `trialFrames` (or `trialMs`, whichever comes first, with at
 * least 3 frames); if it is slower than `slowMs`, try CPU the same way; keep CPU
 * unless it is clearly slower than the GPU was.
 */
export class AutoDelegate {
  state: 'gpu-trial' | 'cpu-trial' | 'settled' = 'gpu-trial';
  gpuMs: number | null = null;
  cpuMs: number | null = null;

  constructor(
    readonly slowMs = 120,
    readonly trialFrames = 30,
    readonly trialMs = 3000,
  ) {}

  /**
   * Returns the delegate to switch to, or null to keep the current one.
   * `elapsedMs` is time spent processing on the current detector.
   */
  update(current: Delegate, framesOnDetector: number, meanMs: number, elapsedMs = 0): Delegate | null {
    if (this.state === 'settled') return null;
    const trialDone = framesOnDetector >= this.trialFrames || (framesOnDetector >= 3 && elapsedMs >= this.trialMs);
    if (!trialDone) return null;
    if (this.state === 'gpu-trial') {
      if (current === 'GPU' && meanMs > this.slowMs) {
        this.gpuMs = meanMs;
        this.state = 'cpu-trial';
        return 'CPU';
      }
      // Fast enough on GPU, or GPU never initialized (already on CPU).
      if (current === 'GPU') this.gpuMs = meanMs;
      else this.cpuMs = meanMs;
      this.state = 'settled';
      return null;
    }
    // cpu-trial
    this.cpuMs = meanMs;
    this.state = 'settled';
    if (current === 'CPU' && this.gpuMs !== null && meanMs > this.gpuMs * 1.1) return 'GPU';
    return null;
  }

  /** The GPU failed at run time: stop experimenting and stay on CPU. */
  gpuFailed(): void {
    this.state = 'settled';
  }

  describe(): string {
    const f = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)} ms`);
    return `${this.state} (GPU ${f(this.gpuMs)}, CPU ${f(this.cpuMs)})`;
  }
}
