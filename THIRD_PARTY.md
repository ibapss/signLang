# Third-party material

Everything below is downloaded or bundled at build time and served from this
site. Nothing is loaded from a CDN at run time.

## Runtime (shipped to users)

| Component | Version | License | Source |
|---|---|---|---|
| MediaPipe Tasks Vision (JS + WASM) | 1.1.1 (pinned) | Apache-2.0 | npm `@mediapipe/tasks-vision`; WASM copied from `node_modules` by `scripts/stage-runtime.mjs` |
| MediaPipe Holistic Landmarker model | `holistic_landmarker/float16/1` | Apache-2.0 | `storage.googleapis.com/mediapipe-models/…` (SHA-256 pinned in `scripts/models.json`) |
| MediaPipe Hand Landmarker model | `hand_landmarker/float16/1` | Apache-2.0 | same |
| MediaPipe Pose Landmarker (lite) model | `pose_landmarker_lite/float16/1` | Apache-2.0 | same |
| Noto Nastaliq Urdu font | via `@fontsource/noto-nastaliq-urdu` 5.2.8 | SIL Open Font License 1.1 | © 2022 The Noto Project Authors, <https://github.com/notofonts/nastaliq> |
| Workbox (service worker, via vite-plugin-pwa) | 7.x | MIT | npm |

Model cards for the MediaPipe models: <https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker>,
<https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker>,
<https://ai.google.dev/edge/mediapipe/solutions/vision/holistic_landmarker>.

## Data

| Dataset | Use | License | Attribution |
|---|---|---|---|
| PSL dictionary (`sign-language-translator/sign-language-datasets`, recordings from the Hamza Foundation Academy for the Deaf, Lahore) | Vocabulary selection; the end-to-end test clip `e2e/fixtures/signer.mjpeg` (re-encoded from three dictionary videos: `help`, `good`, `house`) | CC BY 4.0 | Sign Language Translator project, <https://github.com/sign-language-translator/sign-language-datasets>. Changes: concatenated, resampled to 15 fps, re-encoded as MJPEG. |

Datasets that are planned but not yet used (see `docs/DATASETS.md`) will be
listed here with their licenses once inspected: Hugging Face
`Bakhtyar12/Pakistani-Sign-Language`, UAlpha40 (Mendeley Data
10.17632/3pvnnckxyb.3), and the Pakistan Sign Language Dataset (Kaggle).

## Build and test tools (not shipped)

Vite, vite-plugin-pwa, TypeScript, Vitest, Playwright, and `@types/node`, all
under their own open-source licenses (MIT or Apache-2.0).
