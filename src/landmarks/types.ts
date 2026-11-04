/** One landmark in normalized image coordinates of the *unmirrored* camera frame. */
export interface Pt {
  x: number;
  y: number;
  z: number;
  /** Pose only: visibility in [0, 1]. */
  v?: number;
}

/** A hand as reported by the detector, before we decide which side it is. */
export interface RawHand {
  pts: Pt[]; // 21
  /** MediaPipe's handedness label. Documented as assuming a mirrored image; measured as anatomical on unmirrored frames (see hands.ts). */
  mpLabel: 'Left' | 'Right' | 'Unknown';
  mpScore: number;
}

export type HandSide = 'left' | 'right';

/** How a hand's side was decided (shown in diagnostics so it can be checked on real devices). */
export type SideSource = 'pose-wrist' | 'mp-label' | 'holistic';

export interface AssignedHand {
  side: HandSide; // the signer's anatomical side
  source: SideSource;
  pts: Pt[];
  mpLabel: RawHand['mpLabel'];
}

/** Landmarks for one processed video frame. */
export interface FrameLandmarks {
  /** Monotonic timestamp in ms (performance.now()). */
  t: number;
  /** 33 pose landmarks, or null if no person. */
  pose: Pt[] | null;
  /** Signer's anatomical left / right hand (21 points each), or null if missing. */
  left: Pt[] | null;
  right: Pt[] | null;
  hands: AssignedHand[];
  /** Frame size in pixels the coordinates refer to. */
  width: number;
  height: number;
}

export type DetectorKind = 'handpose' | 'holistic';
export type Delegate = 'GPU' | 'CPU';
