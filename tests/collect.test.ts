import { describe, expect, it } from 'vitest';
import { buildPlan, exportSession, randomSignerCode, takeQuality } from '../src/collect/plan';
import type { RawFrame } from '../src/features/features';

// SYNTHETIC frames for unit tests only.
const synthFrame = (t: number, hand: boolean): RawFrame => ({
  t,
  aspect: 4 / 3,
  pose: null,
  left: null,
  right: hand ? Array.from({ length: 21 }, () => [0.4, 0.5, 0] as [number, number, number]) : null,
});

describe('buildPlan', () => {
  const g = ['A', 'B', 'C', 'D'];
  it('has every sign reps times plus about 15% none prompts', () => {
    const p = buildPlan(g, 5, 42);
    expect(p.filter((x) => x.label === 'A').length).toBe(5);
    const none = p.filter((x) => x.kind === 'none');
    expect(none.length).toBeGreaterThanOrEqual(3);
    expect(none.length / p.length).toBeCloseTo(0.15, 1);
    expect(new Set(none.map((x) => x.noneKind))).toEqual(new Set(['rest', 'fidget', 'between']));
  });
  it('is reproducible from the seed and avoids back-to-back repeats', () => {
    expect(buildPlan(g, 5, 7)).toEqual(buildPlan(g, 5, 7));
    const p = buildPlan(g, 5, 7);
    let repeats = 0;
    for (let i = 1; i < p.length; i++) if (p[i].kind === 'sign' && p[i].label === p[i - 1].label) repeats++;
    expect(repeats).toBe(0);
  });
});

describe('takeQuality', () => {
  it('rejects sign takes without hands, accepts none takes', () => {
    const frames = Array.from({ length: 20 }, (_, i) => synthFrame(i * 40, false));
    expect(takeQuality({ frames, prompt: { label: 'A', kind: 'sign' }, startT: 0, endT: 800 }).ok).toBe(false);
    expect(takeQuality({ frames, prompt: { label: 'none', kind: 'none' }, startT: 0, endT: 800 }).ok).toBe(true);
    const good = Array.from({ length: 20 }, (_, i) => synthFrame(i * 40, i > 5));
    const q = takeQuality({ frames: good, prompt: { label: 'A', kind: 'sign' }, startT: 0, endT: 800 });
    expect(q.ok).toBe(true);
    expect(q.fps).toBeCloseTo(25, 0);
  });
});

describe('exportSession', () => {
  it('writes the psl-collect-v1 format', () => {
    const out = exportSession(
      { code: 'S-ABCD', handedness: 'right', psl: 'deaf' },
      { appVersion: 't', featureVersion: 'psl-f1', mediapipe: '1.1.1', detector: 'holistic', delegate: 'CPU', camera: 'user', consentText: 'x', consentAt: '2026-01-01', sessionId: 's1' },
      [{ id: 't1', prompt: { label: 'A', kind: 'sign' }, startT: 0, endT: 100, frames: [synthFrame(0.123456789, true)] }],
    );
    expect(out.format).toBe('psl-collect-v1');
    expect(out.takes[0].frames[0].t).toBe(0.12346);
    expect(out.takes[0].label).toBe('A');
    expect(JSON.stringify(out)).not.toMatch(/video|image/i);
  });
  it('signer codes look like S-XXXX', () => {
    expect(randomSignerCode()).toMatch(/^S-[2-9A-HJ-NP-Z]{4}$/);
  });
});
