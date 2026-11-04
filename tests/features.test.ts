import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FEATURE_DIM,
  FEATURE_VERSION,
  mirrorFrame,
  recordingFeatures,
  resampleWindow,
  type RawFrame,
} from '../src/features/features';

// Golden vectors produced by the Python implementation (training/make_golden.py).
// Cases named real-* are real landmarks; synthetic-* are test-only edge cases.
const golden = JSON.parse(readFileSync(new URL(`./golden/features-${FEATURE_VERSION}.json`, import.meta.url), 'utf8')) as {
  feature_version: string;
  tolerance: number;
  cases: {
    name: string;
    mirror: boolean;
    frames: RawFrame[];
    frameFeatures: number[][];
    windows: { tEnd: number; T: number; windowMs: number; out: number[][] }[];
  }[];
};

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe(`feature parity with Python (${FEATURE_VERSION})`, () => {
  it('golden file matches this feature version', () => {
    expect(golden.feature_version).toBe(FEATURE_VERSION);
    expect(golden.cases.some((c) => c.name.startsWith('real-'))).toBe(true);
  });

  for (const c of golden.cases) {
    it(`${c.name}: per-frame features and resampled windows`, () => {
      const frames = c.mirror ? c.frames.map(mirrorFrame) : c.frames;
      const feats = recordingFeatures(frames);
      expect(feats.length).toBe(c.frameFeatures.length);
      feats.forEach((f, i) => {
        expect(f.length).toBe(FEATURE_DIM);
        expect(maxAbsDiff(f, c.frameFeatures[i]), `${c.name} frame ${i}`).toBeLessThan(golden.tolerance);
      });
      const times = frames.map((f) => f.t);
      for (const w of c.windows) {
        const out = resampleWindow(times, feats, w.tEnd, w.T, w.windowMs);
        expect(maxAbsDiff(out, w.out.flat()), `${c.name} window tEnd=${w.tEnd} T=${w.T}`).toBeLessThan(golden.tolerance);
      }
    });
  }
});
