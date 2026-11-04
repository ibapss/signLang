/** Rolling mean over the last `size` samples. */
export class RollingMean {
  private buf: number[] = [];
  private sum = 0;
  constructor(private readonly size: number) {}
  push(v: number): void {
    this.buf.push(v);
    this.sum += v;
    if (this.buf.length > this.size) this.sum -= this.buf.shift()!;
  }
  get mean(): number {
    return this.buf.length ? this.sum / this.buf.length : 0;
  }
  get count(): number {
    return this.buf.length;
  }
  reset(): void {
    this.buf = [];
    this.sum = 0;
  }
}

/** Frames per second from timestamps (ms) seen in the last `windowMs`. */
export class FpsMeter {
  private times: number[] = [];
  constructor(private readonly windowMs = 2000) {}
  tick(t: number): void {
    this.times.push(t);
    while (this.times.length && t - this.times[0] > this.windowMs) this.times.shift();
  }
  get fps(): number {
    if (this.times.length < 2) return 0;
    const span = this.times[this.times.length - 1] - this.times[0];
    return span > 0 ? ((this.times.length - 1) * 1000) / span : 0;
  }
  reset(): void {
    this.times = [];
  }
}

/** Strictly increasing timestamps, as MediaPipe VIDEO mode requires. */
export class MonotonicClock {
  private last = -Infinity;
  next(now: number): number {
    const t = now <= this.last ? this.last + 1 : now;
    this.last = t;
    return t;
  }
}
