# PROGRESS

State, decisions and next steps, so a new session can pick up the work.
Conventions and commands are in `CLAUDE.md`.

Last updated: 2026-11-04. Milestones 1–2 merged to `main` ([PR 1](https://github.com/ibapss/signLang/pull/1)) and deployed. Working branch: `claude/bold-bell-rer7wc`.

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Inspect datasets, `docs/DATASETS.md`, first vocabulary | **Done, partly blocked:** only the PSL dictionary is reachable; Hugging Face, Mendeley and Kaggle are blocked by the network policy |
| 2 | Camera, landmark overlay, diagnostics, Pages deployment | **Deployed** to https://ibapss.github.io/signLang/. First real phone tested (below). **Speed on low-end phones is the open problem.** |
| 3 | Feature spec, parity tests, training, first model, evaluation | **Infrastructure done:** `docs/FEATURES.md` (psl-f1), Python/TS parity in CI, `training/` pipeline (tested on synthetic data only). **No model yet: no real training data** (public datasets blocked; waiting for Collect recordings) |
| 4 | Recognition, translation, full UI, Collect and Test pages | **Collect page done early** (only unblocked data source); `src/data/signs.json` created. Recognition, translation and the Test page are not started |
| 5 | Retrain with our recordings, tune, drop weak signs | Not started |
| 6 | Offline polish, Spelling mode, Urdu polish, accessibility, README | Not started (offline already works for landmarks) |

## What works (verified, and how)

- **Landmarks in the browser**, in headless Chromium 153 with a fake camera playing a
  real PSL signer clip (CC BY 4.0), CPU delegate, at Pixel 7 and 1280×800 viewports.
  Playwright asserts that hands and pose are detected and drawn
  (`e2e/translate.spec.ts`).
- **Serving under `/signLang/`** with a Pages-like static server (no SPA fallback).
  Every e2e test fails on any 404.
- **Offline reload:** after the first Start, going offline, reloading and starting
  again still tracks hands (`works offline after the first load`).
- **First-visit download:** 28.1 MB in total, each runtime file downloaded once
  (`e2e/download-budget.spec.ts`, server-side byte count).
- **GPU→CPU fallback:** in headless Chromium the GPU delegate initializes but runs
  on a software renderer at about 5,500 ms/frame. Auto mode measured that and
  switched to CPU (183 ms/frame) within about 5 s. A GPU error at run time also
  falls back to CPU.
- **Urdu interface:** `dir="rtl"`, mirrored layout, self-hosted Noto Nastaliq Urdu
  confirmed loaded via `document.fonts.check`. Screenshots show no glyph clipping
  at line-height 2.3–2.5 (`urdu-ui.png` and `translate.png` in the Playwright
  report artifact).
- Unit tests: 30 (Vitest). CI run 41861467283 on this branch: unit tests, build and 14 e2e tests passed (3 skipped by design), including the **WebKit 26.6 smoke test**.

## Real-device results

### Device 1: Android 10 phone, Chrome 156 (model not reported yet), 2026-11-04
Diagnostics reported by the user, Holistic pipeline, front camera, 480×640 portrait:
- The auto delegate worked as designed: GPU measured **3,015 ms/frame**, CPU
  **363 ms/frame**, so it settled on CPU. Steady state was **305 ms/frame,
  about 3 fps**, which is far too slow for recognition (target: 10 fps or more).
- WASM SIMD loaded, WebGL2 present, not an in-app browser, no errors.
- The user confirmed that hand lines appear and that the **R/L labels are
  correct** for the anatomical hand on the front camera.
- Pending: the same diagnostics with "Hands + Pose (lite)", the phone model, and a back-camera check.

## Focus (user decision, 2026-11-04)

Laptop/desktop first; phone performance later.

## Milestone 3 infrastructure (2026-11-04)

- `docs/FEATURES.md`: 137 features per frame, resampled by time to 32×137 over 1.6 s.
  Hand shape is wrist-relative; hand position comes from the pose wrists (robust
  if a dataset stores hands wrist-relative); missing hands are encoded explicitly;
  left-handed signers are mirrored per signer.
- Parity: `tests/golden/features-psl-f1.json` holds 8 cases from REAL landmarks
  (browser pipeline on the fixture clip, PSL dictionary HELP) plus labelled
  synthetic edge cases. TypeScript (Vitest) and Python (pytest) both match to
  within 1e-5, and CI runs both.
- `training/pipeline.py all`: prepare, train (resumable), evaluate (writes
  `docs/EVALUATION.md`, tunes thresholds on validation), export (ONNX + sidecar,
  checked against ONNX Runtime). Verified end to end only on SYNTHETIC
  recordings inside `training/tests`. No real model exists yet.
- Collect page (`#/collect`): consent, anonymous code, handedness, PSL level,
  24 signs × N reps plus about 15% "none" prompts (rest / fidget / between),
  3-2-1 countdown, 2.5 s takes, a hand-visibility check, and download of a
  `psl-collect-v1` file (`training/import_collected.py`). e2e-tested with the
  fake camera.
- The VM uses `torch==2.14.1` from PyPI (the CUDA build, 5.5 GB venv), because
  `download.pytorch.org` is blocked. CPU training works.

## Not verified yet

- **Real devices other than device 1:** iOS Safari, laptop browsers, the back
  camera, rotation, a fast real GPU delegate, in-app browsers, the iOS
  permission flow. All untested; see `docs/DEVICE_CHECKLIST.md`.
- WebKit: only a page-load smoke test, which passes in CI (Playwright has no fake camera for WebKit).
- Firefox: not run anywhere yet.
- The "update available" prompt: wired (`registerType: 'prompt'`) but not exercised by a test.

## Decisions (with evidence)

1. **Landmarks: HolisticLandmarker is the default; HandLandmarker + PoseLandmarker lite is selectable.**
   Measured in headless Chromium (CPU, software rendering, this VM, 20 s on the
   fixture clip, `scripts/bench-landmarks.mjs`):

   | Pipeline | Landmark ms | Frames with any hand | Frames with both hands | Download |
   |---|---|---|---|---|
   | Hands + Pose lite | 170 | 60% | 39% | 13.6 MB models |
   | Holistic | 158 | 76% | 52% | 13.7 MB model |

   Holistic was as fast, found hands more often, needs one WASM instance instead
   of two, and matches the extractor the brief says the Hugging Face data used
   (MediaPipe Holistic, legacy 0.8). **This VM is not a phone.** Real-phone
   diagnostics for both pipelines decide this for good.
2. **Left/right convention, measured.** On unmirrored frames, with tasks-vision 1.1.1:
   - Pose `LEFT_WRIST` (15) and `RIGHT_WRIST` (16) are anatomical. Checked against
     the clip's shirt pocket and wristwatch: mean x of landmark 16 is 0.35,
     where the signer's right hand is.
   - HolisticLandmarker's `leftHandLandmarks` is the anatomical left hand: 179/179 hands matched the same-named pose wrist.
   - HandLandmarker's handedness label is **anatomical too: 183/187 agree.**
     That is the opposite of MediaPipe's docs, which say the label assumes a
     mirrored image. Code uses pose wrists first and the label as a fallback
     (`src/landmarks/hands.ts`, `MP_LABEL_IS_ANATOMICAL`).
     `e2e/handedness.spec.ts` re-checks all of this in CI.
   - The PSL dictionary data uses the same convention: block order
     pose/left/right, unmirrored video.
   - Still needed: the front/back camera check on real phones (checklist §2).
     Left-handed signers will be handled in the feature spec (milestone 3).
     The plan is to mirror a left-dominant signer's landmarks into right-dominant
     form, decided by the signer and never per frame.
3. **Big runtime files are cached on first use, not precached.** Precaching
   downloaded them twice on a first visit (55.3 MB measured): browsers don't
   reliably keep 13 MB entries in the HTTP cache, so Workbox fetched them again.
   Now the service worker precaches only the app shell (0.5 MB) and claims the
   page; the page waits for SW control (up to 4 s) and downloads WASM + models
   through it with a progress bar; a `CacheFirst` route keeps them. Files have
   content-hashed names (`rt/<name>.<sha10>.<ext>`), so a new model means a new
   URL and a new service worker, which triggers the update prompt. "Ready to
   work offline" is shown only after the files are confirmed in Cache Storage.
4. **WASM:** only the SIMD and no-SIMD classic builds are staged. The page passes
   the downloaded WASM to MediaPipe as a blob URL, so progress is shown and
   nothing is fetched twice.
5. **Landmark detection stays on the main thread** for now. MediaPipe 1.1.1 ships
   a separate `vision_wasm_module_internal` build (ES-module loader), which may
   make a module worker viable. This has not been tested; revisit in milestone 4
   if main-thread time hurts on phones. The classifier will run in a Web Worker
   regardless.
6. **Dependencies** (exact pins, each at least two weeks old at install time):
   `@mediapipe/tasks-vision` 1.1.1, vite 8.3.4, vite-plugin-pwa 2.0.0,
   vitest 5.0.5, typescript 5.9.3, `@playwright/test` 1.63.0 (matches the VM's
   preinstalled Chromium). `npm audit` reports moderate advisories in
   build-only Workbox dependencies (glob, minimatch, deepmerge); nothing that
   ships to users.

## Blockers and what I need

- **Datasets.** Allow these domains in the environment's network settings, or
  upload the files:
  `huggingface.co`, `cdn-lfs.huggingface.co`, `cdn-lfs.hf.co`, `cas-bridge.xethub.hf.co`
  (Hugging Face); `data.mendeley.com` (UAlpha40); `www.kaggle.com` plus an API
  token (or upload the zip). Details in `docs/DATASETS.md`.
- **Real-device results** from `docs/DEVICE_CHECKLIST.md`.
- **License** for this repo's own code: not chosen. Tell me which you want.

## Next steps

1. **Phone speed.** Get Hands + Pose (lite) numbers from device 1. If it is
   clearly faster, make it the default (possibly per device class). Other
   options to measure: hands only with pose every Nth frame, and the
   ES-module WASM build in a worker. Recognition needs about 10 fps on
   phones like device 1.
2. **Data.** Recordings from the Collect page on a laptop: at least 3 signers
   (ideally Deaf PSL signers), 5+ reps per sign. Then
   `training.import_collected` → `training.pipeline all` → the first real model.
   If Hugging Face becomes reachable, run the checks in `docs/DATASETS.md` §2
   and add a loader in `training/psl/sources.py` (check that `psl-f1` fits its
   normalization).
3. Browser inference: an onnxruntime-web Web Worker that loads
   `public/models/classifier.json`, refuses a feature-version mismatch, and adds
   smoothing/segmentation (thresholds from the sidecar), phrases and the Test page.

## CI

`.github/workflows/deploy.yml`: on push to `main` (test + deploy), pushes to
`claude/**` (test only), pull requests, and manual dispatch. It runs unit tests,
the Urdu table freshness check, the build, then Playwright (Chromium phone and
desktop with a fake camera, plus the WebKit smoke test).
