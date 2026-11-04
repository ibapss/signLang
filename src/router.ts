export type Route = 'translate' | 'signs' | 'collect' | 'test';
export const ROUTES: Route[] = ['translate', 'signs', 'collect', 'test'];

/** Hash routes (#/translate) because GitHub Pages has no SPA fallback. */
export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (ROUTES as string[]).includes(name) ? (name as Route) : 'translate';
}
