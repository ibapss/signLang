import { describe, expect, it } from 'vitest';
import { assetUrl } from '../src/assets';
import { chooseHint, meanLuma, type HintState } from '../src/hints';
import { FpsMeter, MonotonicClock, RollingMean } from '../src/metrics';
import { parseRoute } from '../src/router';
import { parseOverrides } from '../src/settings';
import strings from '../src/i18n/strings.json';

describe('assetUrl', () => {
  it('keeps every asset under the deployed subpath', () => {
    expect(assetUrl('rt/x.wasm', '/signLang/')).toBe('/signLang/rt/x.wasm');
    expect(assetUrl('/rt/x.wasm', '/signLang/')).toBe('/signLang/rt/x.wasm');
    expect(assetUrl('rt/x.wasm', '/repo')).toBe('/repo/rt/x.wasm');
  });
});

describe('parseRoute', () => {
  it('parses hash routes and defaults to translate', () => {
    expect(parseRoute('#/signs')).toBe('signs');
    expect(parseRoute('#collect')).toBe('collect');
    expect(parseRoute('#/test?x=1')).toBe('test');
    expect(parseRoute('')).toBe('translate');
    expect(parseRoute('#/nope')).toBe('translate');
  });
});

describe('parseOverrides', () => {
  it('reads delegate, detector and diag from the query string', () => {
    expect(parseOverrides('?delegate=cpu&detector=holistic&diag=1')).toEqual({ delegate: 'CPU', detector: 'holistic', diagnostics: true });
    expect(parseOverrides('?delegate=bogus')).toEqual({});
  });
});

describe('metrics', () => {
  it('RollingMean keeps a window', () => {
    const m = new RollingMean(3);
    [1, 2, 3, 4].forEach((v) => m.push(v));
    expect(m.mean).toBe(3);
    expect(m.count).toBe(3);
  });
  it('FpsMeter counts frames per second', () => {
    const f = new FpsMeter(2000);
    for (let i = 0; i <= 30; i++) f.tick(i * 100);
    expect(f.fps).toBeCloseTo(10, 5);
  });
  it('MonotonicClock never repeats or goes back', () => {
    const c = new MonotonicClock();
    expect(c.next(10)).toBe(10);
    expect(c.next(10)).toBe(11);
    expect(c.next(5)).toBe(12);
    expect(c.next(100)).toBe(100);
  });
});

describe('hints', () => {
  const base: HintState = { runningMs: 10_000, sinceLastPerson: 0, sinceLastHand: 0, brightness: 120, fps: 20, fpsSamples: 100 };
  it('stays quiet when all is well or just started', () => {
    expect(chooseHint(base)).toBeNull();
    expect(chooseHint({ ...base, runningMs: 500, sinceLastPerson: 9999 })).toBeNull();
  });
  it('prioritizes darkness, then no person, then no hands, then slow device', () => {
    expect(chooseHint({ ...base, brightness: 20, sinceLastPerson: 9999 })).toBe('hint.dark');
    expect(chooseHint({ ...base, sinceLastPerson: 9999, sinceLastHand: 9999 })).toBe('hint.no-person');
    expect(chooseHint({ ...base, sinceLastHand: 9999 })).toBe('hint.no-hands');
    expect(chooseHint({ ...base, fps: 4 })).toBe('hint.slow');
  });
  it('meanLuma averages RGBA pixels', () => {
    expect(meanLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(127.5, 1);
  });
});

describe('UI strings', () => {
  it('every key has English and Urdu text and a reviewed flag', () => {
    for (const [k, v] of Object.entries(strings)) {
      if (k.startsWith('_')) continue;
      const e = v as { en: string; ur: string; reviewed: boolean };
      expect(e.en, k).toBeTruthy();
      expect(e.ur, k).toBeTruthy();
      expect(typeof e.reviewed, k).toBe('boolean');
    }
  });
  it('placeholders match between languages', () => {
    for (const [k, v] of Object.entries(strings)) {
      if (k.startsWith('_')) continue;
      const e = v as { en: string; ur: string };
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(ph(e.ur), k).toBe(ph(e.en));
    }
  });
});
