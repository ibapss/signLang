import { Camera } from '../camera';
import { classifyCameraError, type Capabilities } from '../env';
import { formatMB } from '../assets';
import { applyI18n, t } from '../i18n';
import { chooseHint, meanLuma, type HintKey } from '../hints';
import { createDetector, downloadSize, isAvailable, MEDIAPIPE_VERSION, runtimeUrls, type LandmarkDetector } from '../landmarks/detector';
import type { FrameLandmarks } from '../landmarks/types';
import { FpsMeter, MonotonicClock, RollingMean } from '../metrics';
import { drawOverlay } from '../overlay';
import { markRuntimeAssetsLoaded, serviceWorkerControl } from '../pwa';
import { saveSettings, type Settings } from '../settings';
import { AutoDelegate } from '../delegate';
import type { Delegate } from '../landmarks/types';

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

const TEMPLATE = `
<section class="translate">
  <div class="stage" id="stage">
    <video id="video" playsinline muted autoplay></video>
    <canvas id="overlay" aria-hidden="true"></canvas>
    <div class="stage-msg" id="stageMsg" role="status"></div>
    <div class="hint" id="hint" role="status" aria-live="polite" hidden></div>
  </div>
  <div class="controls">
    <button class="btn primary big" id="startBtn" data-i18n="cam.start"></button>
    <button class="btn" id="stopBtn" data-i18n="cam.stop" hidden></button>
    <button class="btn" id="switchBtn" data-i18n="cam.switch" hidden></button>
  </div>
  <div class="progress" id="progress" hidden>
    <progress id="progressBar" max="1" value="0"></progress>
    <span id="progressText"></span>
  </div>
  <div class="error" id="error" role="alert" hidden></div>
  <div class="outputs">
    <section class="panel" aria-labelledby="enHead">
      <h2 id="enHead" data-i18n="out.en"></h2>
      <p class="out out-en" id="outEn" lang="en" dir="ltr" aria-live="polite"></p>
    </section>
    <section class="panel" aria-labelledby="urHead">
      <h2 id="urHead" data-i18n="out.ur"></h2>
      <p class="out out-ur" id="outUr" lang="ur" dir="rtl" aria-live="polite"></p>
    </section>
  </div>
  <details class="diag" id="diag">
    <summary data-i18n="diag.toggle"></summary>
    <div class="diag-body">
      <div class="diag-controls">
        <label>Landmarks
          <select id="detSel">
            <option value="holistic">Holistic</option>
            <option value="handpose">Hands + Pose (lite)</option>
          </select>
        </label>
        <label>Delegate
          <select id="delSel">
            <option value="auto">Auto (GPU → CPU)</option>
            <option value="GPU">GPU</option>
            <option value="CPU">CPU</option>
          </select>
        </label>
        <button class="btn" id="copyDiag" data-i18n="diag.copy"></button>
      </div>
      <dl id="diagList" lang="en" dir="ltr"></dl>
    </div>
  </details>
</section>`;

export class TranslatePage {
  private el!: HTMLElement;
  private video!: VideoWithRVFC;
  private overlay!: HTMLCanvasElement;
  private camera!: Camera;
  private detector: LandmarkDetector | null = null;
  private loading: Promise<LandmarkDetector> | null = null;
  private loopId = 0;
  private loopActive = false;
  private resumeOnVisible = false;
  private clock = new MonotonicClock();
  private fps = new FpsMeter();
  private lmMs = new RollingMean(30);
  private last: FrameLandmarks | null = null;
  private lastPersonAt = -Infinity;
  private lastHandAt = -Infinity;
  private runningSince = 0;
  private brightness: number | null = null;
  private lastBrightnessAt = 0;
  private lastDiagAt = 0;
  private lastVideoTime = -1;
  private framesProcessed = 0;
  private currentHint: HintKey = null;
  private lumaCanvas = document.createElement('canvas');
  private lastError = '';
  private autoDelegate = new AutoDelegate();
  /** Session-only delegate chosen by AutoDelegate or after a GPU failure. */
  private delegateOverride: Delegate | null = null;
  private framesOnDetector = 0;
  private msOnDetector = 0;
  /** Hands where MediaPipe's label agrees / disagrees with the pose-wrist side. */
  private labelAgree = 0;
  private labelDisagree = 0;

  constructor(
    private readonly caps: Capabilities,
    private readonly settings: Settings,
  ) {}

  mount(host: HTMLElement): void {
    host.innerHTML = TEMPLATE;
    this.el = host.querySelector('.translate')!;
    this.video = this.$('video') as VideoWithRVFC;
    this.overlay = this.$('overlay') as HTMLCanvasElement;
    this.camera = new Camera(this.video);
    applyI18n(this.el);
    this.renderOutputs();

    this.$('startBtn').addEventListener('click', () => void this.start());
    this.$('stopBtn').addEventListener('click', () => this.stop());
    this.$('switchBtn').addEventListener('click', () => void this.switchCamera());
    this.$('copyDiag').addEventListener('click', () => void this.copyDiagnostics());

    const det = this.$('detSel') as HTMLSelectElement;
    const del = this.$('delSel') as HTMLSelectElement;
    det.value = this.settings.detector;
    del.value = this.settings.delegate;
    if (!isAvailable('holistic')) det.querySelector<HTMLOptionElement>('option[value=holistic]')!.disabled = true;
    det.addEventListener('change', () => this.changePipeline({ detector: det.value as Settings['detector'] }));
    del.addEventListener('change', () => this.changePipeline({ delegate: del.value as Settings['delegate'] }));

    const diag = this.$('diag') as HTMLDetailsElement;
    diag.open = this.settings.diagnostics;
    diag.addEventListener('toggle', () => {
      this.settings.diagnostics = diag.open;
      saveSettings(this.settings);
    });

    this.video.addEventListener('resize', () => this.fitStage());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.updateDiagnostics(true);
  }

  unmount(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stop();
    this.detector?.close();
    this.detector = null;
  }

  /** Re-render text after a UI language change. */
  relabel(): void {
    applyI18n(this.el);
    this.renderOutputs();
    this.showHint(this.currentHint, true);
  }

  private $(id: string): HTMLElement {
    return this.el.querySelector(`#${id}`)!;
  }

  private renderOutputs(): void {
    // Panels are fixed to their own language, whatever the interface language is.
    this.$('outEn').textContent = t('out.pending', {}, 'en');
    this.$('outUr').textContent = t('out.pending', {}, 'ur');
  }

  private async start(): Promise<void> {
    this.hideError();
    if (!this.caps.wasm) return this.showError(t('err.nowasm'));
    const startBtn = this.$('startBtn') as HTMLButtonElement;
    startBtn.disabled = true;
    try {
      // Ask for the camera first, inside the tap handler (iOS needs the gesture).
      if (!this.caps.secure || !this.caps.mediaDevices) throw Object.assign(new Error('no mediaDevices'), { name: 'NoMediaDevices' });
      await this.camera.start(this.camera.facing);
    } catch (e) {
      startBtn.disabled = false;
      const problem = classifyCameraError(e, {
        inApp: this.caps.inApp,
        secure: this.caps.secure,
        hasMediaDevices: this.caps.mediaDevices,
      });
      const detail = (e as Error)?.name || String(e);
      this.lastError = `camera: ${detail}`;
      this.showError(t(`err.${problem}`, { app: this.caps.inApp ?? '', detail }));
      return;
    }
    this.fitStage();
    this.applyMirror();
    startBtn.hidden = true;
    startBtn.disabled = false;
    this.$('stopBtn').hidden = false;
    const n = await Camera.countCameras();
    this.$('switchBtn').hidden = n === 1 || n === 0;

    try {
      await this.ensureDetector();
    } catch (e) {
      console.error(e);
      this.lastError = `detector: ${(e as Error)?.message ?? e}`;
      this.showError(t('load.failed'));
      this.stop();
      return;
    }
    this.startLoop();
  }

  private stop(): void {
    this.stopLoop();
    this.camera.stop();
    this.last = null;
    drawOverlay(this.overlay, null, false);
    this.showHint(null);
    this.$('startBtn').hidden = false;
    this.$('stopBtn').hidden = true;
    this.$('switchBtn').hidden = true;
    this.updateDiagnostics(true);
  }

  private async switchCamera(): Promise<void> {
    const next = this.camera.facing === 'user' ? 'environment' : 'user';
    this.stopLoop();
    try {
      await this.camera.start(next);
    } catch (e) {
      this.lastError = `switch: ${(e as Error)?.name}`;
      await this.camera.start(this.camera.facing).catch(() => undefined);
    }
    this.applyMirror();
    this.fitStage();
    if (this.detector && this.camera.running) this.startLoop();
  }

  private ensureDetector(): Promise<LandmarkDetector> {
    if (this.detector) return Promise.resolve(this.detector);
    if (this.loading) return this.loading;
    const progress = this.$('progress');
    const bar = this.$('progressBar') as HTMLProgressElement;
    const text = this.$('progressText');
    progress.hidden = false;
    text.textContent = t('load.download', { loaded: '0.0', total: formatMB(downloadSize(this.settings.detector)) });
    // Download through the service worker when possible so the files are cached for offline use.
    this.loading = serviceWorkerControl().then(() => createDetector({
      kind: this.settings.detector,
      delegate: this.delegateOverride ?? this.settings.delegate,
      onProgress: (p) => {
        bar.value = p.total ? p.loaded / p.total : 0;
        text.textContent = t('load.download', { loaded: formatMB(p.loaded), total: formatMB(p.total) });
      },
      onStatus: (s) => {
        if (s.startsWith('init')) text.textContent = t('load.init');
      },
    }))
      .then((d) => {
        this.detector = d;
        markRuntimeAssetsLoaded(runtimeUrls(d.kind, d.wasmVariant));
        this.framesOnDetector = 0;
        this.msOnDetector = 0;
        this.lmMs.reset();
        return d;
      })
      .finally(() => {
        this.loading = null;
        progress.hidden = true;
      });
    return this.loading;
  }

  private async changePipeline(patch: Partial<Settings>): Promise<void> {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    // A user choice restarts automatic delegate selection.
    this.delegateOverride = null;
    this.autoDelegate = new AutoDelegate();
    await this.rebuildDetector();
  }

  private async rebuildDetector(): Promise<void> {
    const wasRunning = this.loopActive;
    this.stopLoop();
    this.detector?.close();
    this.detector = null;
    this.lmMs.reset();
    this.fps.reset();
    if (!this.camera.running) return this.updateDiagnostics(true);
    try {
      await this.ensureDetector();
      if (wasRunning || this.camera.running) this.startLoop();
    } catch (e) {
      this.lastError = `detector: ${(e as Error)?.message ?? e}`;
      this.showError(t('load.failed'));
    }
  }

  private startLoop(): void {
    if (this.loopActive) return;
    this.loopActive = true;
    this.runningSince = performance.now();
    this.lastPersonAt = this.lastHandAt = performance.now();
    this.lastVideoTime = -1;
    this.schedule();
  }

  private stopLoop(): void {
    this.loopActive = false;
    if (this.video.cancelVideoFrameCallback && this.loopId) this.video.cancelVideoFrameCallback(this.loopId);
    cancelAnimationFrame(this.loopId);
    this.loopId = 0;
  }

  private schedule(): void {
    if (!this.loopActive) return;
    if (this.video.requestVideoFrameCallback) this.loopId = this.video.requestVideoFrameCallback(() => this.tick());
    else this.loopId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (!this.loopActive) return;
    const det = this.detector;
    const v = this.video;
    // rAF fallback fires every display frame; only process new video frames.
    if (det && v.readyState >= 2 && v.videoWidth > 0 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      const ts = this.clock.next(now);
      try {
        const lm = det.detect(v, ts);
        const dt = performance.now() - now;
        this.lmMs.push(dt);
        this.fps.tick(now);
        this.framesProcessed++;
        this.framesOnDetector++;
        this.msOnDetector += dt;
        this.last = lm;
        if (lm.pose) this.lastPersonAt = now;
        if (lm.hands.length) this.lastHandAt = now;
        for (const h of lm.hands) {
          if (h.source !== 'pose-wrist' || h.mpLabel === 'Unknown') continue;
          if ((h.side === 'left') === (h.mpLabel === 'Left')) this.labelAgree++;
          else this.labelDisagree++;
        }
        drawOverlay(this.overlay, lm, this.camera.facing === 'user');
      } catch (e) {
        // A GPU delegate can fail at run time (context loss, driver bugs): fall back to CPU.
        console.error('detect failed', e);
        this.lastError = `detect(${det.delegate}): ${(e as Error)?.message ?? e}`;
        if (det.delegate === 'GPU') {
          this.autoDelegate.gpuFailed();
          this.delegateOverride = 'CPU';
          void this.rebuildDetector();
          return;
        }
      }
      if (this.settings.delegate === 'auto') {
        const next = this.autoDelegate.update(det.delegate, this.framesOnDetector, this.lmMs.mean, this.msOnDetector);
        if (next) {
          this.delegateOverride = next;
          void this.rebuildDetector();
          return;
        }
      }
      if (now - this.lastBrightnessAt > 1000) {
        this.lastBrightnessAt = now;
        this.brightness = this.measureBrightness();
      }
      this.showHint(
        chooseHint({
          runningMs: now - this.runningSince,
          sinceLastPerson: now - this.lastPersonAt,
          sinceLastHand: now - this.lastHandAt,
          brightness: this.brightness,
          fps: this.fps.fps,
          fpsSamples: this.framesProcessed,
        }),
      );
      if (now - this.lastDiagAt > 250) {
        this.lastDiagAt = now;
        this.updateDiagnostics();
      }
    }
    this.schedule();
  }

  private measureBrightness(): number | null {
    const c = this.lumaCanvas;
    c.width = 32;
    c.height = 24;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(this.video, 0, 0, 32, 24);
      return meanLuma(ctx.getImageData(0, 0, 32, 24).data);
    } catch {
      return null;
    }
  }

  private showHint(key: HintKey, force = false): void {
    if (key === this.currentHint && !force) return;
    this.currentHint = key;
    const el = this.$('hint');
    el.hidden = !key;
    el.textContent = key ? t(key, { fps: this.fps.fps.toFixed(0) }) : '';
  }

  private showError(msg: string): void {
    const el = this.$('error');
    el.textContent = msg;
    el.hidden = false;
  }

  private hideError(): void {
    this.$('error').hidden = true;
  }

  private applyMirror(): void {
    // Mirror the *display* of the front camera only. Landmarks come from the raw frame.
    this.video.classList.toggle('mirrored', this.camera.facing === 'user');
  }

  private fitStage(): void {
    const v = this.video;
    if (v.videoWidth && v.videoHeight) {
      this.$('stage').style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
    }
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      if (this.camera.running) {
        this.resumeOnVisible = true;
        this.stopLoop();
        this.camera.stop(); // release the camera while hidden
      }
    } else if (this.resumeOnVisible) {
      this.resumeOnVisible = false;
      this.camera
        .start(this.camera.facing)
        .then(() => {
          this.applyMirror();
          if (this.detector) this.startLoop();
        })
        .catch(() => {
          this.showError(t('cam.paused'));
          this.stop();
        });
    }
  };

  /** Compact view of the latest frame, for tests and debugging. */
  lastFrameSummary(): {
    t: number;
    hands: { side: string; source: string; mpLabel: string; wristX: number }[];
    wrists: number[] | null;
    wristX: number[] | null;
  } | null {
    const lm = this.last;
    if (!lm) return null;
    return {
      t: lm.t,
      hands: lm.hands.map((h) => ({ side: h.side, source: h.source, mpLabel: h.mpLabel, wristX: h.pts[0]?.x ?? -1 })),
      wrists: lm.pose ? [lm.pose[15]?.v ?? -1, lm.pose[16]?.v ?? -1] : null,
      wristX: lm.pose ? [lm.pose[15]?.x ?? -1, lm.pose[16]?.x ?? -1] : null,
    };
  }

  diagnostics(): Record<string, string | number | boolean | null> {
    const lm = this.last;
    const hands = lm?.hands.map((h) => `${h.side === 'left' ? 'L' : 'R'} via ${h.source} (MediaPipe label: ${h.mpLabel})`).join('; ');
    return {
      fps: Number(this.fps.fps.toFixed(1)),
      landmarkMs: Number(this.lmMs.mean.toFixed(1)),
      classifierMs: 'n/a (no classifier yet)',
      delegate: this.detector?.delegate ?? null,
      delegateChoice: this.settings.delegate === 'auto' ? `auto: ${this.autoDelegate.describe()}` : this.settings.delegate,
      landmarks: this.detector?.kind ?? this.settings.detector,
      wasm: this.detector?.wasmVariant ?? null,
      mediapipe: MEDIAPIPE_VERSION,
      modelVersion: 'n/a (no classifier yet)',
      top3: 'n/a (no classifier yet)',
      camera: this.camera?.running ? this.camera.facing : 'off',
      cameraLabel: this.camera?.trackLabel() ?? '',
      video: this.video?.videoWidth ? `${this.video.videoWidth}x${this.video.videoHeight}` : null,
      pose: lm ? !!lm.pose : null,
      hands: hands || (lm ? 'none' : null),
      mpLabelMatchesPose: this.labelAgree + this.labelDisagree ? `${this.labelAgree}/${this.labelAgree + this.labelDisagree}` : null,
      brightness: this.brightness === null ? null : Math.round(this.brightness),
      hint: this.currentHint,
      webgl2: this.caps.webgl2,
      inAppBrowser: this.caps.inApp,
      crossOriginIsolated: self.crossOriginIsolated ?? false,
      lastError: this.lastError || null,
      userAgent: navigator.userAgent,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    };
  }

  private updateDiagnostics(force = false): void {
    const diag = this.$('diag') as HTMLDetailsElement;
    if (!diag.open && !force) return;
    const list = this.$('diagList');
    const frag = document.createDocumentFragment();
    for (const [k, v] of Object.entries(this.diagnostics())) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v === null ? '—' : String(v);
      dd.dataset.key = k;
      frag.append(dt, dd);
    }
    list.replaceChildren(frag);
  }

  private async copyDiagnostics(): Promise<void> {
    const text = JSON.stringify(this.diagnostics(), null, 2);
    const btn = this.$('copyDiag');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = t('diag.copied');
      setTimeout(() => (btn.textContent = t('diag.copy')), 1500);
    } catch {
      // Clipboard blocked: show the text so it can be selected manually.
      window.prompt('Diagnostics', text);
    }
  }
}
