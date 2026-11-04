// Captures REAL raw frames (docs/FEATURES.md §1) from the production pipeline,
// with Chromium's fake camera playing e2e/fixtures/signer.mjpeg (a real signer,
// CC BY 4.0). Output feeds the Python/TypeScript feature parity tests.
//   npm run build && node scripts/capture-golden-frames.mjs [detector]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const detector = process.argv[2] ?? 'holistic';
const port = 4198;
const srv = spawn(process.execPath, [join(root, 'scripts/serve-dist.mjs'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${join(root, 'e2e/fixtures/signer.mjpeg')}`],
});
try {
  const page = await (await browser.newContext({ permissions: ['camera'], serviceWorkers: 'block' })).newPage();
  await page.goto(`http://localhost:${port}/signLang/?delegate=cpu&detector=${detector}#/translate`);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await page.waitForFunction(() => window.__psl.rawFrames().length >= 90, null, { timeout: 120000 });
  const frames = await page.evaluate(() => window.__psl.rawFrames().slice(-90));
  const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  const out = {
    description: `Real raw frames from the browser pipeline (${detector}, CPU) on e2e/fixtures/signer.mjpeg. Not synthetic.`,
    detector,
    frames: frames.map((f) => ({ ...f, t: Math.round(f.t * 1000) / 1000, pose: round(f.pose), left: round(f.left), right: round(f.right) })),
  };
  const file = join(root, 'tests/golden', `frames-fixture-${detector}.json`);
  await writeFile(file, JSON.stringify(out));
  const hands = frames.filter((f) => f.left || f.right).length;
  console.log(`wrote ${file}: ${frames.length} frames, ${hands} with a hand, ${frames.filter((f) => f.left && f.right).length} with both`);
} finally {
  await browser.close();
  srv.kill();
}
