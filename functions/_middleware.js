// 301 www and the production pages.dev host to the apex custom domain.
// Preview deploys (*.ebikepartspicker.pages.dev) are left alone.
// /api/* is left alone so scheduled/price-alert hooks keep working during the cutover.
const APEX_HOST = 'ebikepartspicker.net';
const REDIRECT_HOSTS = new Set([
  'www.ebikepartspicker.net',
  'ebikepartspicker.pages.dev',
]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
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
