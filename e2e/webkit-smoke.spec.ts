import { expect, test } from '@playwright/test';
import { track404s } from './helpers';

// WebKit has no fake camera in Playwright, so this only checks that the app
// loads, renders and shows the Start button without script errors.
test('page loads in WebKit', async ({ page }) => {
  const misses = track404s(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#/translate');
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
  await expect(page.locator('.notice')).toContainText('never uploaded');
  expect(errors).toEqual([]);
  expect(misses).toEqual([]);
});
