// Form intake for contact, part reports and price/stock alert signups. Free.
// Storage: Workers KV namespace bound as FORMS (Pages > Settings > Bindings).
// If FORMS is not bound yet, returns 503 and the page falls back to the email app.
const TYPES = { contact: ['name', 'email', 'message'], report: ['part', 'bike', 'problem', 'source', 'email'], alert: ['email', 'bike', 'build'] };
const s = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const okEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e);
export async function onRequestPost({ request, env }) {
  let d; try { d = await request.json(); } catch (e) { return j({ ok: false, error: 'bad_request' }, 400); }
  const type = s(d.type, 20); if (!TYPES[type]) return j({ ok: false, error: 'bad_type' }, 400);
  if (s(d.website)) return j({ ok: true }); // honeypot: silently drop bots
  const rec = { type, at: new Date().toISOString(), page: s(d.page, 200) };
  for (const k of TYPES[type]) rec[k] = s(d[k]);
  if ((type === 'alert' || rec.email) && !okEmail(rec.email)) return j({ ok: false, error: 'bad_email' }, 400);
  if (type === 'contact' && !rec.message) return j({ ok: false, error: 'missing' }, 400);
  if (type === 'report' && !rec.problem) return j({ ok: false, error: 'missing' }, 400);
  if (!env.FORMS) return j({ ok: false, error: 'storage_not_configured' }, 503);
  const key = type === 'alert' ? `alert:${rec.email.toLowerCase()}:${rec.bike || 'any'}` : `${type}:${rec.at}:${crypto.randomUUID().slice(0, 8)}`;
  await env.FORMS.put(key, JSON.stringify(rec));
  return j({ ok: true });
}
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
