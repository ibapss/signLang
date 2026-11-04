# PROGRESS

State, decisions and next steps, so a new session can pick up the work.
Conventions and commands are in `CLAUDE.md`.

Last updated: 2026-11-04. Branch: `claude/bold-bell-rer7wc`.

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Inspect datasets, `docs/DATASETS.md`, first vocabulary | **Done, partly blocked:** only the PSL dictionary is reachable; Hugging Face, Mendeley and Kaggle are blocked by the network policy |
| 2 | Camera, landmark overlay, diagnostics, Pages deployment | **Done in emulation, waiting for the real-device checklist** (`docs/DEVICE_CHECKLIST.md`) |
| 3 | Feature spec, parity tests, training, first model, evaluation | Not started. **Blocked on training data** (needs the Hugging Face dataset at minimum) |
| 4 | Recognition, translation, full UI, Collect and Test pages | Not started |
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

## Not verified yet

- **Every real device:** Android Chrome, iOS Safari, laptop browsers, front and
  back cameras, rotation, real GPU delegates, in-app browsers, iOS permission
  flow. All of that is untested; see `docs/DEVICE_CHECKLIST.md`.
- WebKit: only a page-load smoke test, which passes in CI (Playwright has no fake camera for WebKit).
- Firefox: not run anywhere yet.
- The "update available" prompt: wired (`registerType: 'prompt'`) but not exercised by a test.
- The Pages deployment itself: the workflow deploys only from `main`. Nothing is deployed yet.

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
- **Pages setup:** Settings → Pages → Source: "GitHub Actions". Then merge the branch into `main`.
- **License** for this repo's own code: not chosen. Tell me which you want.

## Next steps

1. Merge milestone 2 and run the device checklist. Adjust the pipeline default,
   delegate thresholds and hints from the numbers.
2. As soon as Hugging Face is reachable, run the dataset checks listed in
   `docs/DATASETS.md` §2, then write `docs/FEATURES.md` (match the dataset's
   normalization if it rules out the preferred format).
3. Milestone 3: Python/TypeScript feature parity with golden vectors, `training/`
   pipeline (prepare/train/evaluate/export, resumable, CPU-friendly), the first
   model, and `docs/EVALUATION.md`.

## CI

`.github/workflows/deploy.yml`: on push to `main` (test + deploy), pushes to
`claude/**` (test only), pull requests, and manual dispatch. It runs unit tests,
the Urdu table freshness check, the build, then Playwright (Chromium phone and
desktop with a fake camera, plus the WebKit smoke test).
