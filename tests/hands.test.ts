import { describe, expect, it } from 'vitest';
import { assignHands, POSE_LEFT_WRIST, POSE_RIGHT_WRIST } from '../src/landmarks/hands';
import type { Pt, RawHand } from '../src/landmarks/types';

// SYNTHETIC landmarks for unit tests only: hand-placed points, not real data.
function syntheticHand(wristX: number, wristY: number, label: RawHand['mpLabel']): RawHand {
  const pts: Pt[] = Array.from({ length: 21 }, (_, i) => ({ x: wristX, y: wristY - i * 0.005, z: 0 }));
  return { pts, mpLabel: label, mpScore: 0.9 };
}
function syntheticPose(leftWristX: number, rightWristX: number, vis = 0.9): Pt[] {
  const pose: Pt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v: vis }));
  pose[POSE_LEFT_WRIST] = { x: leftWristX, y: 0.6, z: 0, v: vis };
  pose[POSE_RIGHT_WRIST] = { x: rightWristX, y: 0.6, z: 0, v: vis };
  return pose;
}

describe('assignHands (synthetic landmarks)', () => {
  it('returns nothing for no hands', () => {
    expect(assignHands([], syntheticPose(0.7, 0.3), 4 / 3)).toEqual([]);
  });

  it('matches two hands to the nearest pose wrists, ignoring MediaPipe labels', () => {
    // Unmirrored frame: signer's right wrist on the image's left (x=0.3).
    const a = syntheticHand(0.31, 0.6, 'Left'); // deliberately "wrong" labels
    const b = syntheticHand(0.69, 0.6, 'Right');
    const out = assignHands([a, b], syntheticPose(0.7, 0.3), 4 / 3);
    expect(out.map((h) => [h.side, h.source])).toEqual([
      ['right', 'pose-wrist'],
      ['left', 'pose-wrist'],
    ]);
  });

  it('handles crossed hands by minimizing total distance', () => {
    const a = syntheticHand(0.66, 0.6, 'Unknown');
    const b = syntheticHand(0.33, 0.6, 'Unknown');
    const out = assignHands([a, b], syntheticPose(0.7, 0.3), 4 / 3);
    expect(out[0].side).toBe('left');
    expect(out[1].side).toBe('right');
  });

  it('assigns a single hand to the nearer wrist', () => {
    const out = assignHands([syntheticHand(0.28, 0.62, 'Left')], syntheticPose(0.7, 0.3), 4 / 3);
    expect(out).toHaveLength(1);
    expect(out[0].side).toBe('right');
  });

  it('falls back to the MediaPipe label (anatomical) when pose wrists are not visible', () => {
    const out = assignHands([syntheticHand(0.3, 0.6, 'Right')], syntheticPose(0.7, 0.3, 0.05), 4 / 3);
    expect(out[0]).toMatchObject({ side: 'right', source: 'mp-label' });
  });

  it('falls back to the label with no pose at all', () => {
    const out = assignHands([syntheticHand(0.8, 0.6, 'Left')], null, 4 / 3);
    expect(out[0]).toMatchObject({ side: 'left', source: 'mp-label' });
  });

  it('breaks ties between identical labels by image position', () => {
    const a = syntheticHand(0.7, 0.6, 'Left');
    const b = syntheticHand(0.3, 0.6, 'Left');
    const out = assignHands([a, b], null, 4 / 3);
    expect(out.map((h) => h.side)).toEqual(['left', 'right']);
  });

  it('never returns more than two hands', () => {
    const hs = [syntheticHand(0.2, 0.6, 'Left'), syntheticHand(0.5, 0.6, 'Right'), syntheticHand(0.8, 0.6, 'Left')];
    expect(assignHands(hs, null, 1).length).toBe(2);
  });
});
