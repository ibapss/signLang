import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { track404s } from './helpers';

test('Collect: consent, record a take from the fake camera, download psl-collect-v1', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'one viewport is enough');
  const misses = track404s(page);
  await page.goto('./?delegate=cpu#/collect');
  // Begin is blocked until consent is ticked (native form validation).
  await page.locator('#reps').fill('1');
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator('#session')).toBeHidden();
  await page.locator('#consent').check();
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator('#session')).toBeVisible();

  await page.getByRole('button', { name: 'Start camera' }).click();
  await page.waitForFunction(() => (window as unknown as { __psl: { diagnostics(): { delegate: string | null } | null } }).__psl.diagnostics()?.delegate, null, { timeout: 90_000 });

  // The fixture clip has rest moments, so a sign take can legitimately be rejected; allow a few tries.
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.locator('#status')).toHaveText(/Saved|No hands/, { timeout: 20_000 });
    if ((await page.locator('#status').textContent())?.startsWith('Saved')) break;
  }
  await expect(page.locator('#status')).toContainText('Saved');

  const download = page.waitForEvent('download');
  await page.locator('#exportBtn').click();
  const file = await (await download).path();
  const data = JSON.parse(await readFile(file, 'utf8'));
  expect(data.format).toBe('psl-collect-v1');
  expect(data.feature_version).toBe('psl-f1');
  expect(data.signer.code).toMatch(/^S-/);
  expect(data.consent.agreed).toBe(true);
  expect(data.takes).toHaveLength(1);
  const take = data.takes[0];
  expect(take.frames.length).toBeGreaterThan(5);
  // Frames are inside the recording window and in the raw-frame format.
  for (const f of take.frames) {
    expect(f.t).toBeGreaterThanOrEqual(take.start_t - 1e-3);
    expect(f.t).toBeLessThanOrEqual(take.end_t + 1e-3);
    if (f.pose) expect(f.pose).toHaveLength(33);
  }
  expect(JSON.stringify(data)).not.toMatch(/data:image|video\//);
  await testInfo.attach('collect-sample.json', { body: JSON.stringify(data).slice(0, 4000), contentType: 'application/json' });
  expect(misses).toEqual([]);
});
