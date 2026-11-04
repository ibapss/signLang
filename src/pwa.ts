import { registerSW } from 'virtual:pwa-register';
import { t } from './i18n';

let registered = false;
let shellReady = false;
let assetUrls: string[] | null = null;
let offlineShown = false;

/**
 * Register the service worker at start-up. It precaches only the small app
 * shell and claims the page, so the large WASM and model files are cached the
 * first time the page downloads them through it (see vite.config.ts).
 */
export function registerServiceWorker(): void {
  if (registered || !('serviceWorker' in navigator)) return;
  registered = true;
  const update = registerSW({
    onNeedRefresh() {
      showBanner(t('pwa.update'), t('pwa.reload'), () => update(true));
    },
    onOfflineReady() {
      shellReady = true;
      void maybeAnnounceOffline();
    },
  });
}

/**
 * Resolve once a service worker controls this page, or after `timeoutMs`
 * (no service worker support, dev server, private mode). Downloads that start
 * after this are cached for offline use.
 */
export function serviceWorkerControl(timeoutMs = 4000): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(false);
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  if (!registered) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    navigator.serviceWorker.addEventListener('controllerchange', () => done(true), { once: true });
  });
}

/**
 * Tell the PWA layer which runtime files the page has loaded. "Ready to work
 * offline" is shown only once the app shell is precached *and* these files are
 * confirmed in the cache, so the message is never premature.
 */
export function markRuntimeAssetsLoaded(urls: string[]): void {
  assetUrls = urls;
  void maybeAnnounceOffline();
}

export async function runtimeAssetsCached(urls: string[]): Promise<boolean> {
  if (!('caches' in self)) return false;
  try {
    const hits = await Promise.all(urls.map((u) => caches.match(u)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}

async function maybeAnnounceOffline(): Promise<void> {
  if (offlineShown || !assetUrls) return;
  if (!shellReady) shellReady = !!navigator.serviceWorker?.controller;
  if (!shellReady) return;
  if (await runtimeAssetsCached(assetUrls)) {
    offlineShown = true;
    showBanner(t('pwa.offline'));
  }
}

function showBanner(msg: string, actionLabel?: string, action?: () => void): void {
  const host = document.getElementById('banner');
  if (!host) return;
  host.replaceChildren();
  const p = document.createElement('span');
  p.textContent = msg;
  host.append(p);
  if (actionLabel && action) {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = actionLabel;
    b.addEventListener('click', action);
    host.append(b);
  }
  const close = document.createElement('button');
  close.className = 'btn';
  close.textContent = t('pwa.dismiss');
  close.addEventListener('click', () => (host.hidden = true));
  host.append(close);
  host.hidden = false;
}
