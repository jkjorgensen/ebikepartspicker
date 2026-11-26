#!/usr/bin/env python3
"""Print top viewed bikes/parts, top clicked buy links, and buy clicks per
part / store / bike from the
ebpp_clicks Analytics Engine dataset (no personal data).

Preferred (once Pages secrets are set):
  ALERT_RUN_TOKEN=... python3 scripts/query_stats.py
  # or:  curl -sS -H "Authorization: Bearer $ALERT_RUN_TOKEN" \\
  #          "https://ebikepartspicker.net/api/stats?days=7"

Direct Cloudflare API (no site deploy needed):
  CF_ACCOUNT_ID=438bda0184b182e00ee1676429fec6fb \\
  CF_ANALYTICS_TOKEN=... python3 scripts/query_stats.py --direct

The API token needs Account → Account Analytics → Read (free).
Optional: --days 7 (1–30).
"""
from __future__ import annotations
import argparse, json, os, sys, urllib.error, urllib.request

DEFAULT_BASE = "https://ebikepartspicker.net"
DEFAULT_ACCOUNT = "438bda0184b182e00ee1676429fec6fb"
DATASET = "ebpp_clicks"

def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)

def get(url, headers=None, data=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        return e.code, raw

def print_table(title, rows, a, b, n="count"):
    print(f"\n{title}")
    if not rows:
        print("  (none yet)")
        return
    for row in rows:
        left = row.get(a) or ""
        mid = row.get(b) or ""
        count = row.get(n, row.get("count", 0))
        extra = f"  {mid}" if mid and mid != left else ""
        print(f"  {count:>6}  {left}{extra}")

def from_endpoint(base, token, days):
    status, raw = get(f"{base.rstrip('/')}/api/stats?days={days}",
                      headers={"Authorization": f"Bearer {token}"})
    try:
        data = json.loads(raw)
    except Exception:
        die(f"/api/stats returned HTTP {status}: {raw[:400]}")
    if status != 200 or not data.get("ok"):
        die(f"/api/stats failed ({status}): {data}")
    return data

def ae_sql(account, token, sql):
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/analytics_engine/sql"
    status, raw = get(url, headers={"Authorization": f"Bearer {token}", "content-type": "text/plain"},
                      data=sql.encode())
    try:
        data = json.loads(raw)
    except Exception:
        die(f"Analytics Engine SQL HTTP {status}: {raw[:400]}")
    if status != 200 or data.get("success") is False:
        die(f"Analytics Engine SQL failed ({status}): {data}")
    return data.get("data") or []

def from_direct(account, token, days):
    views = ae_sql(account, token, f"""SELECT blob2 AS page, blob3 AS kind, SUM(_sample_interval) AS count
FROM {DATASET}
WHERE timestamp > NOW() - INTERVAL '{days}' DAY
  AND index1 = 'view' AND blob1 = 'view'
GROUP BY blob2, blob3
ORDER BY count DESC
LIMIT 25""")
    bikes = [r for r in views if r.get("kind") == "bike"]
    parts = [r for r in views if r.get("kind") == "part"]
    clicks = ae_sql(account, token, f"""SELECT blob1 AS host, blob2 AS path, SUM(_sample_interval) AS count
FROM {DATASET}
WHERE timestamp > NOW() - INTERVAL '{days}' DAY
  AND index1 != 'view' AND index1 != 'buy' AND blob1 != 'view' AND blob1 != 'buy'
GROUP BY blob1, blob2
ORDER BY count DESC
LIMIT 25""")
    def buy(expr, names):
        cols = [c.strip() for c in expr.split(",")]
        al = [n.strip() for n in names.split(",")]
        sel = ", ".join(f"{c} AS {a}" for c, a in zip(cols, al))
        rows = ae_sql(account, token, f"""SELECT {sel}, SUM(_sample_interval) AS clicks
FROM {DATASET}
WHERE timestamp > NOW() - INTERVAL '{days}' DAY
  AND index1 = 'buy' AND blob1 = 'buy'
GROUP BY {", ".join(cols)}
ORDER BY clicks DESC
LIMIT 50""")
        return [{**{a: r.get(a) or "" for a in al}, "clicks": int(float(r.get("clicks") or 0))} for r in rows]
    return {"ok": True, "days": days, "top_views": views, "top_bikes": bikes, "top_parts": parts, "top_buy_clicks": clicks,
            "buy_clicks_by_part": buy("blob2", "part"), "buy_clicks_by_store": buy("blob3", "store"),
            "buy_clicks_by_part_store": buy("blob2, blob3", "part, store"), "buy_clicks_by_bike": buy("blob4", "bike")}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--base", default=os.environ.get("EBPP_BASE", DEFAULT_BASE))
    ap.add_argument("--direct", action="store_true", help="Query the Cloudflare SQL API instead of /api/stats")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    days = max(1, min(30, args.days))
    site_token = os.environ.get("ALERT_RUN_TOKEN", "").strip()
    ae_token = os.environ.get("CF_ANALYTICS_TOKEN", "").strip()
    account = os.environ.get("CF_ACCOUNT_ID", DEFAULT_ACCOUNT).strip()

    if args.direct or not site_token:
        if not ae_token:
            die("Set ALERT_RUN_TOKEN to query https://ebikepartspicker.net/api/stats\n"
                "or set CF_ANALYTICS_TOKEN (Account Analytics Read) and pass --direct.")
        data = from_direct(account, ae_token, days)
    else:
        data = from_endpoint(args.base, site_token, days)

    if args.json:
        print(json.dumps(data, indent=2))
        return
    print(f"eBikePartsPicker stats — last {data.get('days', days)} days (no personal data)")
    print_table("Top viewed pages", data.get("top_views") or [], "page", "kind")
    print_table("Top viewed bikes", data.get("top_bikes") or [], "page", "kind")
    print_table("Top viewed parts", data.get("top_parts") or [], "page", "kind")
    print_table("Top clicked buy links (legacy host/path, track.js)", data.get("top_buy_clicks") or [], "host", "path")
    def table2(title, rows, *keys):
        print(f"\n{title}")
        if not rows:
            print("  (none yet)")
            return
        for r in rows:
            label = "  ".join((r.get(k) or "(unmatched)") if k == keys[0] else (r.get(k) or "-") for k in keys)
            print(f"  {r.get('clicks', 0):>6}  {label}")
    table2("Buy clicks by part", data.get("buy_clicks_by_part"), "part")
    table2("Buy clicks by store", data.get("buy_clicks_by_store"), "store")
    table2("Buy clicks by part + store", data.get("buy_clicks_by_part_store"), "part", "store")
    table2("Buy clicks by bike", data.get("buy_clicks_by_bike"), "bike")

if __name__ == "__main__":
    main()
