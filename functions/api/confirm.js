// Double opt-in for /api/subscribe. The emailed link is HMAC-signed (ALERT_RUN_TOKEN).
// GET only shows a button (so mail scanners that pre-fetch links can't confirm for someone);
// POST does the work: sets confirmed_at, clears unsub_all, and switches on every pending watch.
import { readToken, subKey, kvGet, kvPut, kvListAll, esc } from '../_lib/alerts.js';

const page = (title, body, status = 200) => new Response(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root{color-scheme:dark light}
  body{margin:0;background:#0b0c0e;color:#e8e8e8;font:16px/1.5 system-ui,sans-serif}
  main{max-width:32rem;margin:12vh auto;padding:0 1.25rem}
  h1{font-size:1.25rem;font-weight:650;margin:0 0 .75rem}
  p{margin:0 0 .75rem;color:#c8c8c8}
  a{color:#c8f04a}
  button{background:#c8f04a;color:#0b0c0e;border:0;border-radius:8px;font:650 15px/1 system-ui,sans-serif;padding:12px 18px;cursor:pointer}
</style>
</head><body><main>
<h1>${title}</h1>
${body}
</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

const HOME = '<p><a href="https://ebikepartspicker.net/">Back to eBikePartsPicker</a></p>';
const BAD = () => page('Confirm link invalid', '<p>This confirm link is invalid or has expired. Sign up again on the site to get a new one.</p>' + HOME, 400);

async function check(env, token) {
  if (!env.FORMS || !env.ALERT_RUN_TOKEN) return null;
  const t = await readToken(env, token);
  if (!t || !t.bike.startsWith('confirm:')) return null;
  const sub = await kvGet(env, subKey(t.email));
  if (!sub || sub.confirm_nonce !== t.bike.slice(8)) return null;
  return sub;
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!(await check(env, token))) return BAD();
  return page('Confirm your alerts', `<form method="post" action="/api/confirm"><input type="hidden" name="token" value="${esc(token)}"><p>One click and your eBikePartsPicker alerts are on.</p><button type="submit">Confirm alerts</button></form>`);
}

export async function onRequestPost({ request, env }) {
  let token = new URL(request.url).searchParams.get('token') || '';
  if (!token) { try { token = String((await request.formData()).get('token') || ''); } catch (e) { token = ''; } }
  const sub = await check(env, token);
  if (!sub) return BAD();
  const at = new Date().toISOString();
  if (!sub.confirmed_at || sub.unsub_all) { sub.confirmed_at = sub.confirmed_at || at; sub.unsub_all = false; await kvPut(env, subKey(sub.email), sub); }
  let n = 0;
  for (const k of await kvListAll(env, `w:${sub.email}:`)) {
    const rec = k.metadata || await kvGet(env, k.name);
    if (!rec || rec.active) continue;
    rec.active = true; rec.confirmed = at; n++;
    await env.FORMS.put(k.name, JSON.stringify(rec), { metadata: rec });
  }
  return page('Alerts confirmed', `<p>You're set. ${n ? `${n} alert${n > 1 ? 's are' : ' is'} now on.` : 'Your alerts are on.'} We send at most one digest a week, and every email has an unsubscribe link.</p>` + HOME);
}
