import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site under /<repo-name>/. CI passes the exact base
// path from actions/configure-pages; locally it defaults to /signLang/.
const base = normalizeBase(process.env.BASE_PATH ?? '/signLang/');

function normalizeBase(b: string): string {
  let s = b.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s += '/';
  return s;
}

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'PSL Translator — Pakistan Sign Language to English & Urdu',
        short_name: 'PSL Translator',
        description: 'Live Pakistan Sign Language to English and Urdu text. Runs on your device.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0f1419',
        theme_color: '#0f1419',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only (HTML, JS, CSS, fonts, icons): small, precached on install.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,webmanifest}'],
        globIgnores: ['rt/**', 'e2e/**'],
        // Large runtime files (WASM ~13.5 MB, models ~6-14 MB) live in rt/ with
        // content-hashed names and are cached the first time the page downloads
        // them *through* the service worker. Precaching them as well would
        // download them twice on a first visit: measured 55 MB instead of 28 MB,
        // because browsers do not reliably keep 13 MB entries in the HTTP cache.
        // The 2 MiB default limit below then never matters for these files, but
        // keep it raised so a large shell asset is never silently skipped.
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        // Take control of the page on first install so the first model download
        // already goes through the service worker (and gets cached).
        clientsClaim: true,
        dontCacheBustURLsMatching: /(^|\/)assets\//,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/rt\/[^/]+\.[0-9a-f]{10}\.(wasm|js|task|onnx|json)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'runtime-assets',
              cacheableResponse: { statuses: [200] },
              // Hashed names: old versions are never requested again. Keep room for
              // both pipelines, both WASM variants and a classifier, then evict.
              expiration: { maxEntries: 16, purgeOnQuotaError: false },
            },
          },
        ],
      },
    }),
  ],
});
