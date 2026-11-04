import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_PATH ?? '/signLang/';
const PORT = Number(process.env.E2E_PORT ?? 4173);
const fakeVideo = fileURLToPath(new URL('./e2e/fixtures/signer.mjpeg', import.meta.url));

const chromiumCamera = {
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${fakeVideo}`,
    ],
  },
  permissions: ['camera'],
};

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: `node scripts/serve-dist.mjs --port ${PORT} --base ${BASE}`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium-phone',
      testIgnore: /webkit-smoke/,
      use: { ...devices['Pixel 7'], ...chromiumCamera },
    },
    {
      name: 'chromium-desktop',
      testIgnore: /webkit-smoke/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, ...chromiumCamera },
    },
    {
      name: 'webkit-smoke',
      testMatch: /webkit-smoke/,
      use: { ...devices['iPhone 14'] },
    },
  ],
});
