// Serves dist/ under /<base>/ the way GitHub Pages does: static files only,
// no SPA fallback, 404 for anything missing. Logs every 404 so tests can fail on them.
//   node scripts/serve-dist.mjs [--port 4173] [--base /signLang/]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const port = Number(opt('port', process.env.PORT ?? 4173));
let base = opt('base', process.env.BASE_PATH ?? '/signLang/');
if (!base.endsWith('/')) base += '/';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.onnx': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.map': 'application/json', '.txt': 'text/plain',
};

const notFound = [];
let bytesServed = 0;
const served = {};
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/__stats/reset') {
    bytesServed = 0;
    for (const k of Object.keys(served)) delete served[k];
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ bytesServed, served, notFound }));
  }
  if (url.pathname === '/__404s') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(notFound));
  }
  if (!url.pathname.startsWith(base)) return miss(res, url.pathname);
  let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return miss(res, url.pathname);
  try {
    const s = await stat(file);
    if (!s.isFile()) return miss(res, url.pathname);
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
      // GitHub Pages sends max-age=600.
      'cache-control': 'max-age=600',
    });
    if (req.method !== 'HEAD') {
      bytesServed += body.length;
      served[url.pathname] = (served[url.pathname] ?? 0) + 1;
    }
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    miss(res, url.pathname);
  }
}).listen(port, () => console.log(`serving dist/ at http://localhost:${port}${base}`));

function miss(res, path) {
  if (!path.endsWith('favicon.ico')) {
    notFound.push(path);
    console.warn(`404 ${path}`);
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}
