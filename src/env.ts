/** Browser capability and environment checks. Pure functions take inputs so they can be unit-tested. */

const IN_APP_PATTERNS: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/Instagram/i, 'Instagram'],
  [/\bLine\//i, 'LINE'],
  [/MicroMessenger/i, 'WeChat'],
  [/Snapchat/i, 'Snapchat'],
  [/musical_ly|Bytedance|TikTok/i, 'TikTok'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Twitter/i, 'X (Twitter)'],
  [/Pinterest/i, 'Pinterest'],
];

/** Name of the in-app browser if the user agent looks like one, else null. */
export function detectInAppBrowser(ua: string): string | null {
  for (const [re, name] of IN_APP_PATTERNS) if (re.test(ua)) return name;
  // Generic Android WebView marker ("; wv)") — e.g. WhatsApp/Telegram link previews opened in-app.
  if (/Android.*; wv\)/.test(ua)) return 'an app';
  return null;
}

export type CameraProblem =
  | 'denied'
  | 'no-camera'
  | 'in-use'
  | 'insecure'
  | 'unsupported'
  | 'in-app'
  | 'unknown';

/** Map a getUserMedia error (or its absence) to a user-facing problem. */
export function classifyCameraError(
  err: unknown,
  ctx: { inApp: string | null; secure: boolean; hasMediaDevices: boolean },
): CameraProblem {
  if (!ctx.secure) return 'insecure';
  if (!ctx.hasMediaDevices) return ctx.inApp ? 'in-app' : 'unsupported';
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      // In-app browsers often deny without ever showing a prompt.
      return ctx.inApp ? 'in-app' : 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    case 'TypeError':
      return 'unsupported';
    default:
      return ctx.inApp ? 'in-app' : 'unknown';
  }
}

export interface Capabilities {
  secure: boolean;
  mediaDevices: boolean;
  wasm: boolean;
  webgl2: boolean;
  inApp: string | null;
  speech: boolean;
}

export function detectCapabilities(): Capabilities {
  let webgl2 = false;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  return {
    secure: window.isSecureContext,
    mediaDevices: !!navigator.mediaDevices?.getUserMedia,
    wasm: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
    webgl2,
    inApp: detectInAppBrowser(navigator.userAgent),
    speech: 'speechSynthesis' in window,
  };
}
