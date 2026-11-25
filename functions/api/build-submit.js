// "Submit your build" intake with real owner photos. Free tier only: Workers KV + Turnstile.
// No R2. Every submission is stored as PENDING and never published automatically.
//
// Needs (Pages project > Settings, set by the site owner; nothing here is a secret):
//   FORMS               KV namespace binding (same one /api/submit uses)
//   TURNSTILE_SITE_KEY  Turnstile widget site key (public, plain env var)
//   TURNSTILE_SECRET    Turnstile widget secret key (encrypted secret)
//   BUILD_DAILY_CAP     optional, default 150 submissions/day (keeps KV writes under the free 1,000/day)
// Until FORMS + both Turnstile values are set, GET reports enabled:false and POST returns 503;
// the page then shows an email fallback instead of a broken form.
//
// KV layout (all values small enough for KV's 25 MiB value limit):
//   build:pending:<id>        JSON record, status:'pending'
//   photo:pending:<id>:<n>    WebP bytes (browser-resized to <=1600 px, <=500 KB each), metadata {ct, w, h}
//   cap:build:<YYYY-MM-DD>    daily counter (expires after 2 days)
// Writes per submission = photos (<=4) + record + counter = <=6, so 150/day stays under 1,000 writes/day.

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 500 * 1024;
const MAX_BODY_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + 64 * 1024;
const FIELDS = { name: 80, email: 200, bike: 120, title: 120, parts: 3000, story: 3000, instagram: 80 };
const s = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const okEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const configured = env => !!(env.FORMS && env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY);

export async function onRequestGet({ env }) {
  return j({ ok: true, enabled: configured(env), siteKey: configured(env) ? String(env.TURNSTILE_SITE_KEY) : null,
    maxPhotos: MAX_PHOTOS, maxPhotoBytes: MAX_PHOTO_BYTES, maxPx: 1600 });
}

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return j({ ok: false, error: 'not_configured' }, 503);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return j({ ok: false, error: 'too_large' }, 413);
  let fd; try { fd = await request.formData(); } catch (e) { return j({ ok: false, error: 'bad_request' }, 400); }
  if (s(fd.get('website'))) return j({ ok: true, status: 'pending' }); // honeypot: silently drop bots

  // Turnstile (server-side check; the widget token alone proves nothing)
  const token = s(fd.get('cf-turnstile-response'), 4096);
  if (!token) return j({ ok: false, error: 'turnstile_missing' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  let tv = { success: false };
  try {
    const body = new FormData(); body.append('secret', env.TURNSTILE_SECRET); body.append('response', token); if (ip) body.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    tv = await r.json();
  } catch (e) { return j({ ok: false, error: 'turnstile_unavailable' }, 502); }
  if (!tv.success) return j({ ok: false, error: 'turnstile_failed' }, 403);

  const rec = { type: 'build', status: 'pending', at: new Date().toISOString(), page: s(fd.get('page'), 200) };
  for (const k in FIELDS) rec[k] = s(fd.get(k), FIELDS[k]);
  if (!okEmail(rec.email)) return j({ ok: false, error: 'bad_email' }, 400);
  if (!rec.bike || !rec.parts) return j({ ok: false, error: 'missing' }, 400);
  if (s(fd.get('own_photos')) !== 'yes') return j({ ok: false, error: 'photo_terms' }, 400);

  const files = fd.getAll('photo').filter(f => f && typeof f === 'object' && 'arrayBuffer' in f && f.size > 0);
  if (!files.length) return j({ ok: false, error: 'no_photo' }, 400);
  if (files.length > MAX_PHOTOS) return j({ ok: false, error: 'too_many_photos' }, 400);
  const photos = [];
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) return j({ ok: false, error: 'photo_too_large' }, 413);
    const buf = await f.arrayBuffer(); const b = new Uint8Array(buf);
    // WebP only (the page converts in the browser): "RIFF" .... "WEBP"
    const isWebp = b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    if (!isWebp) return j({ ok: false, error: 'photo_type' }, 415);
    photos.push(buf);
  }

  // daily cap so a burst can't use up the free KV write quota
  const day = rec.at.slice(0, 10), capKey = `cap:build:${day}`, cap = Math.max(1, Number(env.BUILD_DAILY_CAP) || 150);
  const used = Number(await env.FORMS.get(capKey)) || 0;
  if (used >= cap) return j({ ok: false, error: 'daily_limit' }, 429);

  const id = `${rec.at.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
  rec.id = id; rec.photos = [];
  for (let i = 0; i < photos.length; i++) {
    const key = `photo:pending:${id}:${i}`;
    await env.FORMS.put(key, photos[i], { metadata: { ct: 'image/webp', bytes: photos[i].byteLength, id } });
    rec.photos.push(key);
  }
  await env.FORMS.put(`build:pending:${id}`, JSON.stringify(rec));
  await env.FORMS.put(capKey, String(used + 1), { expirationTtl: 172800 });
  return j({ ok: true, status: 'pending', id });
}
