// Price-alert sender (Resend free tier). Inert until secrets are set:
//   RESEND_API_KEY  - Resend API key (Pages > Settings > Variables and Secrets, type Secret)
//   ALERT_RUN_TOKEN - random string; caller must send header  Authorization: Bearer <token>
//   ALERT_FROM      - optional, e.g. "eBikePartsPicker <alerts@yourdomain.com>"; default onboarding@resend.dev (test only: delivers to Resend account owner only)
// POST /api/alerts-run?dry=1 previews without sending. First run per signup just records a baseline price.
const SITE = 'https://ebikepartspicker.pages.dev';
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
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.ALERT_FROM || 'eBikePartsPicker <onboarding@resend.dev>', to: [rec.email],
          subject: `Price drop: ${b.name} now $${now.toLocaleString('en-US')}`,
          text: `${b.name} dropped from $${rec.lastPrice.toLocaleString('en-US')} to $${now.toLocaleString('en-US')}.\n\n${SITE}/bikes/${b.id}/\n\nYou signed up for price alerts on eBikePartsPicker. Reply "unsubscribe" to stop.`,
        }),
      });
      if (r.ok) { out.sent++; rec.lastPrice = now; rec.lastSent = new Date().toISOString(); await env.FORMS.put(k.name, JSON.stringify(rec)); } else out.errors++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return j(out);
}
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
