export type Facing = 'user' | 'environment';

/**
 * Wraps getUserMedia for one <video> element. Frames are never mirrored here;
 * the front-camera preview is mirrored for display with CSS only, so the
 * landmark input is the same for both cameras.
 */
export class Camera {
  private stream: MediaStream | null = null;
  facing: Facing = 'user';

  constructor(readonly video: HTMLVideoElement) {
    // Required for inline playback on iOS and autoplay without a gesture.
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.playsInline = true;
  }

  get running(): boolean {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  async start(facing: Facing = this.facing): Promise<void> {
    this.stop();
    this.facing = facing;
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 1) resolve();
      else this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    await this.video.play();
    // Some devices ignore facingMode; report what we actually got.
    const settings = this.stream.getVideoTracks()[0]?.getSettings();
    if (settings?.facingMode === 'user' || settings?.facingMode === 'environment') {
      this.facing = settings.facingMode;
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Number of video inputs, or -1 if the browser will not say (before permission). */
  static async countCameras(): Promise<number> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'videoinput').length;
    } catch {
      return -1;
    }
  }

  trackLabel(): string {
    return this.stream?.getVideoTracks()[0]?.label ?? '';
  }
}
