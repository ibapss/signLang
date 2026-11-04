// Downloads the pinned MediaPipe .task models into .cache/models/ and verifies
// their SHA-256. Skips files that are already present and correct.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.cache', 'models');
const manifest = JSON.parse(await readFile(join(root, 'scripts', 'models.json'), 'utf8'));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

await mkdir(outDir, { recursive: true });
for (const m of manifest.models) {
  const dest = join(outDir, m.file);
  try {
    const cur = await readFile(dest);
    if (sha256(cur) === m.sha256) { console.log(`ok   ${m.file}`); continue; }
    console.log(`bad checksum, re-downloading ${m.file}`);
  } catch { /* not present */ }
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = sha256(buf);
      if (got !== m.sha256) throw new Error(`checksum mismatch for ${m.file}: ${got}`);
      await writeFile(dest, buf);
      console.log(`got  ${m.file} (${(buf.length / 1e6).toFixed(1)} MB)`);
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`attempt ${attempt} failed for ${m.file}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
  if (lastErr) { console.error(lastErr); process.exit(1); }
}
