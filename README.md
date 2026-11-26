# ebikepartpicker
Electric dirtbike builder and parts configurator

## Signup + price/stock alerts (KV + Turnstile + Resend free tier)
One signup (`POST /api/subscribe`): site news, price drops on a bike, price drops on a part, part back in stock. Double opt-in (`/api/confirm`), then ONE weekly digest per subscriber from `POST /api/alerts-run`. Unsubscribe per alert or all (`/api/unsubscribe`, signed links + one-click List-Unsubscribe). Old `alert:<email>:<bike>` signups from forms.js are migrated on each run and get one confirm email.

KV keys (namespace `FORMS`, values also stored as metadata so the run only needs list calls):
`sub:<email>`, `w:<email>:bike_price:<bikeId>`, `w:<email>:part_price:<pid>`, `w:<email>:part_stock:<pid>`, `w:<email>:news`, `meta:news:first_seen`, `cap:sub:<date>`.

Prices/stock come from `data/bikes.json` (`price_usd`) and `data/parts.json`. Regenerate parts.json after any data.js change: `node scripts/build_parts_json.mjs` (`tools/stock_check.py --apply` does it automatically). Offline test: `node tools/test_alerts.mjs`.

Switch on (Pages → ebikepartspicker → Settings → Variables and Bindings, Production), then redeploy:
1. KV binding `FORMS`.
2. Secrets `RESEND_API_KEY` (free resend.com account) and `ALERT_RUN_TOKEN` (any long random string).
3. `TURNSTILE_SITE_KEY` (plain) + `TURNSTILE_SECRET` (secret), the same widget as the build form.
4. Verify `ebikepartspicker.net` in Resend (DNS records it gives you) so `alerts@ebikepartspicker.net` can send. Optional `ALERT_FROM`, `ALERTS_MAX_SEND` (default 90), `ALERTS_MAX_WRITES` (default 500), `SUB_DAILY_CAP` (default 100).
Until then `GET /api/subscribe` and `GET /api/alerts-run` report `enabled:false`.

Weekly run (never commit keys):
```
curl -X POST -H "Authorization: Bearer $ALERT_RUN_TOKEN" "https://ebikepartspicker.net/api/alerts-run?dry=1"   # preview, writes nothing
curl -X POST -H "Authorization: Bearer $ALERT_RUN_TOKEN" "https://ebikepartspicker.net/api/alerts-run"
```
Rules: drop fires at >= $5 or >= 3% below the last-notified price; restock on out_of_stock -> in_stock; news at most every 28 days; each alert at most once per 7 days.

## Site health check (weekly)
From this repo, against the live site:
```
python3 scripts/health_check.py --base https://ebikepartspicker.net --out /tmp/ebpp-health
```
Writes `/tmp/ebpp-health.json` and `/tmp/ebpp-health.md` (internal links, images, buy URLs, out-of-stock wording). No extra services. Schedule it however you like.

## Stats (top viewed bikes/parts and buy-link clicks)
Outbound clicks are already stored in the `ebpp_clicks` Analytics Engine dataset by `track.js`. Page views (bikes, parts, and the builder) are added by `view.js`. No personal data.
```
# after adding Pages secrets CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN (Account Analytics Read):
ALERT_RUN_TOKEN=... python3 scripts/query_stats.py
# or:
curl -sS -H "Authorization: Bearer $ALERT_RUN_TOKEN" "https://ebikepartspicker.net/api/stats?days=7"
```
Or query the API directly with the same token:
```
CF_ACCOUNT_ID=438bda0184b182e00ee1676429fec6fb CF_ANALYTICS_TOKEN=... python3 scripts/query_stats.py --direct
```
