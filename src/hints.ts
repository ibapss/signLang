/** Inputs for choosing a single on-screen hint. Times are ms since the event last happened. */
export interface HintState {
  runningMs: number; // how long detection has been running
  sinceLastPerson: number; // Infinity if never
  sinceLastHand: number;
  brightness: number | null; // mean luma 0..255, null if unknown
  fps: number; // processed frames per second (rolling)
  fpsSamples: number; // how many frames the fps estimate is based on
}

export type HintKey = 'hint.no-person' | 'hint.no-hands' | 'hint.dark' | 'hint.slow' | null;

export const HINT_THRESHOLDS = {
  graceMs: 1500, // don't nag in the first moments
  absentMs: 1500, // person/hands missing this long
  darkLuma: 45,
  slowFps: 8,
  slowMinRunMs: 5000,
};

/** Highest-priority hint for the current state, or null. */
export function chooseHint(s: HintState, th = HINT_THRESHOLDS): HintKey {
  if (s.runningMs < th.graceMs) return null;
  if (s.brightness !== null && s.brightness < th.darkLuma) return 'hint.dark';
  if (s.sinceLastPerson > th.absentMs) return 'hint.no-person';
  if (s.sinceLastHand > th.absentMs) return 'hint.no-hands';
  if (s.runningMs > th.slowMinRunMs && s.fpsSamples >= 10 && s.fps > 0 && s.fps < th.slowFps) return 'hint.slow';
  return null;
}

/** Mean luma (Rec. 601) of RGBA pixel data. */
export function meanLuma(rgba: Uint8ClampedArray): number {
  let sum = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return n ? sum / n : 0;
}
