import type { AssignedHand, HandSide, Pt, RawHand } from './types';

/** MediaPipe pose indices (anatomical, on an unmirrored image). */
export const POSE_LEFT_WRIST = 15;
export const POSE_RIGHT_WRIST = 16;
const MIN_WRIST_VISIBILITY = 0.3;

function dist(a: Pt, b: Pt, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * MediaPipe's documentation says hand labels assume a mirrored selfie image,
 * which would make them inverted on the unmirrored frames we feed. Measured
 * with tasks-vision 1.1.1 + hand_landmarker v1 on an unmirrored clip, the label
 * matched the anatomical side (per pose wrists) for 183 of 187 hands, so we use
 * it as-is. Re-check whenever MediaPipe or the model is upgraded
 * (e2e/handedness.spec.ts checks it in CI).
 */
export const MP_LABEL_IS_ANATOMICAL = true;

function labelSide(label: RawHand['mpLabel']): HandSide | null {
  if (label === 'Unknown') return null;
  const anatomical: HandSide = label === 'Left' ? 'left' : 'right';
  if (MP_LABEL_IS_ANATOMICAL) return anatomical;
  return anatomical === 'left' ? 'right' : 'left';
}

/**
 * Decide which detected hand is the signer's left and which is the right.
 *
 * Primary rule: match each hand's wrist (landmark 0) to the nearest pose wrist.
 * The pose model's left/right are anatomical on unmirrored frames (verified on
 * the PSL dictionary data, see docs/DATASETS.md). Fallback when pose wrists are
 * not visible: the MediaPipe handedness label (see MP_LABEL_IS_ANATOMICAL). Last resort for two hands
 * with the same label: horizontal position (a signer facing the camera has the
 * right hand on the image's left).
 *
 * `aspect` = frame width / height, so distances are measured in square units.
 */
export function assignHands(raw: RawHand[], pose: Pt[] | null, aspect: number): AssignedHand[] {
  const hands = raw.slice(0, 2);
  if (hands.length === 0) return [];

  const lw = pose?.[POSE_LEFT_WRIST];
  const rw = pose?.[POSE_RIGHT_WRIST];
  const wristsOk =
    !!lw && !!rw && (lw.v ?? 1) >= MIN_WRIST_VISIBILITY && (rw.v ?? 1) >= MIN_WRIST_VISIBILITY;

  if (wristsOk && lw && rw) {
    if (hands.length === 1) {
      const h = hands[0];
      const side: HandSide = dist(h.pts[0], lw, aspect) <= dist(h.pts[0], rw, aspect) ? 'left' : 'right';
      return [{ side, source: 'pose-wrist', pts: h.pts, mpLabel: h.mpLabel }];
    }
    const [a, b] = hands;
    const keep = dist(a.pts[0], lw, aspect) + dist(b.pts[0], rw, aspect);
    const swap = dist(a.pts[0], rw, aspect) + dist(b.pts[0], lw, aspect);
    const aSide: HandSide = keep <= swap ? 'left' : 'right';
    const bSide: HandSide = aSide === 'left' ? 'right' : 'left';
    return [
      { side: aSide, source: 'pose-wrist', pts: a.pts, mpLabel: a.mpLabel },
      { side: bSide, source: 'pose-wrist', pts: b.pts, mpLabel: b.mpLabel },
    ];
  }

  const sides = hands.map((h) => labelSide(h.mpLabel));
  if (hands.length === 2 && (sides[0] === null || sides[0] === sides[1])) {
    // Same or unknown labels: right hand is the one further left in the image.
    const aIsRight = hands[0].pts[0].x <= hands[1].pts[0].x;
    sides[0] = aIsRight ? 'right' : 'left';
    sides[1] = aIsRight ? 'left' : 'right';
  }
  return hands.map((h, i) => ({
    side: sides[i] ?? (h.pts[0].x < 0.5 ? 'right' : 'left'),
    source: 'mp-label' as const,
    pts: h.pts,
    mpLabel: h.mpLabel,
  }));
}
