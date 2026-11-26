// Weekly alerts digest (merged signup, Nov 22 batch report Task 3). Free tier only: FORMS KV + Resend free.
// Auth: Authorization: Bearer <ALERT_RUN_TOKEN> (same token as /api/stats).
//
// Needs (Pages > Settings > Variables and Bindings):
//   FORMS            KV binding. Missing -> 503 {enabled:false}.
//   ALERT_RUN_TOKEN  secret. Missing -> every call is 401.
//   RESEND_API_KEY   secret. Missing -> the run still evaluates (like ?dry=1) and reports sending:false.
//   ALERT_FROM       optional sender override (default "eBikePartsPicker Alerts <alerts@ebikepartspicker.net>",
//                    the domain must be verified in Resend)
//   ALERTS_MAX_SEND  optional, default 90 emails per run (Resend free = 100/day)
//   ALERTS_MAX_WRITES optional, default 500 KV writes per run (KV free = 1,000 writes/day)
//
// POST /api/alerts-run          evaluate every watch and send ONE digest per subscriber
// POST /api/alerts-run?dry=1    same evaluation, writes nothing, sends nothing, returns a preview
//
// Rules: price drop fires when the price is below the last-notified price (ref) by >= $5 or >= 3%;
// back in stock fires on out_of_stock -> in_stock; news fires when bikes/parts were added since the
// last news email, at most every 28 days; any one watch emails at most once per 7 days.
// Prices/stock come from this deploy's data/bikes.json (price_usd) and data/parts.json
// (node scripts/build_parts_json.mjs), so nothing is scraped at send time.
// Legacy alert:<email>:<bike> keys (from forms.js via /api/submit) are migrated one-to-one to
// w:<email>:bike_price:<bike> on each real run, and get one double opt-in email before any digest.
import { SITE, FROM, REPLY_TO, j, esc, usd, okEmail, lc, subKey, watchKey, parseWatchKey, kvListAll, kvGet,
  loadCatalog, confirmUrl, confirmEmail, unsubUrl, resendBatch, shell, watchLabel, watchUrl } from '../_lib/alerts.js';

const DAY = 864e5, WATCH_GAP = 7 * DAY, NEWS_GAP = 28 * DAY;
const dropFires = (ref, now) => ref > now && (ref - now >= 5 || (ref - now) / ref >= 0.03);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mask = e => e.replace(/^(.).*?(.)?@/, (m, a, b) => `${a}***${b || ''}@`);

export async function onRequestPost({ request, env }) {
  const token = (env.ALERT_RUN_TOKEN || '').trim();
  if (!token || request.headers.get('authorization') !== `Bearer ${token}`) return j({ ok: false, error: 'unauthorized' }, 401);
  if (!env.FORMS) return j({ ok: false, enabled: false, error: 'storage_not_configured' }, 503);
  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const canSend = !!env.RESEND_API_KEY && !dry;
  const maxSend = Math.max(0, Number(env.ALERTS_MAX_SEND) || 90);
  const maxWrites = Math.max(10, Number(env.ALERTS_MAX_WRITES) || 500);
  let cat;
  try { cat = await loadCatalog(env, url.origin); } catch (e) { return j({ ok: false, error: 'catalog_unavailable', message: String(e).slice(0, 200) }, 502); }
  const now = new Date(), at = now.toISOString(), today = at.slice(0, 10);

  const out = { ok: true, dry, sending: canSend, subscribers: 0, confirmed: 0, watches: 0, legacy_found: 0, legacy_migrated: 0,
    baselined: 0, price_drops: 0, restocks: 0, news_new: 0, rate_limited: 0, digests: 0, confirms: 0, sent: 0, deferred: 0,
    errors: 0, kv_writes: 0, truncated: false };
  let writes = 0;
  const put = async (key, rec) => {
    if (dry) return true;
    if (writes >= maxWrites) { out.truncated = true; return false; }
    writes++; await env.FORMS.put(key, JSON.stringify(rec), { metadata: rec }); return true;
  };

  // 1) subscribers + watches (metadata only, no per-key reads)
  const subs = new Map();
  for (const k of await kvListAll(env, 'sub:')) { const r = k.metadata || await kvGet(env, k.name); if (r) subs.set(k.name.slice(4), { key: k.name, rec: r }); }
  const watches = new Map(); // email -> [{key, kind, target, rec}]
  const addWatch = (email, w) => { if (!watches.has(email)) watches.set(email, []); watches.get(email).push(w); };
  for (const k of await kvListAll(env, 'w:')) {
    const p = parseWatchKey(k.name); if (!p) continue;
    const r = k.metadata || await kvGet(env, k.name); if (!r) continue;
    addWatch(p.email, { key: k.name, kind: p.kind, target: p.target, rec: r });
  }

  // 2) migrate legacy alert:<email>:<bike> keys
  for (const k of await kvListAll(env, 'alert:')) {
    out.legacy_found++;
    if (dry) continue;
    if (writes + 3 > maxWrites) { out.truncated = true; break; }
    const old = await kvGet(env, k.name) || {};
    const email = lc(old.email || ''), bike = String(old.bike || '');
    if (okEmail(email) && cat.bikes[bike]) {
      if (!subs.has(email)) {
        const rec = { email, created: old.at || at, confirmed_at: null, confirm_nonce: crypto.randomUUID().replace(/-/g, '').slice(0, 16), confirm_sent: null, unsub_all: false, src_page: String(old.page || 'legacy alert form').slice(0, 160), legacy: true };
        await put(subKey(email), rec); subs.set(email, { key: subKey(email), rec });
      }
      const wk = watchKey(email, 'bike_price', bike);
      if (!(watches.get(email) || []).some(w => w.key === wk)) {
        const p = Number(old.lastPrice) || Number(cat.bikes[bike].price_usd) || null;
        const rec = { created: old.at || at, active: false, baseline: p, ref: p, last: p, last_sent: old.lastSent || null, legacy: true };
        await put(wk, rec); addWatch(email, { key: wk, kind: 'bike_price', target: bike, rec });
      }
    }
    await env.FORMS.delete(k.name); writes++;
    out.legacy_migrated++;
  }

  // 3) "new on the site" tracking for news watches: first date each bike/part id was seen by a run
  const NK = 'meta:news:first_seen';
  let seen = await kvGet(env, NK); let seenDirty = false; const firstRun = !seen;
  if (!seen) { seen = { bikes: {}, parts: {} }; seenDirty = true; }
  for (const id of Object.keys(cat.bikes)) if (!seen.bikes[id]) { seen.bikes[id] = firstRun ? '0' : today; seenDirty = true; }
  for (const id of Object.keys(cat.parts)) if (!seen.parts[id]) { seen.parts[id] = firstRun ? '0' : today; seenDirty = true; }
  if (seenDirty && !dry) { await env.FORMS.put(NK, JSON.stringify(seen)); writes++; }
  const newSince = since => {
    const d = String(since || '').slice(0, 10);
    const b = Object.entries(seen.bikes).filter(([id, t]) => t > d && cat.bikes[id]).map(([id]) => id);
    const p = Object.entries(seen.parts).filter(([id, t]) => t > d && cat.parts[id]).map(([id]) => id);
    return { b, p };
  };

  // 4) evaluate
  const queue = []; // {email, msg, onSent:[[key, rec]], kind}
  const preview = [];
  for (const [email, { key: sk, rec: sub }] of subs) {
    out.subscribers++;
    const ws = watches.get(email) || [];
    if (sub.unsub_all) continue;
    if (!sub.confirmed_at) {
      // migrated legacy signups get exactly one confirm email; /api/subscribe sends its own
      const pending = ws.filter(w => !w.rec.active);
      if (!sub.confirm_sent && pending.length && env.ALERT_RUN_TOKEN) {
        const link = await confirmUrl(env, email, sub.confirm_nonce);
        queue.push({ email, kind: 'confirm', msg: confirmEmail(env, email, link, pending.map(w => watchLabel(w.kind, w.target, cat))), onSent: [[sk, { ...sub, confirm_sent: at }]] });
      }
      continue;
    }
    out.confirmed++;
    const items = [], onSent = [];
    for (const w of ws) {
      if (!w.rec.active) continue;
      out.watches++;
      const r = { ...w.rec };
      const recent = r.last_sent && (now - new Date(r.last_sent)) < WATCH_GAP;
      let item = null;
      if (w.kind === 'bike_price' || w.kind === 'part_price') {
        const cur = w.kind === 'bike_price' ? Number(cat.bikes[w.target]?.price_usd) || null : cat.parts[w.target]?.p ?? null;
        if (cur == null) continue;
        r.last = cur;
        if (r.ref == null) { r.ref = cur; if (r.baseline == null) r.baseline = cur; out.baselined++; }
        else if (cur > r.ref) r.ref = cur; // price went up: next drop is measured from the higher price
        else if (dropFires(r.ref, cur)) {
          out.price_drops++;
          if (recent) out.rate_limited++;
          else item = { kind: w.kind, target: w.target, was: r.ref, now: cur, after: { ...r, ref: cur, last_sent: at } };
        }
      } else if (w.kind === 'part_stock') {
        const st = cat.parts[w.target]?.s || '';
        if (r.last_stock == null && (st === 'in_stock' || st === 'out_of_stock')) { r.last_stock = st; out.baselined++; }
        else if (r.last_stock === 'out_of_stock' && st === 'in_stock') {
          out.restocks++;
          if (recent) out.rate_limited++;
          else item = { kind: w.kind, target: w.target, after: { ...r, last_stock: 'in_stock', last_sent: at } };
        } else if (st === 'in_stock' || st === 'out_of_stock') r.last_stock = st; // unknown/verify never overwrite a real reading
      } else if (w.kind === 'news') {
        if (firstRun || (r.last_sent && (now - new Date(r.last_sent)) < NEWS_GAP)) { /* not due */ }
        else {
          const n = newSince(r.last_sent || r.confirmed || r.created);
          if (n.b.length || n.p.length) { out.news_new++; item = { kind: 'news', target: '', news: n, after: { ...r, last_sent: at } }; }
        }
      }
      if (!same(r, w.rec)) { await put(w.key, r); w.rec = r; }
      if (item) { items.push(item); onSent.push([w.key, item.after]); }
    }
    if (!items.length) continue;
    out.digests++;
    const msg = await digest(env, email, items, cat);
    queue.push({ email, kind: 'digest', msg, onSent });
    if (dry && preview.length < 5) preview.push({ to: mask(email), subject: msg.subject, lines: msg.text.split('\n').filter(l => l.startsWith('- ')) });
  }
  out.confirms = queue.filter(q => q.kind === 'confirm').length;

  // 5) send (Resend batch API, <=100 per request), then record last_sent only for what was accepted
  if (canSend) {
    const now_ = queue.slice(0, maxSend);
    out.deferred = queue.length - now_.length;
    for (let i = 0; i < now_.length; i += 100) {
      const chunk = now_.slice(i, i + 100);
      const n = await resendBatch(env, chunk.map(q => q.msg));
      if (!n) { out.errors += chunk.length; continue; }
      out.sent += n;
      for (const q of chunk) for (const [k, rec] of q.onSent) await put(k, rec);
    }
  } else out.deferred = queue.length;

  out.kv_writes = writes;
  if (dry) out.preview = preview;
  return j(out);
}

// Unauthenticated GET only says whether the run is wired up (no subscriber data).
export async function onRequestGet({ env }) {
  return j({ ok: true, enabled: !!(env.FORMS && env.ALERT_RUN_TOKEN && env.RESEND_API_KEY), method: 'POST with Authorization: Bearer <ALERT_RUN_TOKEN>' });
}

async function digest(env, email, items, cat) {
  const rows = [], lines = [];
  for (const it of items) {
    const unsub = await unsubUrl(env, email, it.kind === 'news' ? 'w:news' : `w:${it.kind}:${it.target}`);
    const link = watchUrl(it.kind, it.target, cat);
    let title, detail, dtext;
    if (it.kind === 'bike_price' || it.kind === 'part_price') {
      const name = it.kind === 'bike_price' ? cat.bikes[it.target].name : cat.parts[it.target].n;
      const store = it.kind === 'part_price' && cat.parts[it.target].v ? ` at ${cat.parts[it.target].v}` : '';
      title = `${name} dropped in price`;
      detail = `Was <span style="text-decoration:line-through;color:#9a9a9a;">${esc(usd(it.was))}</span> &rarr; <span style="color:#c8f04a;font-weight:700;">${esc(usd(it.now))}</span>${esc(store)}`;
      dtext = `${name}: ${usd(it.was)} -> ${usd(it.now)}${store}`;
    } else if (it.kind === 'part_stock') {
      const p = cat.parts[it.target];
      title = `${p.n} is back in stock`;
      const extra = p.p != null ? ` from ${usd(p.p)}${p.v ? ` at ${p.v}` : ''}` : '';
      detail = `In stock at our last check${esc(extra)}.`;
      dtext = `${p.n} is back in stock${extra}`;
    } else {
      const nb = it.news.b.length, np = it.news.p.length;
      const names = [...it.news.b.map(id => [cat.bikes[id].name, `${SITE}/bikes/${id}/`]), ...it.news.p.map(id => [cat.parts[id].n, watchUrl('part_price', id, cat)])].slice(0, 8);
      title = `New on eBikePartsPicker: ${[nb && `${nb} bike${nb > 1 ? 's' : ''}`, np && `${np} part${np > 1 ? 's' : ''}`].filter(Boolean).join(' and ')}`;
      detail = names.map(([n, u]) => `<a href="${esc(u)}" style="color:#e8e8e8;">${esc(n)}</a>`).join('<br>') + (nb + np > names.length ? '<br>and more' : '');
      dtext = `${title}\n${names.map(([n, u]) => `    ${n}: ${u}`).join('\n')}`;
    }
    rows.push(`<tr><td style="padding:16px 28px 0;font:16px/1.5 system-ui,sans-serif;color:#c8c8c8;">
<div style="font:700 17px/1.35 system-ui,sans-serif;color:#f2f2f2;"><a href="${esc(link)}" style="color:#f2f2f2;text-decoration:none;">${esc(title)}</a></div>
<div>${detail}</div>
<div style="font-size:13px;margin-top:4px;"><a href="${esc(link)}" style="color:#c8f04a;">View</a> &middot; <a href="${esc(unsub)}" style="color:#8a8a8a;">Stop this alert</a></div>
</td></tr>`);
    lines.push(`- ${dtext}\n  ${link}\n  Stop this alert: ${unsub}`);
  }
  const all = await unsubUrl(env, email, '*');
  const subject = items.length === 1
    ? (items[0].kind === 'part_stock' ? `Back in stock: ${cat.parts[items[0].target].n}`
      : items[0].kind === 'news' ? 'New bikes and parts on eBikePartsPicker'
      : `Price drop: ${(items[0].kind === 'bike_price' ? cat.bikes[items[0].target].name : cat.parts[items[0].target].n)} now ${usd(items[0].now)}`)
    : `Your eBikePartsPicker alerts: ${items.length} updates`;
  const html = shell(subject,
    `<tr><td style="padding:8px 28px 0;font:700 22px/1.3 system-ui,sans-serif;color:#f2f2f2;">${esc(items.length === 1 ? 'Your alert' : 'Your alerts this week')}</td></tr>${rows.join('')}<tr><td style="padding:12px 0 0;"></td></tr>`,
    `You got this because you signed up for alerts on eBikePartsPicker. Prices and stock are from our last store check, so confirm on the store page before you buy. <a href="${esc(all)}" style="color:#c8f04a;">Unsubscribe from all alerts</a>.`);
  const text = `Your eBikePartsPicker alerts\n\n${lines.join('\n\n')}\n\nPrices and stock are from our last store check; confirm on the store page before you buy.\nUnsubscribe from all alerts: ${all}`;
  return {
    from: env.ALERT_FROM || FROM, to: [email], reply_to: REPLY_TO, subject, text, html,
    headers: { 'List-Unsubscribe': `<${all}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}
