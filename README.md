# ebikepartpicker
Electric dirtbike builder and parts configurator

## Price-alert emails (Resend, free tier)
Signups are stored in FORMS KV as `alert:<email>:<bike>`. `functions/api/alerts-run.js` compares each to `data/bikes.json` `price_usd` and emails drops via Resend. Inert until set up:
1. Create a free account at resend.com → API Keys → create key.
2. Cloudflare dashboard → Pages → ebikepartspicker → Settings → Variables and Secrets (Production): add Secret `RESEND_API_KEY`, and Secret `ALERT_RUN_TOKEN` (any long random string).
3. Schedule (not yet wired): a free Cloudflare cron Worker or GitHub Action that POSTs to `/api/alerts-run` with the token daily. Until then, run it manually after price updates.
4. Sender: without a custom domain, `onboarding@resend.dev` only delivers to the Resend account owner (testing). For real users, verify a domain in Resend and set `ALERT_FROM`.
Never commit keys. Test: `curl -X POST -H "Authorization: Bearer $TOKEN" "https://ebikepartspicker.pages.dev/api/alerts-run?dry=1"`.
