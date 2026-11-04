import { expect, test } from '@playwright/test';
import { diagnostics, startAndWaitForHands, track404s } from './helpers';

test('camera starts, landmarks appear and are drawn, no 404s', async ({ page }, testInfo) => {
  const misses = track404s(page);
  const d = await startAndWaitForHands(page, testInfo);
  expect(d?.delegate).toBe('CPU');
  expect(d?.landmarks).toBe('holistic');
  expect(d?.pose).toBe(true);
  expect(Number(d?.fps)).toBeGreaterThan(0);

  // The overlay canvas has non-transparent pixels (landmarks drawn).
  const drawn = await page.locator('#overlay').evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
  expect(drawn).toBeGreaterThan(100);

  // Both language panels are present with their language and direction.
  await expect(page.locator('#outEn')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#outUr')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#outEn')).not.toBeEmpty();
  await expect(page.locator('#outUr')).not.toBeEmpty();

  await page.screenshot({ path: testInfo.outputPath('translate.png'), fullPage: true });
  expect(misses, `missing files: ${misses.join(', ')}`).toEqual([]);
});

test('alternative Hands + Pose pipeline also finds landmarks', async ({ page }, testInfo) => {
  const misses = track404s(page);
  const d = await startAndWaitForHands(page, testInfo, '?delegate=cpu&detector=handpose&diag=1');
  expect(d?.landmarks).toBe('handpose');
  expect(d?.pose).toBe(true);
  expect(misses).toEqual([]);
});

test('Urdu interface mirrors the layout', async ({ page }, testInfo) => {
  const misses = track404s(page);
  await page.goto('./#/translate');
  await page.locator('#langBtn').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
  await expect(page.locator('#startBtn')).toHaveText('کیمرا شروع کریں');
  // The Nastaliq font is actually used (self-hosted, not a system fallback).
  await page.evaluate(() => document.fonts.ready);
  const fontOk = await page.evaluate(() => document.fonts.check('16px "Noto Nastaliq Urdu"', 'اردو'));
  expect(fontOk).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('urdu-ui.png'), fullPage: true });
  await page.locator('#langBtn').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(misses).toEqual([]);
});

test('hash routes work without a server fallback', async ({ page }) => {
  const misses = track404s(page);
  for (const r of ['signs', 'collect', 'test', 'translate']) {
    await page.goto(`./#/${r}`);
    await expect(page.locator(`nav a[data-route=${r}]`)).toHaveAttribute('aria-current', 'page');
  }
  expect(misses).toEqual([]);
});

test('works offline after the first load', async ({ page, context }, testInfo) => {
  const misses = track404s(page);
  await startAndWaitForHands(page, testInfo);
  // The service worker registers after the models load; `ready` resolves once
  // it has finished precaching and activated.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect.poll(async () => (await diagnostics(page))?.hands, { timeout: 90_000 }).toMatch(/^(L|R) via/);
  await context.setOffline(false);
  expect(misses.filter((m) => !m.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([]);
});
