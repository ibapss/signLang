import { expect, type Page, type TestInfo } from '@playwright/test';

/** Record every failed same-origin request so a test can assert there were none. */
export function track404s(page: Page): string[] {
  const misses: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404) misses.push(r.url());
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? '';
    // Aborted requests (navigation, cancelled media) are not missing files.
    if (!/ABORTED|cancelled/i.test(f)) misses.push(`${r.url()} (${f})`);
  });
  return misses;
}

export type Diag = Record<string, string | number | boolean | null>;

export async function diagnostics(page: Page): Promise<Diag | null> {
  return page.evaluate(() => (window as unknown as { __psl: { diagnostics(): Diag | null } }).__psl.diagnostics());
}

/** Start the camera on the Translate page (CPU delegate) and wait for landmarks. */
export async function startAndWaitForHands(page: Page, testInfo: TestInfo, query = '?delegate=cpu&diag=1') {
  await page.goto(`./${query}#/translate`);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect
    .poll(async () => (await diagnostics(page))?.hands, { timeout: 90_000, message: 'hands detected in fake camera clip' })
    .toMatch(/^(L|R) via/);
  const d = await diagnostics(page);
  await testInfo.attach('diagnostics.json', { body: JSON.stringify(d, null, 2), contentType: 'application/json' });
  return d;
}
