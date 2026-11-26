// Protected stats for top viewed pages, top clicked buy links, and buy clicks per part / store / bike.
// Auth: Authorization: Bearer $ALERT_RUN_TOKEN (same token as /api/alerts-run).
// Query source: Workers Analytics Engine dataset ebpp_clicks, via the
// Cloudflare SQL API. Requires Pages secrets CF_ACCOUNT_ID and
// CF_ANALYTICS_TOKEN (Account → Account Analytics → Read). No personal data.
const DATASET = 'ebpp_clicks';

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  const token = (env.ALERT_RUN_TOKEN || '').trim();
  if (!token || auth !== `Bearer ${token}`) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const account = (env.CF_ACCOUNT_ID || '').trim();
  const aeToken = (env.CF_ANALYTICS_TOKEN || '').trim();
  if (!account || !aeToken) {
    return json({
      ok: false,
      error: 'analytics_token_missing',
      hint: 'Add free Pages secrets CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN (Account Analytics Read). You can also run: python3 scripts/query_stats.py',
    }, 503);
  }
  const days = clampDays(new URL(request.url).searchParams.get('days'));
  try {
    const [views, bikes, parts, clicks, byPart, byStore, byPartStore, byBike] = await Promise.all([
      aeQuery(account, aeToken, viewsSql(days, "blob3 IN ('bike','part','category','home','guide','builder') OR blob5 = 'builder'")),
      aeQuery(account, aeToken, viewsSql(days, "blob3 = 'bike'")),
      aeQuery(account, aeToken, viewsSql(days, "blob3 = 'part'")),
      aeQuery(account, aeToken, clicksSql(days)),
      aeQuery(account, aeToken, buySql(days, 'blob2', 'part')),
      aeQuery(account, aeToken, buySql(days, 'blob3', 'store')),
      aeQuery(account, aeToken, buySql(days, 'blob2, blob3', 'part, store')),
      aeQuery(account, aeToken, buySql(days, 'blob4', 'bike')),
    ]);
    return json({
      ok: true,
      days,
      top_views: rows(views, 'page', 'kind', 'views'),
      top_bikes: rows(bikes, 'page', 'kind', 'views'),
      top_parts: rows(parts, 'page', 'kind', 'views'),
      top_buy_clicks: rows(clicks, 'host', 'path', 'clicks'),
      // Per-part / per-store buy clicks from /api/buy (part '' = could not be matched to a part;
      // bike '' = click came from a page with no bike, e.g. a part page).
      buy_clicks_by_part: cols(byPart, ['part']),
      buy_clicks_by_store: cols(byStore, ['store']),
      buy_clicks_by_part_store: cols(byPartStore, ['part', 'store']),
      buy_clicks_by_bike: cols(byBike, ['bike']),
    });
  } catch (e) {
    return json({ ok: false, error: 'query_failed', message: String(e).slice(0, 300) }, 502);
  }
}

function clampDays(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 7;
  return Math.min(30, Math.max(1, n));
}
function viewsSql(days, where) {
  return `SELECT blob2 AS page, blob3 AS kind, SUM(_sample_interval) AS views
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
  AND index1 = 'view' AND blob1 = 'view' AND (${where})
GROUP BY blob2, blob3
ORDER BY views DESC
LIMIT 25`;
}
function clicksSql(days) {
  return `SELECT blob1 AS host, blob2 AS path, SUM(_sample_interval) AS clicks
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
  AND index1 != 'view' AND index1 != 'buy' AND blob1 != 'view' AND blob1 != 'buy'
GROUP BY blob1, blob2
ORDER BY clicks DESC
LIMIT 25`;
}
// Buy clicks written by /api/buy: blob2 part, blob3 store, blob4 bike (see functions/api/buy.js).
// `expr` is the blob column(s) to group by, `names` the matching output aliases.
function buySql(days, expr, names) {
  const cols = expr.split(',').map(x => x.trim());
  const as = names.split(',').map(x => x.trim());
  const sel = cols.map((c, i) => `${c} AS ${as[i]}`).join(', ');
  return `SELECT ${sel}, SUM(_sample_interval) AS clicks
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
  AND index1 = 'buy' AND blob1 = 'buy'
GROUP BY ${cols.join(', ')}
ORDER BY clicks DESC
LIMIT 50`;
}
async function aeQuery(account, token, sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    body: sql,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(text.slice(0, 200)); }
  if (!res.ok || data.success === false) {
    const msg = (data.errors && data.errors[0] && data.errors[0].message) || text.slice(0, 200);
    throw new Error(msg);
  }
  return data.data || data;
}
function rows(data, a, b, n) {
  const list = Array.isArray(data) ? data : [];
  return list.map(r => ({ [a]: r[a], [b]: r[b], count: Number(r[n] || r.count || 0) }));
}
function cols(data, keys) {
  const list = Array.isArray(data) ? data : [];
  return list.map(r => { const o = {}; keys.forEach(k => { o[k] = r[k] == null ? '' : r[k]; }); o.clicks = Number(r.clicks || 0); return o; });
}
const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
