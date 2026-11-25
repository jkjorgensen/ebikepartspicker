// Owner-only review of pending build submissions (read-only; nothing is published from here).
// Needs REVIEW_TOKEN (encrypted secret, any long random string) plus the FORMS KV binding.
//   GET /api/build-review?token=...  (or header Authorization: Bearer <token>) -> JSON list of pending records
//   GET /api/build-review?token=...&photo=<key>     -> the WebP photo
// Without REVIEW_TOKEN set, every request gets 404 (endpoint effectively off).
const j = (o, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
function same(a, b) { // constant-time compare
  a = String(a || ''); b = String(b || ''); if (a.length !== b.length || !a.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
export async function onRequestGet({ request, env }) {
  if (!env.REVIEW_TOKEN || !env.FORMS) return new Response('Not found', { status: 404 });
  const u = new URL(request.url);
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!same(auth || u.searchParams.get('token'), env.REVIEW_TOKEN)) return new Response('Not found', { status: 404 });
  const photo = u.searchParams.get('photo');
  if (photo) {
    if (!/^photo:pending:[0-9]{14}-[0-9a-f]{8}:[0-3]$/.test(photo)) return j({ ok: false, error: 'bad_key' }, 400);
    const v = await env.FORMS.get(photo, 'arrayBuffer');
    if (!v) return new Response('Not found', { status: 404 });
    return new Response(v, { headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });
  }
  const list = await env.FORMS.list({ prefix: 'build:pending:', limit: 100 });
  const out = [];
  for (const k of list.keys) { const r = await env.FORMS.get(k.name, 'json'); if (r) out.push(r); }
  return j({ ok: true, count: out.length, builds: out });
}
