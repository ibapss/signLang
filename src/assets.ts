/** Resolve a path relative to the deployed base (e.g. /signLang/). Never use absolute "/x" URLs. */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  const b = base.endsWith('/') ? base : base + '/';
  return b + path.replace(/^\/+/, '');
}

export interface Progress {
  loaded: number;
  total: number;
}

/**
 * Download several files and report combined progress. `expectedBytes` is used
 * when the server does not send Content-Length (or sends a compressed length).
 */
export async function fetchAllWithProgress(
  items: { url: string; expectedBytes: number }[],
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array[]> {
  const total = items.reduce((s, i) => s + i.expectedBytes, 0);
  const loaded = new Array<number>(items.length).fill(0);
  const report = () => onProgress({ loaded: Math.min(total, loaded.reduce((a, b) => a + b, 0)), total });
  report();
  return Promise.all(
    items.map(async (item, idx) => {
      const res = await fetch(item.url, { signal });
      if (!res.ok) throw new Error(`Download failed (${res.status}) for ${item.url}`);
      if (!res.body) {
        const buf = new Uint8Array(await res.arrayBuffer());
        loaded[idx] = item.expectedBytes;
        report();
        return buf;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.byteLength;
        loaded[idx] = Math.min(got, item.expectedBytes);
        report();
      }
      const out = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      loaded[idx] = item.expectedBytes;
      report();
      return out;
    }),
  );
}

export function formatMB(bytes: number): string {
  return (bytes / 1e6).toFixed(1);
}
