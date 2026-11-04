import { describe, expect, it } from 'vitest';
import { classifyCameraError, detectInAppBrowser } from '../src/env';

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  facebookIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0;FBBV/1]',
  instagram: 'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 350.0.0.0',
  webview: 'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36',
};

describe('detectInAppBrowser', () => {
  it('does not flag normal browsers', () => {
    expect(detectInAppBrowser(UA.chromeAndroid)).toBeNull();
    expect(detectInAppBrowser(UA.safariIOS)).toBeNull();
  });
  it('flags common in-app browsers', () => {
    expect(detectInAppBrowser(UA.facebookIOS)).toBe('Facebook');
    expect(detectInAppBrowser(UA.instagram)).toBe('Instagram');
    expect(detectInAppBrowser(UA.webview)).toBe('an app');
  });
});

describe('classifyCameraError', () => {
  const ok = { inApp: null, secure: true, hasMediaDevices: true };
  it('maps standard getUserMedia errors', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' }, ok)).toBe('denied');
    expect(classifyCameraError({ name: 'NotFoundError' }, ok)).toBe('no-camera');
    expect(classifyCameraError({ name: 'OverconstrainedError' }, ok)).toBe('no-camera');
    expect(classifyCameraError({ name: 'NotReadableError' }, ok)).toBe('in-use');
    expect(classifyCameraError({ name: 'Weird' }, ok)).toBe('unknown');
  });
  it('blames the in-app browser when it is one', () => {
    const inApp = { ...ok, inApp: 'Instagram' };
    expect(classifyCameraError({ name: 'NotAllowedError' }, inApp)).toBe('in-app');
    expect(classifyCameraError(null, { ...inApp, hasMediaDevices: false })).toBe('in-app');
  });
  it('reports insecure and unsupported contexts', () => {
    expect(classifyCameraError(null, { ...ok, secure: false })).toBe('insecure');
    expect(classifyCameraError(null, { ...ok, hasMediaDevices: false })).toBe('unsupported');
  });
});
