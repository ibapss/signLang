import {
  FilesetResolver,
  HandLandmarker,
  HolisticLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import runtime from '../generated/runtime-assets.json';
import { assetUrl, fetchAllWithProgress, type Progress } from '../assets';
import { assignHands } from './hands';
import type { Delegate, DetectorKind, FrameLandmarks, Pt, RawHand } from './types';

export const MEDIAPIPE_VERSION: string = runtime.mediapipeVersion;

export interface LandmarkDetector {
  readonly kind: DetectorKind;
  readonly delegate: Delegate;
  readonly wasmVariant: 'simd' | 'nosimd';
  detect(frame: HTMLVideoElement, t: number): FrameLandmarks;
  close(): void;
}

export interface DetectorOptions {
  kind: DetectorKind;
  /** 'auto' tries GPU first and falls back to CPU. */
  delegate: 'auto' | Delegate;
  onProgress?: (p: Progress) => void;
  onStatus?: (msg: string) => void;
}

type ModelInfo = { path: string; bytes: number };
const models = runtime.models as Record<string, ModelInfo | undefined>;

function toPts(lms: NormalizedLandmark[] | undefined): Pt[] | null {
  if (!lms || lms.length === 0) return null;
  return lms.map((l) => ({ x: l.x, y: l.y, z: l.z, v: l.visibility }));
}

const abs = (p: string) => new URL(assetUrl(p), location.href).href;

/** Bytes that must be downloaded before a detector of this kind can start. */
export function downloadSize(kind: DetectorKind, simd = true): number {
  const w = simd ? runtime.wasm.simd : runtime.wasm.nosimd;
  const m = kind === 'holistic' ? [models.holistic] : [models.hand, models.pose];
  return w.binary.bytes + w.loader.bytes + m.reduce((s, x) => s + (x?.bytes ?? 0), 0);
}

/** Absolute URLs of the runtime files a detector of this kind needs. */
export function runtimeUrls(kind: DetectorKind, variant: 'simd' | 'nosimd'): string[] {
  const w = runtime.wasm[variant];
  const m = kind === 'holistic' ? [models.holistic] : [models.hand, models.pose];
  return [w.loader.path, w.binary.path, ...m.map((x) => x?.path ?? '')].filter(Boolean).map(abs);
}

export function isAvailable(kind: DetectorKind): boolean {
  return kind === 'holistic' ? !!models.holistic : !!models.hand && !!models.pose;
}

/**
 * Create a landmark detector in VIDEO mode. Downloads the WASM and models with
 * progress, then tries the GPU delegate and falls back to CPU.
 */
export async function createDetector(opts: DetectorOptions): Promise<LandmarkDetector> {
  const simd = await FilesetResolver.isSimdSupported();
  const variant = simd ? 'simd' : 'nosimd';
  const w = runtime.wasm[variant];
  const modelInfos: ModelInfo[] =
    opts.kind === 'holistic'
      ? [mustModel('holistic')]
      : [mustModel('hand'), mustModel('pose')];

  opts.onStatus?.('download');
  const [wasmBytes, ...modelBytes] = await fetchAllWithProgress(
    [
      { url: abs(w.binary.path), expectedBytes: w.binary.bytes },
      ...modelInfos.map((m) => ({ url: abs(m.path), expectedBytes: m.bytes })),
    ],
    (p) => opts.onProgress?.(p),
  );

  // Hand the already-downloaded WASM to MediaPipe as a blob URL so it is not fetched twice.
  const wasmBlobUrl = URL.createObjectURL(new Blob([wasmBytes as BlobPart], { type: 'application/wasm' }));
  const fileset = { wasmLoaderPath: abs(w.loader.path), wasmBinaryPath: wasmBlobUrl };

  const order: Delegate[] = opts.delegate === 'auto' ? ['GPU', 'CPU'] : [opts.delegate];
  let lastErr: unknown;
  try {
    for (const delegate of order) {
      try {
        opts.onStatus?.(`init-${delegate}`);
        const det =
          opts.kind === 'holistic'
            ? await createHolistic(fileset, modelBytes[0], delegate, variant)
            : await createHandPose(fileset, modelBytes[0], modelBytes[1], delegate, variant);
        return det;
      } catch (e) {
        lastErr = e;
        console.warn(`MediaPipe ${opts.kind} failed with ${delegate} delegate`, e);
      }
    }
  } finally {
    // Every task has instantiated its module by now (or failed), so the blob can go.
    URL.revokeObjectURL(wasmBlobUrl);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function mustModel(id: string): ModelInfo {
  const m = models[id];
  if (!m) throw new Error(`Model "${id}" is not deployed in this build`);
  return m;
}

type Fileset = { wasmLoaderPath: string; wasmBinaryPath: string };

const HAND_OPTS = {
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

async function createHandPose(
  fileset: Fileset,
  handModel: Uint8Array,
  poseModel: Uint8Array,
  delegate: Delegate,
  wasmVariant: 'simd' | 'nosimd',
): Promise<LandmarkDetector> {
  const hand = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: handModel, delegate },
    runningMode: 'VIDEO',
    ...HAND_OPTS,
  });
  let pose: PoseLandmarker;
  try {
    pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: poseModel, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  } catch (e) {
    hand.close();
    throw e;
  }
  return {
    kind: 'handpose',
    delegate,
    wasmVariant,
    detect(frame, t) {
      const width = frame.videoWidth;
      const height = frame.videoHeight;
      const hr = hand.detectForVideo(frame, t);
      const pr = pose.detectForVideo(frame, t);
      const posePts = toPts(pr.landmarks[0]);
      const raw: RawHand[] = hr.landmarks.map((lms, i) => {
        const cat = hr.handedness[i]?.[0];
        const label = cat?.categoryName === 'Left' || cat?.categoryName === 'Right' ? cat.categoryName : 'Unknown';
        return { pts: toPts(lms) ?? [], mpLabel: label, mpScore: cat?.score ?? 0 };
      });
      const hands = assignHands(raw, posePts, width / Math.max(1, height));
      return {
        t,
        pose: posePts,
        left: hands.find((h) => h.side === 'left')?.pts ?? null,
        right: hands.find((h) => h.side === 'right')?.pts ?? null,
        hands,
        width,
        height,
      };
    },
    close() {
      hand.close();
      pose.close();
    },
  };
}

async function createHolistic(
  fileset: Fileset,
  model: Uint8Array,
  delegate: Delegate,
  wasmVariant: 'simd' | 'nosimd',
): Promise<LandmarkDetector> {
  const holo = await HolisticLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'VIDEO',
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minHandLandmarksConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputPoseSegmentationMasks: false,
  });
  return {
    kind: 'holistic',
    delegate,
    wasmVariant,
    detect(frame, t) {
      const r = holo.detectForVideo(frame, t);
      const pose = toPts(r.poseLandmarks[0]);
      // Holistic assigns hands from the pose; its left/right naming is checked on
      // real devices via the diagnostics panel before we rely on it.
      const left = toPts(r.leftHandLandmarks[0]);
      const right = toPts(r.rightHandLandmarks[0]);
      const hands = [
        ...(left ? [{ side: 'left' as const, source: 'holistic' as const, pts: left, mpLabel: 'Unknown' as const }] : []),
        ...(right ? [{ side: 'right' as const, source: 'holistic' as const, pts: right, mpLabel: 'Unknown' as const }] : []),
      ];
      return { t, pose, left, right, hands, width: frame.videoWidth, height: frame.videoHeight };
    },
    close() {
      holo.close();
    },
  };
}
