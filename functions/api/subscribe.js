// Merged signup: site news + bike price drops + part price drops + part back-in-stock, one email field.
// Free tier only: FORMS KV + Turnstile + Resend free (3,000/mo, 100/day). Double opt-in: every new
// watch is stored inactive and nothing is sent until the address clicks the confirm link.
//
// Needs (Pages > Settings > Variables and Bindings). Until ALL are set, GET says enabled:false and POST returns 503:
//   FORMS               KV binding (same namespace as /api/submit and /api/build-submit)
//   RESEND_API_KEY      secret (sends the confirm email)
//   ALERT_RUN_TOKEN     secret (signs confirm/unsubscribe links; same token as /api/alerts-run)
//   TURNSTILE_SITE_KEY  plain, TURNSTILE_SECRET secret (same widget as the build form)
//   SUB_DAILY_CAP       optional, default 100 signups/day (<=5 KV writes each, keeps under 1,000 writes/day)
//
// GET  /api/subscribe  -> {ok, enabled, siteKey, kinds}
// POST /api/subscribe  JSON or form fields:
//   email, news (bool), bike (bike id, price drops), part (pid), part_price (bool), part_stock (bool),
//   page, website (honeypot), cf-turnstile-response (or turnstile)
//   -> {ok:true, status:'confirm_sent'}   (same answer whether or not the address was known)
import { s, okEmail, okId, lc, subKey, watchKey, j, missingConfig, kvGet, kvPut, loadCatalog, verifyTurnstile,
  confirmEmail, confirmUrl, resendSend, watchLabel } from '../_lib/alerts.js';

const RESEND_COOLDOWN_MS = 10 * 60 * 1000; // don't re-send the confirm email more than once per 10 min per address
const truthy = v => v === true || /^(1|true|on|yes)$/i.test(String(v ?? ''));

export async function onRequestGet({ env }) {
  const enabled = missingConfig(env).length === 0;
  return j({ ok: true, enabled, siteKey: enabled ? String(env.TURNSTILE_SITE_KEY) : null, kinds: ['news', 'bike_price', 'part_price', 'part_stock'] });
}

async function readBody(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await request.json();
  const fd = await request.formData(); const o = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') o[k] = v;
  return o;
}

export async function onRequestPost({ request, env }) {
  if (missingConfig(env).length) return j({ ok: false, enabled: false, error: 'not_configured' }, 503);
  if (Number(request.headers.get('content-length') || 0) > 16 * 1024) return j({ ok: false, error: 'too_large' }, 413);
  let d; try { d = await readBody(request); } catch (e) { return j({ ok: false, error: 'bad_request' }, 400); }
  if (s(d.website)) return j({ ok: true, status: 'confirm_sent' }); // honeypot

  const email = s(d.email, 254);
  if (!okEmail(email)) return j({ ok: false, error: 'bad_email' }, 400);
  const bike = s(d.bike, 120), part = s(d.part, 160);
  const want = [];
  if (truthy(d.news)) want.push(['news', '']);
  if (bike) { if (!okId(bike)) return j({ ok: false, error: 'bad_bike' }, 400); want.push(['bike_price', bike]); }
  if (part && (truthy(d.part_price) || truthy(d.part_stock))) {
    if (!okId(part)) return j({ ok: false, error: 'bad_part' }, 400);
    if (truthy(d.part_price)) want.push(['part_price', part]);
    if (truthy(d.part_stock)) want.push(['part_stock', part]);
  }
  if (!want.length) return j({ ok: false, error: 'nothing_selected' }, 400);

  const tv = await verifyTurnstile(env, s(d['cf-turnstile-response'] || d.turnstile, 4096), request.headers.get('CF-Connecting-IP') || '');
  if (!tv.ok) return j({ ok: false, error: tv.error }, tv.status);

  const origin = new URL(request.url).origin;
  let cat;
  try { cat = await loadCatalog(env, origin, { bikes: !!bike, parts: !!part }); } catch (e) { return j({ ok: false, error: 'catalog_unavailable' }, 502); }
  if (bike && !cat.bikes[bike]) return j({ ok: false, error: 'unknown_bike' }, 400);
  if (part && !cat.parts[part]) return j({ ok: false, error: 'unknown_part' }, 400);

  const now = new Date(), at = now.toISOString(), day = at.slice(0, 10);
  const capKey = `cap:sub:${day}`, cap = Math.max(1, Number(env.SUB_DAILY_CAP) || 100);
  const used = Number(await env.FORMS.get(capKey)) || 0;
  if (used >= cap) return j({ ok: false, error: 'daily_limit' }, 429);

  // subscriber record
  const sk = subKey(email);
  let sub = await kvGet(env, sk);
  let subDirty = false;
  if (!sub) {
    sub = { email: lc(email), created: at, confirmed_at: null, confirm_nonce: crypto.randomUUID().replace(/-/g, '').slice(0, 16), confirm_sent: null, unsub_all: false, src_page: s(d.page, 160) };
    subDirty = true;
  }

  // watches: new ones start inactive with a baseline taken now; existing ones are left alone
  const added = [];
  for (const [kind, target] of want) {
    const wk = watchKey(email, kind, target);
    const cur = await kvGet(env, wk);
    if (cur && cur.active && !sub.unsub_all) continue;
    let rec = cur && !cur.active ? cur : { created: at, active: false };
    if (kind === 'bike_price') { const p = Number(cat.bikes[target].price_usd) || null; rec = { ...rec, baseline: p, ref: p, last: p, last_sent: rec.last_sent || null }; }
    if (kind === 'part_price') { const p = cat.parts[target].p ?? null; rec = { ...rec, baseline: p, ref: p, last: p, last_sent: rec.last_sent || null }; }
    if (kind === 'part_stock') rec = { ...rec, last_stock: cat.parts[target].s || null, last_sent: rec.last_sent || null };
    if (kind === 'news') rec = { ...rec, last_sent: rec.last_sent || null };
    rec.active = false;
    await kvPut(env, wk, rec);
    added.push(watchLabel(kind, target, cat));
  }

  if (added.length) {
    const recent = sub.confirm_sent && (now - new Date(sub.confirm_sent)) < RESEND_COOLDOWN_MS;
    if (!recent) {
      const link = await confirmUrl(env, sub.email, sub.confirm_nonce);
      const ok = await resendSend(env, confirmEmail(env, sub.email, link, added));
      if (ok) { sub.confirm_sent = at; subDirty = true; }
      else if (subDirty) { await kvPut(env, sk, sub); return j({ ok: false, error: 'email_failed' }, 502); }
      else return j({ ok: false, error: 'email_failed' }, 502);
    }
    await env.FORMS.put(capKey, String(used + 1), { expirationTtl: 172800 });
  }
  if (subDirty) await kvPut(env, sk, sub);
  return j({ ok: true, status: 'confirm_sent' });
}
