import type { Delegate, DetectorKind } from './landmarks/types';

export interface Settings {
  detector: DetectorKind;
  delegate: 'auto' | Delegate;
  diagnostics: boolean;
}

// Holistic is the default: in headless-Chromium tests it was as fast as
// HandLandmarker + PoseLandmarker lite and found hands in more frames (see
// PROGRESS.md). Real-phone measurements may change this.
const DEFAULTS: Settings = { detector: 'holistic', delegate: 'auto', diagnostics: false };
const KEY = 'settings-v1';

/** Parse overrides from a query string, e.g. "?delegate=cpu&detector=holistic&diag=1". */
export function parseOverrides(search: string): Partial<Settings> {
  const q = new URLSearchParams(search);
  const out: Partial<Settings> = {};
  const d = q.get('detector');
  if (d === 'handpose' || d === 'holistic') out.detector = d;
  const g = q.get('delegate')?.toUpperCase();
  if (g === 'GPU' || g === 'CPU') out.delegate = g;
  else if (g === 'AUTO') out.delegate = 'auto';
  const diag = q.get('diag');
  if (diag === '1') out.diagnostics = true;
  return out;
}

function sanitize(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (r.detector === 'handpose' || r.detector === 'holistic') out.detector = r.detector;
  if (r.delegate === 'auto' || r.delegate === 'GPU' || r.delegate === 'CPU') out.delegate = r.delegate;
  if (typeof r.diagnostics === 'boolean') out.diagnostics = r.diagnostics;
  return out;
}

export function loadSettings(search = location.search): Settings {
  let stored: Partial<Settings> = {};
  try {
    stored = sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    stored = {};
  }
  return { ...DEFAULTS, ...stored, ...parseOverrides(search) };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}
