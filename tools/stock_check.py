#!/usr/bin/env python3
"""Recheck store-link stock for eBikePartsPicker.

Stock in data.js is a part-level flag (stock / stockChk). A part is in_stock
if ANY successfully checked store has it. out_of_stock is only set when at
least one URL was checked and every successful check is out of stock.
Failed or unknown checks are never treated as out of stock.

The live site also refuses to show "out of stock" when stockChk is older than
14 days (see STOCK_RECENT_DAYS in app.js and scripts/build_seo.py). This
script is what keeps those flags fresh.

Usage (from the repo root, or with this path):

  python3 tools/stock_check.py
      Dry run. Writes a mismatch report (default:
      tools/stock_check_report.json) and prints a summary. Does not edit
      data.js.

  python3 tools/stock_check.py --apply
      Same check, then surgically update data.js stock / stockChk and
      per-offer stock fields. Does not change fitment, prices, or
      protected files (track.js, forms.js, Google verification). After
      --apply, regenerate static pages:

        python3 scripts/dump_snapshot.py \\
          && python3 scripts/seo_extract.py /tmp/seo.json \\
          && python3 scripts/build_seo.py /tmp/seo.json \\
          && python3 scripts/build_upgrades_vs.py

  python3 tools/stock_check.py --pids ebmx-xlb-60,ventus-ryuga-81kw
  python3 tools/stock_check.py --limit 50
  python3 tools/stock_check.py --report /tmp/stock_check_report.json
  python3 tools/stock_check.py --workers 6 --delay 0.15

Daily schedule (example crontab, America/Denver):

  15 6 * * * cd /workspace/ebikepartspicker && python3 tools/stock_check.py --report tools/stock_check_report.json >> tools/stock_check.log 2>&1

Review the report, then run --apply and the SEO rebuild when you want the
catalog updated. Only run --apply unattended if you also have a deploy step
you trust.
"""
from __future__ import annotations

import argparse, json, os, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from html import unescape
from typing import Optional
from urllib.parse import urlparse, urlunparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, "data.js")
DEFAULT_REPORT = os.path.join(ROOT, "tools", "stock_check_report.json")
TODAY = date.today().isoformat()
UA = (
    "eBikePartsPicker-stock-check/1.0 (+https://ebikepartspicker.net; "
    "stock availability refresh)"
)
TIMEOUT = 20
RETRIES = 2

# Shopify-style stores (and lookalikes) where /products/{handle}.js works.
SHOPIFY_HOSTS = {
    "chargedcycleworks.com",
    "gritshift.com",
    "tbelectricmoto.com",
    "parts.electriccyclerider.com",
    "wiredwhips.com",
    "revrides.com",
    "tuttiosport.com",
    "howlingmoto.com",
    "www.eridepro.com",
    "voromotors.com",
    "lithiumpowersports.com",
    "warp9racing.com",
    "ventusbikes.us",
    "mtnmotoworks.com",
    "titaniumsurron.com",
    "emotobykes.com",
    "shop.sur-ron.com",
    "pinnedelectric.com",
    "darwinev.com",
    "ridesirris.com",
    "rippinmoto.com",
    "www.altispowersports.com",
    "electroandcompany.com",
    "e-moto-culture.com",
}

IN_STOCK_TOKENS = (
    "instock",
    "in_stock",
    "http://schema.org/instock",
    "https://schema.org/instock",
    "limitedavailability",
    "https://schema.org/limitedavailability",
    "http://schema.org/limitedavailability",
    "preorder",
    "https://schema.org/preorder",
    "http://schema.org/preorder",
    "onlineonly",
    "https://schema.org/onlineonly",
)
OUT_STOCK_TOKENS = (
    "outofstock",
    "out_of_stock",
    "http://schema.org/outofstock",
    "https://schema.org/outofstock",
    "discontinued",
    "https://schema.org/discontinued",
    "soldout",
    "sold_out",
)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def host_of(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return ""


def product_js_url(url: str) -> Optional[str]:
    """Return a Shopify product .js URL when the path looks like /products/handle."""
    try:
        p = urlparse(url)
    except Exception:
        return None
    m = re.match(r"^/products/([^/]+?)/?$", p.path or "")
    if not m:
        # some stores use /products/handle/ and query strings; also /collections/.../products/handle
        m = re.search(r"/products/([^/]+?)/?$", p.path or "")
        if not m:
            return None
    handle = m.group(1)
    if handle.endswith(".js") or handle.endswith(".json"):
        return urlunparse((p.scheme or "https", p.netloc, p.path, "", "", ""))
    return urlunparse((p.scheme or "https", p.netloc, f"/products/{handle}.js", "", "", ""))


def fetch(url: str, delay: float) -> tuple[int, str]:
    if delay:
        time.sleep(delay)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    last_err = None
    for attempt in range(RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                code = getattr(resp, "status", 200) or 200
                try:
                    body = raw.decode("utf-8", "replace")
                except Exception:
                    body = raw.decode("latin-1", "replace")
                return code, body
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (404, 410, 401, 403):
                body = ""
                try:
                    body = e.read().decode("utf-8", "replace")
                except Exception:
                    pass
                return e.code, body
            time.sleep(0.6 * (attempt + 1))
        except Exception as e:
            last_err = e
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(str(last_err) if last_err else "fetch failed")


def parse_shopify_js(body: str) -> Optional[bool]:
    try:
        data = json.loads(body)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if "product" in data and isinstance(data["product"], dict):
        data = data["product"]
    if "available" in data:
        return bool(data["available"])
    variants = data.get("variants") or []
    if variants:
        return any(bool(v.get("available")) for v in variants if isinstance(v, dict))
    return None


def parse_jsonld(html: str) -> Optional[bool]:
    flags = []
    for m in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.I | re.S,
    ):
        raw = unescape(m.group(1)).strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        # @graph
        more = []
        for n in nodes:
            if isinstance(n, dict) and "@graph" in n:
                g = n["@graph"]
                if isinstance(g, list):
                    more.extend(g)
            else:
                more.append(n)
        for n in more:
            if not isinstance(n, dict):
                continue
            offers = n.get("offers")
            if offers is None and n.get("@type") in ("Offer", "AggregateOffer"):
                offers = n
            if offers is None:
                continue
            if isinstance(offers, dict):
                offers = [offers]
            if not isinstance(offers, list):
                continue
            for off in offers:
                if not isinstance(off, dict):
                    continue
                avail = off.get("availability") or off.get("availableAtOrFrom")
                if not avail:
                    continue
                if isinstance(avail, list):
                    avail = " ".join(str(x) for x in avail)
                token = re.sub(r"[^a-z_:/]+", "", str(avail).lower())
                if any(tok in token for tok in IN_STOCK_TOKENS):
                    flags.append(True)
                elif any(tok in token for tok in OUT_STOCK_TOKENS):
                    flags.append(False)
    if not flags:
        return None
    return any(flags)


def check_url(url: str, delay: float) -> dict:
    result = {
        "url": url,
        "host": host_of(url),
        "method": None,
        "available": None,
        "error": None,
        "http": None,
    }
    if not url or not url.startswith("http"):
        result["error"] = "no-url"
        return result
    js = product_js_url(url)
    # Try Shopify .js first for known hosts, then always fall back to JSON-LD.
    tried_js = False
    if js and (result["host"] in SHOPIFY_HOSTS or result["host"].endswith(".myshopify.com") or js):
        tried_js = True
        try:
            code, body = fetch(js, delay)
            result["http"] = code
            result["method"] = "shopify.js"
            if 200 <= code < 300:
                avail = parse_shopify_js(body)
                if avail is not None:
                    result["available"] = avail
                    return result
            # 404 .js does not prove OOS; fall through to HTML
        except Exception as e:
            result["error"] = f"shopify.js:{e}"
    try:
        code, body = fetch(url, delay)
        result["http"] = code
        if result["method"] is None:
            result["method"] = "jsonld"
        else:
            result["method"] = (result["method"] or "") + "+jsonld"
        if 200 <= code < 300:
            avail = parse_jsonld(body)
            if avail is not None:
                result["available"] = avail
                result["error"] = None
                return result
            if result["available"] is None:
                result["error"] = result.get("error") or "no-availability-signal"
        elif code in (404, 410):
            # page gone is not a reliable OOS (moved handle); leave unknown
            result["error"] = f"http-{code}"
        else:
            result["error"] = f"http-{code}"
    except Exception as e:
        err = f"html:{e}"
        result["error"] = (result.get("error") + ";" + err) if result.get("error") else err
    if not tried_js and result["available"] is None and js:
        # last try .js for unknown hosts
        try:
            code, body = fetch(js, delay)
            result["http"] = code
            result["method"] = (result.get("method") or "") + "+shopify.js"
            if 200 <= code < 300:
                avail = parse_shopify_js(body)
                if avail is not None:
                    result["available"] = avail
                    result["error"] = None
        except Exception:
            pass
    return result


def extract_parts(text: str) -> list[dict]:
    """Load parts from data.js via a tiny Node eval so we match the app."""
    import subprocess, tempfile

    script = r"""
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync(process.argv[2], 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code + '\nthis.CATEGORIES=CATEGORIES;', ctx);
const parts = [];
for (const c of ctx.CATEGORIES) {
  for (const o of (c.options || [])) {
    if (!o || !o.pid) continue;
    parts.push({
      cat: c.id,
      pid: o.pid,
      name: o.name,
      stock: o.stock || '',
      stockChk: o.stockChk || '',
      prices: (o.prices || []).map(p => ({v:p.v, p:p.p, url:p.url, chk:p.chk, stock:p.stock || ''})),
    });
  }
}
process.stdout.write(JSON.stringify(parts));
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(script)
        helper = f.name
    try:
        out = subprocess.check_output(["node", helper, DATA_JS], cwd=ROOT)
        return json.loads(out.decode("utf-8"))
    finally:
        os.unlink(helper)


def propose_part_stock(checks: list[dict]) -> tuple[str, str]:
    """Return (stock, reason). reason is 'in_stock' | 'out_of_stock' | 'unchanged-unknown'."""
    known = [c for c in checks if c.get("available") is True or c.get("available") is False]
    if any(c.get("available") is True for c in known):
        return "in_stock", "any-store-in-stock"
    if known and all(c.get("available") is False for c in known):
        return "out_of_stock", "all-checked-stores-oos"
    return "", "no-successful-check"


def iter_pid_hits(text: str, pid: str):
    pat = re.compile(r"pid:\s*(['\"])" + re.escape(pid) + r"\1")
    return pat.finditer(text)


def object_span(text: str, pid_match) -> Optional[tuple[int, int]]:
    i = pid_match.start()
    window_start = max(0, i - 400)
    chunk = text[window_start:i]
    rel = chunk.rfind("{name:")
    if rel < 0:
        rel = chunk.rfind("{name\":")
    if rel < 0:
        rel = chunk.rfind("{")
    if rel < 0:
        return None
    start = window_start + rel
    depth = 0
    for j, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return (start, j + 1)
    return None


def apply_updates(text: str, updates: list[dict]) -> tuple[str, int]:
    """Surgically update stock / stockChk and per-offer stock in data.js text."""
    changed = 0
    for u in updates:
        if not u.get("apply"):
            continue
        hits = list(iter_pid_hits(text, u["pid"]))
        spans = []
        for h in hits:
            sp = object_span(text, h)
            if not sp:
                continue
            obj = text[sp[0] : sp[1]]
            if "prices:" not in obj:
                continue
            spans.append(sp)
        if not spans:
            log(f"apply: no object for {u['pid']}")
            continue
        for start, end in reversed(spans):
            obj = text[start:end]
            orig = obj
            new_stock = u["new_stock"]
            # part-level stock
            if new_stock in ("in_stock", "out_of_stock"):
                obj2, n = re.subn(r"stock:\s*'[^']*'", f"stock:'{new_stock}'", obj, count=1)
                if n == 0:
                    obj2, n = re.subn(r'stock:\s*"[^"]*"', f'stock:"{new_stock}"', obj, count=1)
                if n == 0:
                    # insert before closing of object
                    obj2 = re.sub(r"(\s*)}$", f", stock:'{new_stock}', stockChk:'{TODAY}'\\1}}", obj, count=1)
                    n = 1 if obj2 != obj else 0
                obj = obj2
                obj2, n2 = re.subn(r"stockChk:\s*'[^']*'", f"stockChk:'{TODAY}'", obj, count=1)
                if n2 == 0:
                    obj2, n2 = re.subn(r'stockChk:\s*"[^"]*"', f'stockChk:"{TODAY}"', obj, count=1)
                if n2 == 0 and f"stock:'{new_stock}'" in obj and "stockChk:" not in obj:
                    obj2 = obj.replace(f"stock:'{new_stock}'", f"stock:'{new_stock}', stockChk:'{TODAY}'", 1)
                obj = obj2
            # per-offer stock
            for c in u.get("checks") or []:
                url = c.get("url") or ""
                avail = c.get("available")
                if not url or avail is None:
                    continue
                flag = "in_stock" if avail else "out_of_stock"
                # existing stock field on this offer
                pat = r"(url:'" + re.escape(url) + r"', chk:')([^']+)(')(, stock:'[^']*')?"
                def repl(m, flag=flag):
                    return m.group(1) + TODAY + m.group(3) + f", stock:'{flag}'"
                obj2, n = re.subn(pat, repl, obj, count=1)
                if n == 0:
                    # chk may use double quotes, or no chk, or stock already in a different order
                    pat2 = r"(url:'" + re.escape(url) + r"')([^}]*?)(})"
                    def repl2(m, flag=flag):
                        rest = m.group(2)
                        rest = re.sub(r",?\s*stock:\s*'[^']*'", "", rest)
                        rest = re.sub(r"chk:\s*'[^']*'", f"chk:'{TODAY}'", rest)
                        if "chk:" not in rest:
                            rest = rest.rstrip(",") + f", chk:'{TODAY}'"
                        return m.group(1) + rest.rstrip(",") + f", stock:'{flag}'" + m.group(3)
                    obj2, n = re.subn(pat2, repl2, obj, count=1)
                obj = obj2
            if obj != orig:
                text = text[:start] + obj + text[end:]
                changed += 1
    return text, changed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="Update data.js stock flags")
    ap.add_argument("--report", default=DEFAULT_REPORT, help="Write JSON report here")
    ap.add_argument("--pids", default="", help="Comma-separated pid list (default: all parts with a store URL)")
    ap.add_argument("--limit", type=int, default=0, help="Max parts to check (0 = all)")
    ap.add_argument("--workers", type=int, default=6, help="Parallel fetches")
    ap.add_argument("--delay", type=float, default=0.12, help="Per-request delay in each worker (seconds)")
    args = ap.parse_args()

    if not os.path.isfile(DATA_JS):
        log(f"missing {DATA_JS}")
        return 2

    parts = extract_parts(open(DATA_JS, encoding="utf-8").read())
    want = {p.strip() for p in args.pids.split(",") if p.strip()}
    jobs = []
    for p in parts:
        if want and p["pid"] not in want:
            continue
        urls = [pr.get("url") for pr in p["prices"] if pr.get("url")]
        if not urls:
            continue
        jobs.append(p)
        if args.limit and len(jobs) >= args.limit:
            break

    log(f"checking {len(jobs)} parts, {sum(len(p['prices']) for p in jobs)} offer URLs, workers={args.workers}")
    # flatten unique URLs
    url_to_parts: dict[str, list[str]] = {}
    for p in jobs:
        for pr in p["prices"]:
            u = pr.get("url")
            if not u:
                continue
            url_to_parts.setdefault(u, []).append(p["pid"])

    url_results: dict[str, dict] = {}
    urls = list(url_to_parts)
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = {ex.submit(check_url, u, args.delay): u for u in urls}
        for fut in as_completed(futs):
            u = futs[fut]
            try:
                url_results[u] = fut.result()
            except Exception as e:
                url_results[u] = {"url": u, "host": host_of(u), "available": None, "error": str(e), "method": None}
            done += 1
            if done % 50 == 0 or done == len(urls):
                log(f"  fetched {done}/{len(urls)}")

    mismatches = []
    updates = []
    summary = {
        "checked_on": TODAY,
        "parts": len(jobs),
        "urls": len(urls),
        "url_in_stock": 0,
        "url_out_of_stock": 0,
        "url_unknown": 0,
        "part_would_become_in_stock": 0,
        "part_would_become_out_of_stock": 0,
        "part_unchanged": 0,
        "part_unknown": 0,
    }
    for r in url_results.values():
        if r.get("available") is True:
            summary["url_in_stock"] += 1
        elif r.get("available") is False:
            summary["url_out_of_stock"] += 1
        else:
            summary["url_unknown"] += 1

    for p in jobs:
        checks = []
        for pr in p["prices"]:
            u = pr.get("url")
            if not u:
                continue
            r = dict(url_results[u])
            r["vendor"] = pr.get("v")
            r["listed_price"] = pr.get("p")
            r["listed_offer_stock"] = pr.get("stock") or ""
            checks.append(r)
        new_stock, reason = propose_part_stock(checks)
        current = p.get("stock") or ""
        apply = False
        if new_stock and new_stock != current:
            apply = True
            if new_stock == "in_stock":
                summary["part_would_become_in_stock"] += 1
            else:
                summary["part_would_become_out_of_stock"] += 1
        elif new_stock and new_stock == current:
            # still refresh stockChk / per-offer flags when we have a successful check
            apply = True
            summary["part_unchanged"] += 1
        else:
            summary["part_unknown"] += 1
        rec = {
            "pid": p["pid"],
            "name": p["name"],
            "cat": p["cat"],
            "current_stock": current,
            "current_stockChk": p.get("stockChk") or "",
            "new_stock": new_stock or current,
            "reason": reason,
            "changed": bool(new_stock and new_stock != current),
            "apply": apply and bool(new_stock),
            "checks": checks,
        }
        if rec["changed"] or reason == "no-successful-check":
            mismatches.append(rec)
        updates.append(rec)

    report = {"summary": summary, "mismatches": mismatches, "updates": updates}
    os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    log(
        "summary: "
        f"{summary['url_in_stock']} URLs in stock, "
        f"{summary['url_out_of_stock']} OOS, "
        f"{summary['url_unknown']} unknown; "
        f"{summary['part_would_become_in_stock']} parts would become in_stock, "
        f"{summary['part_would_become_out_of_stock']} would become out_of_stock, "
        f"{summary['part_unknown']} unchecked/unknown. "
        f"Report: {args.report}"
    )

    if args.apply:
        protected = ("track.js", "forms.js", "google")
        text = open(DATA_JS, encoding="utf-8").read()
        new_text, nobj = apply_updates(text, updates)
        if new_text != text:
            # refuse if we accidentally touched protected filenames in the patch
            # (we only edit data.js, but be loud if the path is wrong)
            if os.path.basename(DATA_JS) in protected:
                log("refusing to write a protected file")
                return 3
            open(DATA_JS, "w", encoding="utf-8").write(new_text)
            log(f"applied updates to {nobj} part objects in data.js. Rebuild SEO pages before deploying.")
        else:
            log("apply: no text changes")
    else:
        log("dry run (no data.js changes). Re-run with --apply to update stock flags.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
