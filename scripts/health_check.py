#!/usr/bin/env python3
"""Weekly site health check for eBikePartsPicker.

Checks internal pages (from the sitemap plus links found on them),
images, and buy URLs: status codes, redirects to home/404, and
out-of-stock wording. Writes JSON and Markdown summaries.

Usage (from this repo, or anywhere):
  python3 scripts/health_check.py
  python3 scripts/health_check.py --base https://ebikepartspicker.net --out /tmp/ebpp-health

Options:
  --skip-external   Skip vendor buy-URL checks (faster).
  --max-external N  Cap how many buy URLs to fetch (default 250).
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, html as htmlmod, json, os, re, sys, time
import urllib.error, urllib.request, urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

DEFAULT_BASE = "https://ebikepartspicker.net"
UA = "eBikePartsPicker-health-check/1.0 (+https://ebikepartspicker.net/contact)"
OOS_RE = re.compile(
    r"\b(out of stock|sold out|currently unavailable|no longer available|not available)\b",
    re.I,
)
SOFT404_HINTS = re.compile(r"\b(page not found|404|doesn.?t exist|n[o']t be found)\b", re.I)
ASSET_EXT = re.compile(r"\.(?:css|js|mjs|json|xml|webp|png|jpe?g|gif|svg|ico|woff2?|ttf|map)(?:$|\?)", re.I)
SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "data:")

class Extractor(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.links = []
        self.images = []
        self.text_chunks = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "img":
            if a.get("src"): self.images.append(a["src"])
            if a.get("srcset"):
                for part in a["srcset"].split(","):
                    u = part.strip().split(" ")[0]
                    if u: self.images.append(u)
        elif tag == "link" and a.get("href") and a.get("rel", "") in ("stylesheet", "preload", "icon"):
            if a.get("href"): self.links.append(a["href"])
        elif tag == "script" and a.get("src"):
            self.links.append(a["src"])
    def handle_data(self, data):
        if data and data.strip():
            self.text_chunks.append(data)

def absurl(base, href):
    href = (href or "").strip()
    if not href or href.startswith("#") or href.lower().startswith(SKIP_SCHEMES):
        return None
    return urllib.parse.urljoin(base, href)

def same_host(url, base):
    return urllib.parse.urlparse(url).netloc == urllib.parse.urlparse(base).netloc

def fetch(url, timeout=15, method="GET", max_bytes=200_000):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = b""
            if method != "HEAD":
                body = r.read(max_bytes)
            final = r.geturl()
            return {
                "url": url, "status": r.status, "final": final,
                "location": r.headers.get("Location") or "",
                "ctype": r.headers.get("Content-Type") or "",
                "body": body, "error": None, "redirected": final.rstrip("/") != url.rstrip("/"),
            }
    except urllib.error.HTTPError as e:
        body = b""
        try: body = e.read(max_bytes)
        except Exception: pass
        return {"url": url, "status": e.code, "final": e.geturl() if hasattr(e, "geturl") else url,
                "location": e.headers.get("Location") if e.headers else "",
                "ctype": (e.headers.get("Content-Type") if e.headers else "") or "",
                "body": body, "error": None, "redirected": False}
    except Exception as e:
        return {"url": url, "status": 0, "final": url, "location": "", "ctype": "",
                "body": b"", "error": f"{type(e).__name__}: {e}", "redirected": False}

def looks_like_home(url, base):
    p = urllib.parse.urlparse(url)
    b = urllib.parse.urlparse(base)
    return p.netloc == b.netloc and p.path in ("", "/")

def looks_like_404_url(url):
    path = urllib.parse.urlparse(url).path.lower()
    return path.rstrip("/").endswith("404") or "/404" in path

def classify(res, base, kind="page"):
    issues = []
    status, final, err = res["status"], res["final"], res["error"]
    if err:
        issues.append(f"error:{err}")
        return "error", issues
    if status == 0:
        issues.append("no_response")
        return "error", issues
    if status >= 500:
        issues.append(f"http_{status}")
        return "error", issues
    if status in (404, 410):
        issues.append(f"http_{status}")
        return "not_found", issues
    if 300 <= status < 400 or res["redirected"]:
        if looks_like_404_url(final):
            issues.append("redirect_to_404")
            return "not_found", issues
        if kind != "buy" and looks_like_home(final, base) and not looks_like_home(res["url"], base):
            issues.append("redirect_to_home")
            return "soft_404", issues
    if status >= 400:
        issues.append(f"http_{status}")
        return "error", issues
    if kind != "asset" and res.get("body"):
        text = res["body"].decode("utf-8", "replace")
        # tiny/empty HTML often means a soft 404
        if "text/html" in (res.get("ctype") or "") and len(text) < 200:
            issues.append("tiny_html")
            return "soft_404", issues
        title = ""
        m = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
        if m: title = re.sub(r"\s+", " ", htmlmod.unescape(m.group(1))).strip()
        if title and SOFT404_HINTS.search(title) and not looks_like_home(res["url"], base):
            issues.append(f"title:{title[:80]}")
            return "soft_404", issues
    return "ok", issues

def parse_sitemap(xml, base):
    urls = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml, re.I)
    out = []
    for u in urls:
        u = htmlmod.unescape(u.strip())
        if same_host(u, base):
            out.append(u)
    return out

def load_buy_urls_from_repo(repo: Path):
    """Best-effort: pull buy_url / url fields from data.js if this is run in the repo."""
    data = repo / "data.js"
    if not data.exists():
        return []
    text = data.read_text("utf-8", "replace")
    urls = set()
    for m in re.finditer(r"https?://[^\s'\"<>]+", text):
        u = m.group(0).rstrip(").,];")
        host = urllib.parse.urlparse(u).netloc.lower()
        if "ebikepartspicker." in host or "googleapis.com" in host:
            continue
        # skip obvious non-product links
        if any(h in host for h in ("schema.org", "w3.org", "cloudflare.com")):
            continue
        urls.add(u)
    return sorted(urls)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=os.environ.get("EBPP_BASE", DEFAULT_BASE))
    ap.add_argument("--out", default="health-report")
    ap.add_argument("--skip-external", action="store_true")
    ap.add_argument("--max-external", type=int, default=250)
    ap.add_argument("--concurrency", type=int, default=8)
    args = ap.parse_args()
    base = args.base.rstrip("/")
    t0 = time.time()
    started = datetime.now(timezone.utc)

    home = fetch(base + "/", timeout=20)
    if home["status"] != 200:
        print(f"FATAL: home page returned {home['status']} {home['error']}", file=sys.stderr)
        sys.exit(2)

    sm = fetch(base + "/sitemap.xml", timeout=20)
    sitemap_urls = parse_sitemap(sm["body"].decode("utf-8", "replace"), base) if sm["status"] == 200 else []
    if not sitemap_urls:
        sitemap_urls = [base + "/"]

    pages = {}
    images = {}
    internal_assets = {}
    buy_from_pages = set()
    page_text_flags = []  # our own pages mentioning out of stock

    def check_page(url):
        res = fetch(url, timeout=20, max_bytes=400_000)
        level, issues = classify(res, base, "page")
        found_links, found_imgs, oos = [], [], False
        if res["status"] == 200 and res["body"] and "text/html" in (res.get("ctype") or "text/html"):
            try:
                ext = Extractor(url)
                ext.feed(res["body"].decode("utf-8", "replace"))
                found_links = ext.links
                found_imgs = ext.images
                text = " ".join(ext.text_chunks)
                if OOS_RE.search(text):
                    oos = True
            except Exception as e:
                issues.append(f"parse:{e}")
        return url, res, level, issues, found_links, found_imgs, oos

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futs = [pool.submit(check_page, u) for u in sitemap_urls]
        extra = set()
        for fut in concurrent.futures.as_completed(futs):
            url, res, level, issues, links, imgs, oos = fut.result()
            pages[url] = {"status": res["status"], "final": res["final"], "level": level,
                          "issues": issues, "error": res["error"], "oos_wording": oos}
            if oos:
                page_text_flags.append(url)
            for href in links:
                absu = absurl(url, href)
                if not absu:
                    continue
                if same_host(absu, base):
                    # strip fragment
                    p = urllib.parse.urlsplit(absu)
                    clean = urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, p.query, ""))
                    if ASSET_EXT.search(p.path):
                        internal_assets.setdefault(clean, True)
                    elif clean not in pages and clean not in sitemap_urls:
                        extra.add(clean)
                else:
                    buy_from_pages.add(absu)
            for src in imgs:
                absu = absurl(url, src)
                if absu and same_host(absu, base):
                    images[absu] = images.get(absu) or url

        # one hop of internal links not already in the sitemap (caps runaway)
        extra_list = sorted(extra)[:400]
        for fut in concurrent.futures.as_completed([pool.submit(check_page, u) for u in extra_list]):
            url, res, level, issues, links, imgs, oos = fut.result()
            pages[url] = {"status": res["status"], "final": res["final"], "level": level,
                          "issues": issues, "error": res["error"], "oos_wording": oos}
            if oos:
                page_text_flags.append(url)
            for src in imgs:
                absu = absurl(url, src)
                if absu and same_host(absu, base):
                    images[absu] = images.get(absu) or url

        def check_asset(url, kind):
            # HEAD first; GET on failure
            res = fetch(url, timeout=15, method="HEAD", max_bytes=0)
            if res["status"] in (0, 405, 501) or res["error"]:
                res = fetch(url, timeout=15, method="GET", max_bytes=2048)
            elif res["status"] >= 400:
                res = fetch(url, timeout=15, method="GET", max_bytes=2048)
            level, issues = classify(res, base, "asset")
            return url, res, level, issues, kind

        asset_futs = [pool.submit(check_asset, u, "image") for u in images]
        asset_futs += [pool.submit(check_asset, u, "asset") for u in internal_assets if u not in images]
        asset_results = {}
        for fut in concurrent.futures.as_completed(asset_futs):
            url, res, level, issues, kind = fut.result()
            asset_results[url] = {"status": res["status"], "final": res["final"], "level": level,
                                  "issues": issues, "error": res["error"], "kind": kind}

        buy_results = {}
        if not args.skip_external:
            repo = Path(__file__).resolve().parents[1]
            buy_urls = list(buy_from_pages)
            # Prefer catalog URLs when running from the repo; still include page links.
            for u in load_buy_urls_from_repo(repo):
                if u not in buy_from_pages:
                    buy_urls.append(u)
            # de-dupe by URL, cap
            seen = set(); ordered = []
            for u in buy_urls:
                if u not in seen:
                    seen.add(u); ordered.append(u)
            ordered = ordered[: args.max_external]

            def check_buy(url):
                res = fetch(url, timeout=15, method="GET", max_bytes=80_000)
                level, issues = classify(res, base, "buy")
                oos = False
                snippet = ""
                if res["body"]:
                    text = res["body"].decode("utf-8", "replace")
                    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
                    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
                    text = re.sub(r"<[^>]+>", " ", text)
                    text = re.sub(r"\s+", " ", htmlmod.unescape(text))
                    m = OOS_RE.search(text)
                    if m:
                        oos = True
                        i = max(0, m.start() - 40)
                        snippet = text[i:m.end()+40].strip()
                return url, res, level, issues, oos, snippet

            for fut in concurrent.futures.as_completed([pool.submit(check_buy, u) for u in ordered]):
                url, res, level, issues, oos, snippet = fut.result()
                buy_results[url] = {"status": res["status"], "final": res["final"], "level": level,
                                    "issues": issues, "error": res["error"], "oos_wording": oos,
                                    "oos_snippet": snippet}

    def bucket(items):
        c = Counter(v["level"] for v in items.values())
        return dict(c)

    def problems(items, limit=80):
        out = []
        for url, v in sorted(items.items(), key=lambda kv: (kv[1]["level"] != "ok", kv[0])):
            if v["level"] == "ok" and not v.get("oos_wording"):
                continue
            rec = {"url": url, **{k: v[k] for k in v if k != "oos_snippet" or v.get("oos_wording")}}
            out.append(rec)
            if len(out) >= limit:
                break
        return out

    elapsed = round(time.time() - t0, 1)
    generated = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
    summary = {
        "generated_at": started.isoformat(),
        "generated_at_local": generated,
        "base": base,
        "elapsed_sec": elapsed,
        "pages": {"count": len(pages), "by_level": bucket(pages), "problems": problems(pages)},
        "images": {"count": len([u for u,v in asset_results.items() if v["kind"]=="image"]),
                   "by_level": bucket({u:v for u,v in asset_results.items() if v["kind"]=="image"}),
                   "problems": problems({u:v for u,v in asset_results.items() if v["kind"]=="image"})},
        "assets": {"count": len([u for u,v in asset_results.items() if v["kind"]=="asset"]),
                   "by_level": bucket({u:v for u,v in asset_results.items() if v["kind"]=="asset"}),
                   "problems": problems({u:v for u,v in asset_results.items() if v["kind"]=="asset"})},
        "buy_urls": {"count": len(buy_results),
                     "by_level": bucket(buy_results),
                     "oos_wording": sum(1 for v in buy_results.values() if v.get("oos_wording")),
                     "problems": problems(buy_results)},
        "pages_with_oos_wording": page_text_flags,
    }

    def fail_count(block):
        return sum(n for k,n in (block.get("by_level") or {}).items() if k != "ok")

    worst = fail_count(summary["pages"]) + fail_count(summary["images"]) + fail_count(summary["assets"])
    summary["ok"] = worst == 0

    out_base = Path(args.out)
    if out_base.suffix:
        json_path = out_base.with_suffix(".json")
        md_path = out_base.with_suffix(".md")
    else:
        json_path = Path(str(out_base) + ".json")
        md_path = Path(str(out_base) + ".md")
    json_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    def md_list(title, recs, extra=None):
        lines = [f"## {title}", ""]
        if not recs:
            lines += ["None.", ""]
            return lines
        for r in recs:
            bits = [f"- `{r['url']}` — {r.get('level')} HTTP {r.get('status')}"]
            if r.get("issues"): bits.append(f"  issues: {', '.join(r['issues'])}")
            if r.get("error"): bits.append(f"  error: {r['error']}")
            if r.get("oos_wording"): bits.append("  out-of-stock wording found" + (f": “{r.get('oos_snippet','')[:120]}”" if r.get("oos_snippet") else ""))
            if r.get("final") and r["final"] != r["url"]: bits.append(f"  final: {r['final']}")
            lines += bits
        lines.append("")
        return lines

    md = []
    md.append(f"# eBikePartsPicker health check")
    md.append("")
    md.append(f"Generated {generated} against `{base}` in {elapsed}s.")
    md.append("")
    md.append("| Check | Count | OK | Problems |")
    md.append("|---|---:|---:|---:|")
    for key, label in (("pages","Pages"),("images","Images"),("assets","Other assets"),("buy_urls","Buy URLs")):
        b = summary[key]
        ok = (b.get("by_level") or {}).get("ok", 0)
        md.append(f"| {label} | {b['count']} | {ok} | {b['count']-ok} |")
    md.append("")
    if summary["buy_urls"]["count"]:
        md.append(f"Buy URLs with out-of-stock wording: {summary['buy_urls']['oos_wording']}.")
        md.append("")
    if page_text_flags:
        md.append("Our pages that mention out-of-stock wording:")
        for u in page_text_flags:
            md.append(f"- {u}")
        md.append("")
    md += md_list("Problem pages", summary["pages"]["problems"])
    md += md_list("Problem images", summary["images"]["problems"])
    md += md_list("Problem assets", summary["assets"]["problems"])
    md += md_list("Problem / noteworthy buy URLs", summary["buy_urls"]["problems"])
    md.append(f"Overall: {'OK' if summary['ok'] else 'ISSUES FOUND'}.")
    md.append("")
    md_path.write_text("\n".join(md), encoding="utf-8")

    print(f"Health check {'OK' if summary['ok'] else 'ISSUES FOUND'} in {elapsed}s")
    print(f"  pages  {summary['pages']['count']}  {summary['pages']['by_level']}")
    print(f"  images {summary['images']['count']}  {summary['images']['by_level']}")
    print(f"  assets {summary['assets']['count']}  {summary['assets']['by_level']}")
    print(f"  buy    {summary['buy_urls']['count']}  {summary['buy_urls']['by_level']}  oos={summary['buy_urls']['oos_wording']}")
    print(f"Wrote {json_path} and {md_path}")
    sys.exit(0 if summary["ok"] else 1)

if __name__ == "__main__":
    main()
