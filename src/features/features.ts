/**
 * Model input features, version psl-f1. The single definition is docs/FEATURES.md;
 * training/psl/features.py implements the same thing and tests/golden/ keeps the
 * two in agreement. Change both or neither.
 */

export const FEATURE_VERSION = 'psl-f1';
export const FEATURE_DIM = 137;
export const WINDOW_T = 32;
export const WINDOW_MS = 1600;

export type P3 = [number, number, number];

/** A raw frame as defined in docs/FEATURES.md §1. */
export interface RawFrame {
  t: number;
  aspect: number;
  pose: P3[] | null;
  left: P3[] | null;
  right: P3[] | null;
}

// Indices into the 137-vector.
export const IDX = {
  leftShape: 0,
  leftPos: 60,
  leftPresent: 62,
  rightShape: 63,
  rightPos: 123,
  rightPresent: 125,
  pose: 126, // 126..135
  posePresent: 136,
} as const;

const POSE_PAIRS: [number, number][] = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

/** Mirror a raw frame into the opposite-handed form (docs/FEATURES.md §3). */
export function mirrorFrame(f: RawFrame): RawFrame {
  const flip = (pts: P3[] | null): P3[] | null => (pts ? pts.map(([x, y, z]) => [1 - x, y, z] as P3) : null);
  let pose = flip(f.pose);
  if (pose) {
    pose = pose.slice();
    for (const [a, b] of POSE_PAIRS) [pose[a], pose[b]] = [pose[b], pose[a]];
  }
  return { t: f.t, aspect: f.aspect, pose, left: flip(f.right), right: flip(f.left) };
}

interface BodyFrame {
  ox: number;
  oy: number;
  s: number;
}

function bodyFrameOf(f: RawFrame): BodyFrame | null {
  if (!f.pose) return null;
  const a = f.aspect;
  const l = f.pose[11];
  const r = f.pose[12];
  const lx = l[0] * a;
  const rx = r[0] * a;
  const s = Math.hypot(lx - rx, l[1] - r[1]);
  if (!(s >= 1e-6)) return null;
  return { ox: (lx + rx) / 2, oy: (l[1] + r[1]) / 2, s };
}

/**
 * Body frames for every frame of a recording, carrying the nearest earlier
 * (else nearest later) valid one across frames without a pose.
 */
export function carryBodyFrames(frames: RawFrame[]): (BodyFrame | null)[] {
  const own = frames.map(bodyFrameOf);
  const out: (BodyFrame | null)[] = new Array(frames.length).fill(null);
  let last: BodyFrame | null = null;
  for (let i = 0; i < frames.length; i++) {
    if (own[i]) last = own[i];
    out[i] = last;
  }
  let next: BodyFrame | null = null;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (own[i]) next = own[i];
    if (!out[i]) out[i] = next;
  }
  return out;
}

function handShape(out: Float32Array, off: number, hand: P3[], a: number): void {
  const wx = hand[0][0] * a;
  const wy = hand[0][1];
  const wz = hand[0][2] * a;
  let h = Math.hypot(hand[9][0] * a - wx, hand[9][1] - wy);
  if (!(h >= 1e-6)) h = 1e-6;
  for (let i = 1; i <= 20; i++) {
    const p = hand[i];
    const o = off + (i - 1) * 3;
    out[o] = (p[0] * a - wx) / h;
    out[o + 1] = (p[1] - wy) / h;
    out[o + 2] = (p[2] * a - wz) / h;
  }
}

/** Features of one frame given its (possibly carried-over) body frame. */
export function frameFeatures(f: RawFrame, bf: BodyFrame | null): Float32Array {
  const out = new Float32Array(FEATURE_DIM);
  const a = f.aspect;
  const body = (p: P3, o: number) => {
    if (!bf) return; // stays 0
    out[o] = (p[0] * a - bf.ox) / bf.s;
    out[o + 1] = (p[1] - bf.oy) / bf.s;
  };
  const hands: [P3[] | null, number, number, number, number][] = [
    [f.left, IDX.leftShape, IDX.leftPos, IDX.leftPresent, 15],
    [f.right, IDX.rightShape, IDX.rightPos, IDX.rightPresent, 16],
  ];
  for (const [hand, shapeOff, posOff, presOff, poseWrist] of hands) {
    if (!hand) continue;
    handShape(out, shapeOff, hand, a);
    body(f.pose ? f.pose[poseWrist] : hand[0], posOff);
    out[presOff] = 1;
  }
  if (f.pose) {
    [13, 14, 15, 16, 0].forEach((idx, k) => body(f.pose![idx], IDX.pose + k * 2));
    out[IDX.posePresent] = 1;
  }
  return out;
}

/** Features for every frame of a recording (body frames carried as specified). */
export function recordingFeatures(frames: RawFrame[]): Float32Array[] {
  const bfs = carryBodyFrames(frames);
  return frames.map((f, i) => frameFeatures(f, bfs[i]));
}

type Block = [start: number, end: number, flag: number];
const BLOCKS: Block[] = [
  [IDX.leftShape, IDX.leftPresent, IDX.leftPresent],
  [IDX.rightShape, IDX.rightPresent, IDX.rightPresent],
  [IDX.pose, IDX.posePresent, IDX.posePresent],
];

/**
 * Resample per-frame features to T evenly spaced times over the window ending
 * at tEnd (docs/FEATURES.md §4). `times` must be strictly increasing.
 */
export function resampleWindow(
  times: number[],
  feats: Float32Array[],
  tEnd: number,
  T = WINDOW_T,
  windowMs = WINDOW_MS,
): Float32Array {
  const out = new Float32Array(T * FEATURE_DIM);
  const n = times.length;
  if (n === 0) return out;
  let j = 0; // first index with times[j] >= tk
  for (let k = 0; k < T; k++) {
    const tk = tEnd - windowMs + (k * windowMs) / (T - 1);
    while (j < n && times[j] < tk) j++;
    const row = k * FEATURE_DIM;
    let ia: number;
    let ib: number;
    if (j === 0) ia = ib = 0;
    else if (j === n) ia = ib = n - 1;
    else {
      ia = j - 1;
      ib = j;
    }
    const fa = feats[ia];
    const fb = feats[ib];
    if (ia === ib) {
      out.set(fa, row);
      continue;
    }
    const ta = times[ia];
    const tb = times[ib];
    const w = (tk - ta) / (tb - ta);
    const near = tk - ta <= tb - tk ? fa : fb;
    for (const [s, e, flag] of BLOCKS) {
      out[row + flag] = near[flag];
      if (near[flag] === 0) continue; // block stays 0
      const hasA = fa[flag] !== 0;
      const hasB = fb[flag] !== 0;
      if (hasA && hasB) {
        for (let i = s; i < e; i++) out[row + i] = fa[i] + (fb[i] - fa[i]) * w;
      } else {
        const src = hasA ? fa : fb;
        for (let i = s; i < e; i++) out[row + i] = src[i];
      }
    }
  }
  return out;
}
