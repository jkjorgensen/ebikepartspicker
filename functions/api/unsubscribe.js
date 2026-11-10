// Price-alert unsubscribe. Token is HMAC-signed (ALERT_RUN_TOKEN) so the URL cannot be guessed.
// GET: delete the alert key and show a short confirmation page.
// POST: one-click unsubscribe (RFC 8058); 200 with an empty body.
import { readUnsubToken, alertKey } from '../_lib/unsub-token.js';

const page = (title, body) => new Response(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${title}</title>
<style>
  :root{color-scheme:dark light}
  body{margin:0;background:#0b0c0e;color:#e8e8e8;font:16px/1.5 system-ui,sans-serif}
  main{max-width:32rem;margin:12vh auto;padding:0 1.25rem}
  h1{font-size:1.25rem;font-weight:650;margin:0 0 .75rem}
  p{margin:0 0 .75rem;color:#c8c8c8}
  a{color:#c8f04a}
</style>
</head><body><main>
<h1>${title}</h1>
${body}
</main></body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

async function unsub(env, token) {
  if (!env.ALERT_RUN_TOKEN) return { ok: false, reason: 'misconfigured' };
  if (!env.FORMS) return { ok: false, reason: 'storage' };
  const rec = await readUnsubToken(env.ALERT_RUN_TOKEN, token);
  if (!rec) return { ok: false, reason: 'invalid' };
  await env.FORMS.delete(alertKey(rec.email, rec.bike));
  return { ok: true, bike: rec.bike };
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token') || '';
  const r = await unsub(env, token);
  if (!r.ok) {
    return page('Unsubscribe link invalid', '<p>This unsubscribe link is invalid or has already been used.</p><p><a href="https://ebikepartspicker.net/">Back to eBikePartsPicker</a></p>');
  }
  return page('You are unsubscribed', '<p>You will no longer get price-alert emails for that bike from eBikePartsPicker.</p><p><a href="https://ebikepartspicker.net/">Back to eBikePartsPicker</a></p>');
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  let token = url.searchParams.get('token') || '';
  if (!token) {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('text/plain')) {
      const body = await request.text();
      const params = new URLSearchParams(body);
      token = params.get('token') || '';
    }
  }
  const r = await unsub(env, token);
  if (!r.ok) return new Response('', { status: 400, headers: { 'cache-control': 'no-store' } });
  return new Response('', { status: 200, headers: { 'cache-control': 'no-store' } });
}
