// Builds e2e/fixtures/signer.mjpeg, the looped clip Chromium's fake camera plays
// in end-to-end tests. Source: PSL dictionary clips by the Hamza Foundation
// Academy for the Deaf via sign-language-translator/sign-language-datasets
// (CC BY 4.0, see THIRD_PARTY.md). Needs ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'e2e', 'fixtures', 'signer.mjpeg');
const signs = ['help', 'good', 'house'];
const base = 'https://github.com/sign-language-translator/sign-language-datasets/releases/download/v0.0.2/';

const dir = await mkdtemp(join(tmpdir(), 'psl-fixture-'));
try {
  const parts = [];
  for (const s of signs) {
    const res = await fetch(`${base}pk-hfad-1_${s}.mp4`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${s}`);
    const p = join(dir, `${s}.mp4`);
    await writeFile(p, Buffer.from(await res.arrayBuffer()));
    parts.push(p);
  }
  const list = join(dir, 'list.txt');
  await writeFile(list, parts.map((p) => `file '${p}'`).join('\n'));
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', 'fps=15,scale=640:480', '-q:v', '7', '-f', 'mjpeg', out,
  ]);
  console.log(`wrote ${out}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
