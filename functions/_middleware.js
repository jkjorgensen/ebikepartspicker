// 301 www and the production pages.dev host to the apex custom domain.
// Preview deploys (*.ebikepartspicker.pages.dev) are left alone.
// /api/* is left alone so scheduled/price-alert hooks keep working during the cutover.
const APEX_HOST = 'ebikepartspicker.net';
const REDIRECT_HOSTS = new Set([
  'www.ebikepartspicker.net',
  'ebikepartspicker.pages.dev',
]);

// Internal files are not served (Nov 28 audit item 7, Josh approved). 404 on every host, including
// previews. /data/*.csv is blocked, including /data/fitment-audit-2026-10-18.csv.
// Kept public on purpose: /data/bikes.json and other /data/*.json (price-alert function reads bikes.json).
const BLOCKED_PREFIXES = ['/tools/', '/scripts/'];
const BLOCKED_EXACT = new Set(['/readme.md', '/data/seo-fit-snapshot.json', '/tools', '/scripts']);
function isInternal(path) {
  const p = path.toLowerCase();
  if (BLOCKED_EXACT.has(p)) return true;
  if (BLOCKED_PREFIXES.some((x) => p.startsWith(x))) return true;
  return p.startsWith('/data/') && p.endsWith('.csv');
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (isInternal(url.pathname)) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const host = url.hostname.toLowerCase();
  if (!REDIRECT_HOSTS.has(host)) return context.next();
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return context.next();
  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return context.next();
  url.protocol = 'https:';
  url.hostname = APEX_HOST;
  url.port = '';
  return Response.redirect(url.toString(), 301);
}
