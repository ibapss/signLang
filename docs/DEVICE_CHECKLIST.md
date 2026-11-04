# Real-device checklist (milestone 2)

This build tests the risky infrastructure only: camera, hand tracking, overlay,
diagnostics, offline use and deployment. **There is no sign recognition yet.**
The output panels show a fixed placeholder sentence.

Run this on **Android Chrome**, **iOS Safari** and **a laptop** (any of Chrome,
Edge, Firefox or Safari). A mid-range Android phone matters most.

Open: `https://ibapss.github.io/signLang/` (live once the branch is merged to
`main` and Pages is set to "GitHub Actions"; see PROGRESS.md).

## For each device

1. **First load**
   - [ ] The page loads and shows "Start camera" and the privacy notice.
   - [ ] Tap **Start camera**. The browser asks for camera permission (iOS: the prompt appears only after the tap).
   - [ ] A progress bar shows "Downloading models: x of 27.2 MB" and fills up.
   - [ ] Your camera image appears, mirrored like a mirror on the front camera.
2. **Landmarks**
   - [ ] Lines appear on your shoulders and arms, and on both hands when visible.
   - [ ] **Raise only your RIGHT hand.** The label at the wrist reads **R** (orange). Then your LEFT hand: **L** (blue).
   - [ ] Switch to the **back camera** (if the phone has one) and point it at another person. Ask them to raise their right hand. It should read **R**.
   - [ ] Move your hands quickly: the overlay keeps up without long freezes.
3. **Diagnostics** (tap "Diagnostics" under the output panels)
   - [ ] Tap **Copy diagnostics** and paste the text into a message to me. I need: `fps`, `landmarkMs`, `delegate`, `delegateChoice`, `wasm`, `hands`, `mpLabelMatchesPose`, `userAgent`.
   - [ ] Switch **Landmarks** to "Hands + Pose (lite)", wait about 10 s, and copy the diagnostics again. This is the speed comparison between the two pipelines.
   - [ ] Optional: set **Delegate** to GPU, then CPU, and copy diagnostics for each.
4. **Hints**
   - [ ] Put both hands down or out of the frame: after about 2 s, "Hands not visible" appears.
   - [ ] Walk out of view: "No one in view" appears.
   - [ ] Cover the lens or turn off the light: "The picture is too dark" appears.
5. **Interface**
   - [ ] Tap **اردو**: the interface switches to Urdu, the layout mirrors right-to-left, and the Nastaliq text is not clipped at the top or bottom. Tap **English** to switch back.
   - [ ] Rotate the phone: the video and overlay stay aligned.
   - [ ] Switch to another app or tab for a few seconds, then come back: the camera light turns off while away, and tracking resumes on return.
6. **Offline**
   - [ ] After the camera has worked once, a "Ready to work offline" banner appears.
   - [ ] Turn on airplane mode, reload the page, and tap **Start camera**: tracking works with no network.
   - [ ] Optional: "Add to Home Screen" / "Install app", then open it from the icon while offline.
7. **Error messages** (whichever you can try)
   - [ ] Deny camera permission: a clear message explains how to allow it.
   - [ ] Open the link from inside WhatsApp, Instagram or Facebook: either the camera works, or a message says to open it in Chrome or Safari. Tell me which app and what happened.

## What to send back

For each device: model, OS version, browser, the copied diagnostics JSON for both
pipelines, and any checklist item that failed (a screenshot helps, especially for
Urdu text or overlay alignment).
