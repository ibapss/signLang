// Compares landmark pipelines in headless Chromium using the fake-camera clip.
//   npm run build && node scripts/bench-landmarks.mjs [--seconds 20]
// Needs the dev server or serve-dist running? No: it starts serve-dist itself.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secIdx = process.argv.indexOf('--seconds');
const seconds = secIdx > 0 ? Number(process.argv[secIdx + 1]) : 20;
const port = 4199;
const srv = spawn(process.execPath, [join(root, 'scripts/serve-dist.mjs'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const configs = [
  { detector: 'handpose', delegate: 'cpu' },
  { detector: 'holistic', delegate: 'cpu' },
  { detector: 'handpose', delegate: 'gpu' },
  { detector: 'holistic', delegate: 'gpu' },
];
const results = [];
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${join(root, 'e2e/fixtures/signer.mjpeg')}`,
  ],
});
try {
  for (const c of configs) {
    const ctx = await browser.newContext({ permissions: ['camera'], serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/signLang/?detector=${c.detector}&delegate=${c.delegate}#/translate`);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Start camera' }).click();
    let ok = true;
    try {
      await page.waitForFunction(() => window.__psl.diagnostics()?.delegate, null, { timeout: 120000 });
    } catch {
      ok = false;
    }
    const initMs = Date.now() - t0;
    if (!ok) {
      const d = await page.evaluate(() => window.__psl.diagnostics());
      results.push({ ...c, error: d?.lastError ?? 'did not start' });
      await ctx.close();
      continue;
    }
    await page.waitForTimeout(3000); // warm-up
    let frames = 0, withHands = 0, twoHands = 0, withPose = 0, lastT = -1;
    const ms = [];
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const s = await page.evaluate(() => ({ f: window.__psl.lastFrame(), d: window.__psl.diagnostics() }));
      if (s.f && s.f.t !== lastT) {
        lastT = s.f.t; frames++;
        if (s.f.hands.length) withHands++;
        if (s.f.hands.length === 2) twoHands++;
        if (s.f.wrists) withPose++;
      }
      ms.push(s.d.landmarkMs);
      await page.waitForTimeout(25);
    }
    const d = await page.evaluate(() => window.__psl.diagnostics());
    results.push({
      ...c,
      delegateUsed: d.delegate,
      initMs,
      landmarkMs: Number((ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1)),
      fps: d.fps,
      sampledFrames: frames,
      handRate: Number((withHands / frames).toFixed(2)),
      twoHandRate: Number((twoHands / frames).toFixed(2)),
      poseRate: Number((withPose / frames).toFixed(2)),
    });
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
console.log(JSON.stringify({ browser: 'headless Chromium ' + (await chromium.launch().then(async (b) => { const v = b.version(); await b.close(); return v; })), seconds, results }, null, 2));
