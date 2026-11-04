# Model input specification: feature version `psl-f1`

This file is the **single definition** of what the classifier sees. It is
implemented twice: `src/features/` (TypeScript, in the browser) and
`training/psl/features.py` (Python, for training). The golden vectors in
`tests/golden/` must give the same output from both within `1e-5`, and CI checks
this on every push. Change anything here and you must bump the version, update
both implementations and regenerate the golden file. Exported models carry the
version, and the app refuses a model whose version differs.

## 1. Raw frame (input to the feature function)

One record per processed camera frame, called a *raw frame*. The same JSON
shape is used by the Collect page export, the training importers and the
golden tests.

```json
{
  "t": 1234.5,
  "aspect": 1.3333,
  "pose":  [[x, y, z], ... 33] | null,
  "left":  [[x, y, z], ... 21] | null,
  "right": [[x, y, z], ... 21] | null
}
```

- `t`: timestamp in milliseconds, strictly increasing within a recording.
- `aspect`: frame width ÷ height of the image the landmarks came from.
- `x`, `y`: MediaPipe *normalized image coordinates* of the **raw, unmirrored
  camera frame**: x across the width, y down the height, both 0–1 inside the
  image. `z`: MediaPipe's relative depth, as reported.
- `pose`: the 33 MediaPipe pose landmarks. Visibility is **not** used; not every source has it.
- `left` / `right`: the **signer's anatomical** left and right hand, 21 MediaPipe
  hand landmarks each, or `null` when that hand was not detected. A missing
  hand is `null`. All-zero blocks in source datasets are converted to `null` on
  import.

### Left and right

- The browser decides the sides from pose wrists first, then from MediaPipe's
  label. Both conventions were measured to be anatomical on unmirrored frames
  (`PROGRESS.md`, decision 2; checked in CI by `e2e/handedness.spec.ts`;
  confirmed on a real Android phone).
- The front-camera preview is mirrored **for display only** (CSS). Landmarks
  always come from the raw frame, so the input does not change when the user
  switches cameras.

## 2. Per-frame features (137 values)

Let `A = aspect`. First convert every point to square units, so distances do
not depend on the frame shape: `P = (x·A, y, z·A)`. MediaPipe scales z
roughly like x.

### Body frame
- `O` = midpoint of pose 11 (left shoulder) and 12 (right shoulder), x and y only.
- `S` = 2D distance between pose 11 and 12. If `S < 1e-6`, the pose counts as missing.
- `body(p) = ((p.x − O.x) / S, (p.y − O.y) / S)`.

If the pose is missing in a frame, use the body frame `(O, S)` of the
**nearest earlier frame with a pose in the same recording**. If there is none,
use the nearest later one. If the recording has no pose at all, every
body-frame feature is `0` and the `pose_present` flag is `0`.

### Layout

| Index | Count | Feature |
|---|---|---|
| 0–59 | 60 | Left-hand shape: landmarks 1–20, each `(P_i − P_0) / H` for x, y, z, where `H` = 2D distance from wrist (0) to middle-finger MCP (9), with `H = 1e-6` if smaller |
| 60–61 | 2 | Left-hand position: `body(pose[15])` (left wrist **from the pose**, not the hand model) |
| 62 | 1 | Left hand present: `1` or `0` |
| 63–122 | 60 | Right-hand shape, same rule |
| 123–124 | 2 | Right-hand position: `body(pose[16])` |
| 125 | 1 | Right hand present |
| 126–133 | 8 | `body()` of pose 13, 14, 15, 16 (left elbow, right elbow, left wrist, right wrist), x then y |
| 134–135 | 2 | `body(pose[0])` (nose) |
| 136 | 1 | Pose present in this frame (`1` or `0`) |

- **Missing hand:** shape (60 values) and position (2 values) are `0`, and the present flag is `0`.
- **Missing pose but present hand:** the position comes from the carried-over
  body frame, but pose 15/16 are not available. Use the hand's own wrist (hand
  landmark 0) in `body()` instead. If there is no body frame at all, use `0`.
- Hand position comes from the **pose** wrist on purpose. Some datasets store
  hands relative to their own wrist (keypoint 0 = 0), which loses absolute hand
  position. The pose wrist survives that. To be checked against the Hugging
  Face arrays once they are reachable (`docs/DATASETS.md` §2).

## 3. Left-handed signers (mirroring)

The model is trained on **right-dominant** form. A left-handed signer turns on
"I sign left-handed" in Settings, and the app mirrors the whole recording
(never per frame, never guessed) before the features are computed:

- `x → 1 − x` for every pose and hand point;
- swap `left` ↔ `right` hands;
- swap the pose's left/right landmark pairs (1↔4, 2↔5, 3↔6, 7↔8, 9↔10,
  11↔12, 13↔14, 15↔16, 17↔18, 19↔20, 21↔22, 23↔24, 25↔26, 27↔28, 29↔30, 31↔32).

Both implementations provide `mirrorFrame()`. In training, recordings from
signers marked left-handed in the metadata are mirrored the same way, so the
whole training set is in right-dominant form. Mirroring is not used as random
augmentation: that would teach the model both forms and blur signs whose
meaning depends on which hand leads.

## 4. Time base: resampling a window

Phones and laptops process frames at different, uneven rates. A plain "last N
frames" window would stretch every sign on a slow device, so:

- A **window** covers the last `W = 1600 ms` ending at time `t_end`.
- It is resampled to `T = 32` evenly spaced times
  `t_k = t_end − W + k · W/(T−1)`, for `k = 0 … T−1`.
- For each `t_k`, take the frames just before (`a`) and just after (`b`):
  - Before the first frame: use the first frame. After the last: use the last.
  - The three present flags (62, 125, 136) come from the **nearer** frame, ties going to `a`.
  - For each hand block (shape + position) and the pose block (126–135): if the
    nearer frame's flag for that block is `0`, the block is `0`. If both frames
    have the block, interpolate linearly by time. If only one has it, copy that
    frame's values.
- Output: a `T × 137` matrix, row-major (`[k][feature]`), float32.

Training samples of fixed length without timestamps (for example 30-frame
arrays) get timestamps from the dataset's frame rate, recorded per source in
`training/psl/sources.py`. The window then ends at the last frame.

`W` and `T` are provisional. They will be tuned once real sign durations from
the training data are known. Any change bumps the version.

## 5. Model contract

An exported model (`public/models/classifier.<hash>.onnx`) comes with a JSON
sidecar:

```json
{ "feature_version": "psl-f1", "T": 32, "window_ms": 1600, "feature_dim": 137,
  "labels": ["none", "HELP", ...], "trained_on": "...", "metrics": { ... } }
```

The app compares `feature_version`, `T`, `window_ms` and `feature_dim` with its
own constants and **refuses to load** a model that does not match. The input
tensor is `[1, T, 137]` float32 named `x`; the output is `[1, n_labels]` logits named `logits`.
