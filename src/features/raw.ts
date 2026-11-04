import type { FrameLandmarks, Pt } from '../landmarks/types';
import type { P3, RawFrame } from './features';

const p3 = (pts: Pt[] | null): P3[] | null => (pts ? pts.map((p) => [p.x, p.y, p.z] as P3) : null);

/** Convert detector output to the raw-frame format of docs/FEATURES.md §1. */
export function toRawFrame(lm: FrameLandmarks): RawFrame {
  return {
    t: lm.t,
    aspect: lm.width / Math.max(1, lm.height),
    pose: p3(lm.pose),
    left: p3(lm.left),
    right: p3(lm.right),
  };
}
