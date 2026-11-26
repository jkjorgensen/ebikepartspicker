// Shared helpers for the merged signup + price/stock alerts (KV model, Nov 22 batch report, Task 3).
// Storage: the existing FORMS KV namespace. Each record is stored as the KV value AND as KV
// metadata (all records are well under KV's 1,024-byte metadata limit), so /api/alerts-run can read
// everything with list() calls only, no per-key get(). Free-tier budget: 1,000 KV writes/day.
//
// Keys
//   sub:<email_lc>                     {email, created, confirmed_at|null, confirm_nonce, confirm_sent, unsub_all, src_page}
//   w:<email_lc>:bike_price:<bikeId>   {created, active, baseline, ref, last, last_sent}
//   w:<email_lc>:part_price:<pid>      {created, active, baseline, ref, last, last_sent}
//   w:<email_lc>:part_stock:<pid>      {created, active, last_stock, last_sent}
//   w:<email_lc>:news                  {created, active, last_sent}
//   meta:news:first_seen               {bikes:{id:date}, parts:{pid:date}}  (what counts as "new" for news digests)
//   cap:sub:<YYYY-MM-DD>               signup counter (expires after 2 days)
// "active" stays false until the address clicks the double opt-in link; "ref" is the price the
// subscriber was last told about (starts at the signup baseline, rises with price increases).
import { makeUnsubToken, readUnsubToken } from './unsub-token.js';

export const SITE = 'https://ebikepartspicker.net';
export const FROM = 'eBikePartsPicker Alerts <alerts@ebikepartspicker.net>';
export const REPLY_TO = 'ebikepartspicker@gmail.com';
export const KINDS = ['bike_price', 'part_price', 'part_stock', 'news'];

export const s = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
// No ':' or '|' so the address can't break the key or token format.
export const okEmail = e => /^[^\s@:|]{1,64}@[^\s@:|]{1,190}\.[a-z]{2,}$/i.test(e);
export const okId = id => /^[a-z0-9][a-z0-9._-]{0,150}$/i.test(id);
export const lc = e => String(e).toLowerCase().trim();
export const subKey = email => `sub:${lc(email)}`;
export const watchKey = (email, kind, target) => kind === 'news' ? `w:${lc(email)}:news` : `w:${lc(email)}:${kind}:${target}`;
export function parseWatchKey(name) {
  // w:<email>:<kind>[:<target>]   (email has no ':')
  const m = /^w:([^:]+):(bike_price|part_price|part_stock|news)(?::(.+))?$/.exec(name);
  return m ? { email: m[1], kind: m[2], target: m[3] || '' } : null;
}

export const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
export const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const usd = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// Everything the signup flow needs. GET /api/subscribe reports enabled:false until all are set.
export const missingConfig = env => ['FORMS', 'RESEND_API_KEY', 'ALERT_RUN_TOKEN', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET'].filter(k => !env[k]);

export async function kvPut(env, key, rec, opts = {}) {
  await env.FORMS.put(key, JSON.stringify(rec), { ...opts, metadata: rec });
}
export async function kvGet(env, key) {
  const v = await env.FORMS.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
// list() every key under a prefix with its metadata (1 KV op per 1,000 keys)
export async function kvListAll(env, prefix) {
  const out = []; let cursor;
  do {
    const page = await env.FORMS.list({ prefix, cursor });
    for (const k of page.keys) out.push(k);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

// Static catalog files from this same deploy (ASSETS when available, else a plain fetch).
export async function loadJson(env, origin, path) {
  const url = new URL(path, origin).toString();
  const r = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url, { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
export async function loadCatalog(env, origin, need = { bikes: true, parts: true }) {
  const [b, p] = await Promise.all([
    need.bikes ? loadJson(env, origin, '/data/bikes.json') : null,
    need.parts ? loadJson(env, origin, '/data/parts.json') : null,
  ]);
  const bikes = b ? Object.fromEntries((Array.isArray(b) ? b : b.bikes || []).map(x => [x.id, x])) : {};
  return { bikes, parts: (p && p.parts) || {} };
}

export async function verifyTurnstile(env, token, ip) {
  if (!token) return { ok: false, error: 'turnstile_missing', status: 400 };
  try {
    const body = new FormData(); body.append('secret', env.TURNSTILE_SECRET); body.append('response', token); if (ip) body.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const tv = await r.json();
    return tv.success ? { ok: true } : { ok: false, error: 'turnstile_failed', status: 403 };
  } catch (e) { return { ok: false, error: 'turnstile_unavailable', status: 502 }; }
}

// Signed links (HMAC with ALERT_RUN_TOKEN, same scheme as the original bike unsubscribe links).
// Targets: 'confirm:<nonce>' (double opt-in), 'w:<kind>:<target>' (one watch), '*' (everything),
// or a bare bike id (legacy alert:<email>:<bike> links already in people's inboxes).
export const confirmUrl = async (env, email, nonce) =>
  `${SITE}/api/confirm?token=${encodeURIComponent(await makeUnsubToken(env.ALERT_RUN_TOKEN, email, `confirm:${nonce}`))}`;
export const unsubUrl = async (env, email, target) =>
  `${SITE}/api/unsubscribe?token=${encodeURIComponent(await makeUnsubToken(env.ALERT_RUN_TOKEN, email, target))}`;
export const readToken = (env, token) => readUnsubToken(env.ALERT_RUN_TOKEN, token);

export async function resendSend(env, msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(msg),
  });
  return r.ok;
}
// Up to 100 messages in one request (one subrequest), returns how many were accepted.
export async function resendBatch(env, msgs) {
  if (!msgs.length) return 0;
  const r = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(msgs),
  });
  return r.ok ? msgs.length : 0;
}

export function shell(title, inner, footer) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0c0e;color:#e8e8e8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c0e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#141518;border:1px solid #2a2c30;border-radius:12px;">
<tr><td style="padding:28px 28px 8px;font:650 13px/1.3 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#c8f04a;">eBikePartsPicker</td></tr>
${inner}
<tr><td style="padding:24px 28px 24px;font:13px/1.5 system-ui,sans-serif;color:#8a8a8a;border-top:1px solid #2a2c30;">${footer}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function confirmEmail(env, email, link, watches) {
  const what = watches.map(w => `- ${w}`).join('\n');
  const text = `Please confirm your eBikePartsPicker alerts:\n${what}\n\nConfirm: ${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent.`;
  const html = shell('Confirm your alerts',
    `<tr><td style="padding:8px 28px 0;font:700 22px/1.3 system-ui,sans-serif;color:#f2f2f2;">Confirm your alerts</td></tr>
<tr><td style="padding:16px 28px 0;font:16px/1.5 system-ui,sans-serif;color:#c8c8c8;">You asked for:<ul style="margin:8px 0 0;padding-left:20px;">${watches.map(w => `<li>${esc(w)}</li>`).join('')}</ul></td></tr>
<tr><td style="padding:24px 28px 8px;"><a href="${esc(link)}" style="display:inline-block;background:#c8f04a;color:#0b0c0e;text-decoration:none;font:650 15px/1 system-ui,sans-serif;padding:12px 18px;border-radius:8px;">Confirm alerts</a></td></tr>`,
    "If you didn't ask for this, ignore this email. Nothing is sent until you confirm.");
  return { from: env.ALERT_FROM || FROM, to: [email], reply_to: REPLY_TO, subject: 'Confirm your eBikePartsPicker alerts', text, html };
}

export function watchLabel(kind, target, cat) {
  const bn = cat.bikes[target]?.name || target, pn = cat.parts[target]?.n || target;
  if (kind === 'bike_price') return `Price drops on the ${bn}`;
  if (kind === 'part_price') return `Price drops on ${pn}`;
  if (kind === 'part_stock') return `${pn} back in stock`;
  return 'New bikes and parts (at most monthly)';
}
export const watchUrl = (kind, target, cat) =>
  kind === 'bike_price' ? `${SITE}/bikes/${encodeURIComponent(target)}/`
  : kind === 'news' ? `${SITE}/`
  : cat.parts[target] ? `${SITE}/parts/${encodeURIComponent(cat.parts[target].c)}/${encodeURIComponent(target)}/` : `${SITE}/`;
