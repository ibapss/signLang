import { expect, test, type Page } from '@playwright/test';
import { startAndWaitForHands } from './helpers';

// The fixture clip is NOT mirrored (the signer's shirt pocket and watch, both on
// his left, appear on the image's right). These checks pin down MediaPipe's
// left/right conventions on unmirrored frames, which the feature spec relies on
// (recorded in PROGRESS.md; docs/FEATURES.md arrives in milestone 3).

type Summary = {
  t: number;
  hands: { side: string; source: string; mpLabel: string; wristX: number }[];
  wristX: number[] | null;
};
const lastFrame = (page: Page) =>
  page.evaluate(() => (window as unknown as { __psl: { lastFrame(): Summary | null } }).__psl.lastFrame());

async function collect(page: Page, ms: number) {
  const frames: Summary[] = [];
  let last = -1;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await lastFrame(page);
    if (s && s.t !== last) {
      last = s.t;
      frames.push(s);
    }
    await page.waitForTimeout(25);
  }
  return frames;
}

for (const detector of ['holistic', 'handpose'] as const) {
  test(`${detector}: left/right are anatomical on unmirrored frames`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'one viewport is enough');
    await startAndWaitForHands(page, testInfo, `?delegate=cpu&detector=${detector}`);
    const frames = await collect(page, 20_000);
    const withPose = frames.filter((f) => f.wristX);
    const mean = (k: number) => withPose.reduce((a, f) => a + f.wristX![k], 0) / withPose.length;
    // Pose RIGHT_WRIST (16) is on the image's left for a signer facing the camera.
    expect(mean(1)).toBeLessThan(mean(0));

    // Each hand's wrist is nearer the same-named pose wrist.
    let near = 0;
    let total = 0;
    let labelAgree = 0;
    let labelTotal = 0;
    for (const f of withPose) {
      for (const h of f.hands) {
        const own = h.side === 'left' ? f.wristX![0] : f.wristX![1];
        const other = h.side === 'left' ? f.wristX![1] : f.wristX![0];
        total++;
        if (Math.abs(h.wristX - own) < Math.abs(h.wristX - other)) near++;
        if (h.source === 'pose-wrist' && h.mpLabel !== 'Unknown') {
          labelTotal++;
          if ((h.side === 'left') === (h.mpLabel === 'Left')) labelAgree++;
        }
      }
    }
    await testInfo.attach('handedness.json', {
      body: JSON.stringify({ detector, frames: frames.length, near, total, labelAgree, labelTotal }),
      contentType: 'application/json',
    });
    expect(total).toBeGreaterThan(20);
    expect(near / total).toBeGreaterThan(0.95);
    if (detector === 'handpose') {
      // MediaPipe's hand label is anatomical on unmirrored frames (contrary to its docs).
      expect(labelTotal).toBeGreaterThan(20);
      expect(labelAgree / labelTotal).toBeGreaterThan(0.9);
    }
  });
}
