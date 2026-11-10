// Price-alert sender (Resend free tier). Inert until secrets are set:
//   RESEND_API_KEY  - Resend API key (Pages > Settings > Variables and Secrets, type Secret)
//   ALERT_RUN_TOKEN - random string; caller must send header  Authorization: Bearer <token>
//   ALERT_FROM      - optional override; default "eBikePartsPicker Alerts <alerts@ebikepartspicker.net>"
// POST /api/alerts-run?dry=1 previews without sending. First run per signup just records a baseline price.
import { makeUnsubToken } from '../_lib/unsub-token.js';

const SITE = 'https://ebikepartspicker.net';
const FROM = 'eBikePartsPicker Alerts <alerts@ebikepartspicker.net>';
const REPLY_TO = 'ebikepartspicker@gmail.com';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + Number(n).toLocaleString('en-US');

function textBody(b, was, now, url, unsub) {
  return `${b.name} dropped from ${usd(was)} to ${usd(now)}.\n\n${url}\n\nYou got this because you signed up for price alerts on eBikePartsPicker.\nUnsubscribe: ${unsub}`;
}

function htmlBody(b, was, now, url, unsub) {
  const name = esc(b.name);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Price drop: ${name}</title>
</head>
<body style="margin:0;padding:0;background:#0b0c0e;color:#e8e8e8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0c0e;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141518;border:1px solid #2a2c30;border-radius:12px;">
<tr><td style="padding:28px 28px 8px;font:650 13px/1.3 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#c8f04a;">eBikePartsPicker</td></tr>
<tr><td style="padding:8px 28px 0;font:700 22px/1.3 system-ui,sans-serif;color:#f2f2f2;">${name} dropped in price</td></tr>
<tr><td style="padding:16px 28px 0;font:16px/1.5 system-ui,sans-serif;color:#c8c8c8;">
  Was <span style="text-decoration:line-through;color:#9a9a9a;">${esc(usd(was))}</span>
  &nbsp;&rarr;&nbsp;
  <span style="color:#c8f04a;font-weight:700;">${esc(usd(now))}</span>
</td></tr>
<tr><td style="padding:24px 28px 8px;">
  <a href="${esc(url)}" style="display:inline-block;background:#c8f04a;color:#0b0c0e;text-decoration:none;font:650 15px/1 system-ui,sans-serif;padding:12px 18px;border-radius:8px;">View the bike</a>
</td></tr>
<tr><td style="padding:28px 28px 24px;font:13px/1.5 system-ui,sans-serif;color:#8a8a8a;border-top:1px solid #2a2c30;">
  You got this email because you signed up for price alerts on eBikePartsPicker.
  <a href="${esc(unsub)}" style="color:#c8f04a;">Unsubscribe</a> from alerts for this bike.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export async function onRequestPost({ request, env }) {
  if (!env.ALERT_RUN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ALERT_RUN_TOKEN}`) return j({ ok: false, error: 'unauthorized' }, 401);
  if (!env.FORMS) return j({ ok: false, error: 'storage_not_configured' }, 503);
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const canSend = !!env.RESEND_API_KEY && !dry;
  const origin = new URL(request.url).origin;
  const data = await (await fetch(`${origin}/data/bikes.json`, { cf: { cacheTtl: 0 } })).json();
  const bikes = Object.fromEntries((data.bikes || []).map(b => [b.id, b]));
  const out = { ok: true, sending: canSend, checked: 0, baselined: 0, drops: 0, sent: 0, errors: 0 };
  let cursor;
  do {
    const page = await env.FORMS.list({ prefix: 'alert:', cursor });
    for (const k of page.keys) {
      out.checked++;
      const rec = JSON.parse((await env.FORMS.get(k.name)) || '{}');
      const b = bikes[rec.bike]; const now = b && Number(b.price_usd);
      if (!now) continue;
      if (!rec.lastPrice) { rec.lastPrice = now; out.baselined++; if (!dry) await env.FORMS.put(k.name, JSON.stringify(rec)); continue; }
      if (now >= rec.lastPrice) { if (now > rec.lastPrice && !dry) { rec.lastPrice = now; await env.FORMS.put(k.name, JSON.stringify(rec)); } continue; }
      out.drops++;
      if (!canSend) continue;
      const url = `${SITE}/bikes/${b.id}/`;
      const token = await makeUnsubToken(env.ALERT_RUN_TOKEN, rec.email, rec.bike);
      const unsub = `${SITE}/api/unsubscribe?token=${encodeURIComponent(token)}`;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.ALERT_FROM || FROM,
          to: [rec.email],
          reply_to: REPLY_TO,
          subject: `Price drop: ${b.name} now ${usd(now)}`,
          text: textBody(b, rec.lastPrice, now, url, unsub),
          html: htmlBody(b, rec.lastPrice, now, url, unsub),
          headers: {
            'List-Unsubscribe': `<${unsub}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });
      if (r.ok) { out.sent++; rec.lastPrice = now; rec.lastSent = new Date().toISOString(); await env.FORMS.put(k.name, JSON.stringify(rec)); } else out.errors++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return j(out);
}
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
