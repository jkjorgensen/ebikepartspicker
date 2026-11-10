# ebikepartpicker
Electric dirtbike builder and parts configurator

## Price-alert emails (Resend, free tier)
Signups are stored in FORMS KV as `alert:<email>:<bike>`. `functions/api/alerts-run.js` compares each to `data/bikes.json` `price_usd` and emails drops via Resend. Inert until set up:
1. Create a free account at resend.com → API Keys → create key.
2. Cloudflare dashboard → Pages → ebikepartspicker → Settings → Variables and Secrets (Production): add Secret `RESEND_API_KEY`, and Secret `ALERT_RUN_TOKEN` (any long random string).
3. Schedule (not yet wired): a free Cloudflare cron Worker or GitHub Action that POSTs to `/api/alerts-run` with the token daily. Until then, run it manually after price updates.
4. Sender defaults to `eBikePartsPicker Alerts <alerts@ebikepartspicker.net>`. Optional override: set `ALERT_FROM`. The domain must be verified in Resend before customer email will deliver.
Never commit keys. Test: `curl -X POST -H "Authorization: Bearer $TOKEN" "https://ebikepartspicker.net/api/alerts-run?dry=1"`.

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
