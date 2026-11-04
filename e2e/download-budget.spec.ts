import { expect, test } from '@playwright/test';
import { startAndWaitForHands, track404s } from './helpers';

// First visit: everything needed to start tracking, downloaded once, under ~40 MB.
test('first load stays under the download budget with no duplicate downloads', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'one viewport is enough');
  const origin = new URL(testInfo.project.use.baseURL!).origin;
  await request.get(`${origin}/__stats/reset`);
  const misses = track404s(page);
  await startAndWaitForHands(page, testInfo);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.locator('#banner')).toContainText('Ready to work offline', { timeout: 30_000 });
  const stats = (await (await request.get(`${origin}/__stats`)).json()) as {
    bytesServed: number;
    served: Record<string, number>;
  };
  await testInfo.attach('download-stats.json', { body: JSON.stringify(stats, null, 2), contentType: 'application/json' });
  const runtime = Object.entries(stats.served).filter(([p]) => p.includes('/rt/'));
  expect(runtime.length).toBeGreaterThanOrEqual(3);
  for (const [path, n] of runtime) expect(n, `${path} downloaded ${n} times`).toBe(1);
  expect(stats.bytesServed).toBeLessThan(40e6);
  expect(misses).toEqual([]);
});
