import type { RawFrame } from '../features/features';

export type NoneKind = 'rest' | 'fidget' | 'between';
export interface Prompt {
  /** Gloss (e.g. "HELP") or "none". */
  label: string;
  kind: 'sign' | 'none';
  noneKind?: NoneKind;
}

/** Small seeded PRNG (mulberry32) so a session's order is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a shuffled list: `reps` takes of every gloss plus "none" takes making up
 * about `noneShare` of the total (cycling rest / fidget / between). The same
 * sign never appears twice in a row when that can be avoided, so takes are not
 * just copies of the previous one.
 */
export function buildPlan(glosses: string[], reps: number, seed: number, noneShare = 0.15): Prompt[] {
  const rand = rng(seed);
  const items: Prompt[] = [];
  for (let r = 0; r < reps; r++) for (const g of glosses) items.push({ label: g, kind: 'sign' });
  const nNone = Math.max(3, Math.round((items.length * noneShare) / (1 - noneShare)));
  const kinds: NoneKind[] = ['rest', 'fidget', 'between'];
  for (let i = 0; i < nNone; i++) items.push({ label: 'none', kind: 'none', noneKind: kinds[i % 3] });
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  for (let i = 1; i < items.length; i++) {
    if (items[i].label !== items[i - 1].label || items[i].kind === 'none') continue;
    const k = items.findIndex((x, idx) => idx > i && x.label !== items[i].label && (idx + 1 >= items.length || items[idx + 1].label !== items[i].label) && items[idx - 1].label !== items[i].label);
    if (k > 0) [items[i], items[k]] = [items[k], items[i]];
  }
  return items;
}

export interface Take {
  id: string;
  prompt: Prompt;
  /** Recording window on the frame clock (ms). */
  startT: number;
  endT: number;
  frames: RawFrame[];
}

export interface TakeQuality {
  frames: number;
  handFraction: number;
  fps: number;
  ok: boolean;
}

/** Sign takes need hands in at least half the frames; "none" takes need only frames. */
export function takeQuality(take: Pick<Take, 'frames' | 'prompt' | 'startT' | 'endT'>): TakeQuality {
  const n = take.frames.length;
  const withHands = take.frames.filter((f) => f.left || f.right).length;
  const handFraction = n ? withHands / n : 0;
  const fps = n > 1 ? ((n - 1) * 1000) / Math.max(1, take.frames[n - 1].t - take.frames[0].t) : 0;
  const ok = n >= 5 && (take.prompt.kind === 'none' || handFraction >= 0.5);
  return { frames: n, handFraction, fps, ok };
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const roundPts = (pts: [number, number, number][] | null) => (pts ? pts.map((p) => p.map(r5) as [number, number, number]) : null);

export interface SignerInfo {
  code: string;
  handedness: 'right' | 'left';
  psl: 'deaf' | 'fluent' | 'learner';
}

export interface ExportMeta {
  appVersion: string;
  featureVersion: string;
  mediapipe: string;
  detector: string;
  delegate: string | null;
  camera: string;
  consentText: string;
  consentAt: string;
  sessionId: string;
}

/** The file format read by training/import_collected.py ("psl-collect-v1"). */
export function exportSession(signer: SignerInfo, meta: ExportMeta, takes: Take[]) {
  return {
    format: 'psl-collect-v1',
    raw_frame_spec: 'docs/FEATURES.md §1',
    feature_version: meta.featureVersion,
    app_version: meta.appVersion,
    mediapipe: meta.mediapipe,
    detector: meta.detector,
    delegate: meta.delegate,
    session: { id: meta.sessionId, camera: meta.camera },
    signer,
    consent: { text: meta.consentText, agreed: true, at: meta.consentAt },
    takes: takes.map((tk) => ({
      id: tk.id,
      label: tk.prompt.label,
      kind: tk.prompt.kind,
      none_kind: tk.prompt.noneKind ?? null,
      start_t: r5(tk.startT),
      end_t: r5(tk.endT),
      frames: tk.frames.map((f) => ({ t: r5(f.t), aspect: r5(f.aspect), pose: roundPts(f.pose), left: roundPts(f.left), right: roundPts(f.right) })),
    })),
  };
}

/** Random anonymous code like "S-7K3Q" (no 0/O/1/I to avoid misreading). */
export function randomSignerCode(rand: () => number = Math.random): string {
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = 'S-';
  for (let i = 0; i < 4; i++) s += abc[Math.floor(rand() * abc.length)];
  return s;
}
