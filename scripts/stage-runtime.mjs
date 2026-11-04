// Stages runtime assets (MediaPipe WASM from node_modules, .task models from
// .cache/models) into public/rt/ with content-hashed file names, and writes
// src/generated/runtime-assets.json for the app to import.
//
// Why hashed names: Workbox does not cache-bust URLs that already carry a hash,
// so the service worker's precache can reuse the bytes the page just
// downloaded (HTTP cache) instead of downloading 20+ MB a second time. It also
// means a new model or runtime version produces a new URL, which triggers the
// "update available" prompt.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'rt');
const genDir = join(root, 'src', 'generated');
const mpDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const mpPkg = JSON.parse(await readFile(join(mpDir, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'scripts', 'models.json'), 'utf8'));

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(genDir, { recursive: true });

async function stage(srcPath) {
  const buf = await readFile(srcPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const ext = extname(srcPath);
  const name = `${basename(srcPath, ext)}.${sha256.slice(0, 10)}${ext}`;
  await copyFile(srcPath, join(outDir, name));
  return { path: `rt/${name}`, bytes: buf.length, sha256 };
}

const wasm = {};
for (const variant of ['simd', 'nosimd']) {
  const stem = variant === 'simd' ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
  wasm[variant] = {
    loader: await stage(join(mpDir, 'wasm', `${stem}.js`)),
    binary: await stage(join(mpDir, 'wasm', `${stem}.wasm`)),
  };
}

const models = {};
for (const m of manifest.models) {
  const src = join(root, '.cache', 'models', m.file);
  const exists = await stat(src).then(() => true, () => false);
  if (!exists) {
    console.error(`missing ${src}; run npm run fetch-models`);
    process.exit(1);
  }
  const staged = await stage(src);
  if (staged.sha256 !== m.sha256) {
    console.error(`checksum mismatch for ${m.file}`);
    process.exit(1);
  }
  models[m.id] = { ...staged, file: m.file, url: m.url, precache: m.precache };
}

const out = { mediapipeVersion: mpPkg.version, wasm, models };
await writeFile(join(genDir, 'runtime-assets.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`staged MediaPipe ${mpPkg.version} WASM and ${Object.keys(models).length} models into public/rt/`);
