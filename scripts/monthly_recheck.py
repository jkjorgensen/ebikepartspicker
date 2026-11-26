#!/usr/bin/env python3
"""Monthly fitment / price / link re-check for eBikePartsPicker. FLAG-ONLY.

Runs on the 1st of each month (separate from the daily stock check in
tools/stock_check.py). It READS data.js, builds.js, data/bikes.json and
affiliate-disclosure.html and WRITES a report. It never edits any repo file
and never downgrades a fitment by itself. With Josh's OK, a follow-up PR can
move flagged rows to `verify` and refresh prices / chk dates.

Output (default /workspace/ebpp-monthly/YYYY-MM/):
  report.md   short summary: counts per flag + top 20 items with URLs
  flags.csv   every flag, sorted by severity
  summary.txt plain-text short summary (paste-ready for Josh)
  run.json    run metadata and coverage numbers
State (page hashes + "model name was seen" baseline for next month):
  /workspace/ebpp-monthly/state.json   (written at the end of a full run)

What it checks (flag names in CAPS):
  1. Fitment rows still true: every confirmed* row (explicit FITMENT rows plus
     rows implied by a part's `fits` list). Each evidence URL must return 200
     (no redirect to home, no soft 404, product not removed, handle unchanged,
     collection still lists the product)        -> FIT_EVIDENCE_GONE
     page text must still name the bike (alias map) -> MODEL_NAME_REMOVED
     fitment text hash vs last month               -> FIT_PAGE_CHANGED
  2. Prices: live price vs `p` in data.js (>=3% or >=$10)  -> PRICE_CHANGED
     offer `chk` older than 45 days                         -> PRICE_STALE
     BIKES price vs data/bikes.json price_usd drift         -> PRICE_CHANGED
  3. Links: 4xx/5xx, unreachable, redirects, removed wording -> LINK_DEAD
  4. BUILDS/GUIDES: every pid still exists, not retired, confirmed fit,
     priced                                                 -> GUIDE_OR_BUILD_BROKEN
  5. Affiliate hygiene (Voro bikes only via sjv.io, Tuttio keeps ref=,
     GritShift plain, affiliate-coded domain missing from disclosure)
                                                            -> AFFILIATE_TAG_ISSUE
  6. Part out of stock now AND 30+ days ago (git history of data.js)
                                                            -> OOS_30D

Politeness: ~1 request/sec per host (one worker per host), Shopify
/products.json catalogs where available (a handful of requests instead of
thousands), affiliate tracking links (sjv.io) are NEVER fetched: the target
store URL is fetched instead, with affiliate params stripped, so the check
cannot create fake clicks. Affiliate-coded URLs are never requested as-is.

Usage (from the repo root of an up-to-date main checkout):
  python3 scripts/monthly_recheck.py                       # full run, ~0.5-2 h
  python3 scripts/monthly_recheck.py --sample 40 --out /tmp/ebpp-sample --no-state-write
  python3 scripts/monthly_recheck.py --skip-network        # structural checks only
Needs: python3 (stdlib only) and node (to read data.js / builds.js).
"""
from __future__ import annotations
import argparse, csv, hashlib, html as htmlmod, json, os, random, re, subprocess, sys, tempfile, time
import urllib.parse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import health_check as hc  # reuse fetch / classify / soft-404 helpers

UA = ("eBikePartsPicker-monthly-recheck/1.0 (+https://ebikepartspicker.net/contact; "
      "polite ~1 req/sec per host; flag-only fitment/price check)")
hc.UA = UA
DEFAULT_OUT_ROOT = Path("/workspace/ebpp-monthly")

PRICE_PCT = 3.0        # flag price moves >= 3 %
PRICE_ABS = 10.0       # ... or >= $10
PRICE_FLOOR = 0.50     # ignore sub-50-cent rounding noise on cheap parts
STALE_DAYS = 45
OOS_DAYS = 30

SEV_ORDER = {"high": 0, "med": 1, "low": 2}
FLAG_ORDER = ["FIT_EVIDENCE_GONE", "MODEL_NAME_REMOVED", "FIT_PAGE_CHANGED", "LINK_DEAD",
              "PRICE_CHANGED", "PRICE_STALE", "OOS_30D", "GUIDE_OR_BUILD_BROKEN", "AFFILIATE_TAG_ISSUE"]

# ---------------------------------------------------------------- bike aliases
# Auto aliases = full bike name + name without the brand prefix (when long enough).
# Overrides add the names sellers actually use. Matching is on normalized text
# (lower case, punctuation -> space, "+" -> "plus"), also with spaces removed
# ("ss 3 0" ~ "ss30"). Add aliases here when a seller uses a new spelling.
BRAND_PREFIXES = ["sur ron", "e ride pro", "talaria", "etm", "79bike", "altis", "arctic leopard", "rawrr",
                  "yozma", "tuttio", "stark", "yvolt", "supermach", "rfn", "segway", "ventus", "bonnell", "re rode"]
ALIAS_OVERRIDES = {
    "ventus-plus": ["one plus", "v1 plus", "ventus 1 plus"],
    "ventus-evo": ["v1 plus evo", "ventus evo", "v1 evo"],
    "lightbee": ["light bee x", "light bee", "lightbee"],
    "lightbee2": ["light bee 2", "lightbee 2", "lightbee2"],
    "ultrabee": ["ultra bee", "ultrabee"],
    "ultrabee-21kw": ["ultra bee", "ultrabee"],
    "ultrabee-hd": ["ultra bee", "ultrabee"],
    "ss20": ["ss 2 0", "ss2 0", "ss20", "ss 2"],
    "ss30": ["ss 3 0", "ss3 0", "ss30", "ss 3"],
    "ss40": ["ss 4 0", "ss4 0", "ss40", "ss 4"],
    "sr": ["e ride pro sr", "eride pro sr", "erp sr", "ride pro sr"],
    "mx4": ["mx4", "sting r mx4", "sting mx4", "sting r"],
    "mx5": ["mx5", "sting mx5", "sting mx5 pro"],
    "komodo": ["komodo"],
    "bonnell-805rx": ["805 rx", "805rx", "bonnell 805"],
    "storm-bee": ["storm bee", "stormbee"],
    "arctic-xd": ["arctic leopard xd", "arctic xd", "leopard xd"],
    "rerode-rx": ["re rode rx", "rerode rx", "rerode", "re rode"],
    "rawrr-mantis-72v": ["mantis 72v", "mantis 72", "72v mantis"],
    "rawrr-mantis-x-pro": ["mantis x pro"],
    "rawrr-mantis-x": ["mantis x"],
    "rawrr-mantis-mini-r": ["mantis mini r", "mini r"],
    "rtr-lite-2-0": ["rtr lite 2 0", "lite 2 0"],
    "talaria-xxx": ["xxx", "x3", "talaria xxx", "talaria x3"],
    "segway-x160": ["x160", "x 160"],
    "segway-x260": ["x260", "x 260"],
    "falcon-pro": ["falcon pro"],
    "falcon-gt": ["falcon gt"],
    "tuttio-soleil01": ["soleil01", "soleil 01"],
    "yozma-in10": ["in10", "yzi10"],
    "yozma-in10-pro": ["in10 pro", "yzi10p"],
}
# Charged Cycle Works search-by-bike tags (they sit in the product's Shopify tags). Only codes seen in
# data.js evidence notes / CCW tag lists; add more here when a new bike's tag is confirmed on CCW.
_CCW_TAGS = ({
    "arctic-leopard-xf": ["arctic leopard xf", "alxf"],
    "arctic-leopard-xe-pro-r": ["alxepror"],
    "arctic-leopard-xe-pro-s": ["alxepro"],
    "arctic-leopard-xe-pro-s-enduro": ["alxepro"],
    "lightbee2": ["surlb2"],
    "ss30": ["erpss3"], "ss40": ["erpss4"], "ss20": ["erpss2"],
    "mx5": ["talmx5"],
    "storm-bee": ["surst"],
    "bonnell-805rx": ["bon805"],
    "supermach-sm01": ["sm01"],
    "lightbee": ["surlbx"],
})
for _k, _v in _CCW_TAGS.items():
    ALIAS_OVERRIDES[_k] = sorted(set(ALIAS_OVERRIDES.get(_k, []) + _v))

def norm(s: str) -> str:
    s = (s or "").lower().replace("+", " plus ")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return f" {s} "

def build_aliases(bikes):
    out = {}
    for b in bikes:
        names = {b["name"]}
        n = norm(b["name"]).strip()
        for pre in BRAND_PREFIXES:
            if n.startswith(pre + " "):
                rest = n[len(pre) + 1:]
                if len(rest.replace(" ", "")) >= 5:
                    names.add(rest)
        names.update(ALIAS_OVERRIDES.get(b["id"], []))
        out[b["id"]] = sorted({norm(x).strip() for x in names if norm(x).strip()})
    return out

def model_named(text_norm: str, aliases) -> bool:
    for a in aliases:
        if f" {a} " in text_norm:
            return True
        if " " in a and f" {a.replace(' ', '')} " in text_norm:
            return True
    return False

# --------------------------------------------------------------- load catalog
NODE_LOADER = r"""
const vm=require('vm'),fs=require('fs');
const ctx={window:{}};vm.createContext(ctx);
const files=process.argv.slice(2);
for(const f of files){ if(fs.existsSync(f)) vm.runInContext(fs.readFileSync(f,'utf8')+';',ctx,{filename:f}); }
const out=vm.runInContext(`(function(){
 var parts=[];
 (typeof CATEGORIES!=='undefined'?CATEGORIES:[]).forEach(function(c){(c.options||[]).forEach(function(o){
   if(!o.pid) return;
   parts.push({pid:o.pid,name:o.name,cat:c.id,hidden:!!o.hidden,fits:o.fits===undefined?null:o.fits,no:o.no||[],likely:o.likely||[],
     stock:o.stock||'',stockChk:o.stockChk||'',prices:(o.prices||[]).map(function(p){return {v:p.v,p:(p.p===undefined?null:p.p),url:p.url||'',chk:p.chk||'',stock:p.stock||'',aff:!!p.aff};})});
 });});
 return {stockChecked:typeof STOCK_CHECKED!=='undefined'?STOCK_CHECKED:'',
  bikes:(typeof BIKES!=='undefined'?BIKES:[]).map(function(b){return {id:b.id,name:b.name,price:b.price,msrp:b.msrp===undefined?null:b.msrp,src:b.src||'',srcUrl:b.srcUrl||'',srcChk:b.srcChk||''};}),
  fitment:(typeof FITMENT!=='undefined'?FITMENT:{}), parts:parts,
  builds:(typeof BUILDS!=='undefined'?BUILDS:[]).map(function(b){return {id:b.id,bike:b.bike,pids:b.pids||[]};}),
  guides:(typeof GUIDES!=='undefined'?GUIDES:[]).map(function(g){return {bike:g.bike,tier:g.tier,pids:g.pids||[]};})};})()`,ctx);
process.stdout.write(JSON.stringify(out));
"""

def load_catalog(data_js: Path, builds_js: Path):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as t:
        t.write(NODE_LOADER)
        loader = t.name
    try:
        r = subprocess.run(["node", loader, str(data_js), str(builds_js)], capture_output=True, text=True, timeout=120)
    finally:
        os.unlink(loader)
    if r.returncode != 0:
        raise SystemExit(f"node failed to read {data_js}: {r.stderr[:500]}")
    return json.loads(r.stdout)

def check_fit_status(part, bike_id, fitment):
    """Python port of checkFit() in app.js. Returns (status, evidence_urls)."""
    fits = part["fits"]
    if part["hidden"]:
        return "no_fit", []
    seller = [p["url"] for p in part["prices"] if p["url"]][:3]
    if fits == "universal" or not fits:
        return "confirmed", seller
    d = fitment.get(f'{part["pid"]}|{bike_id}')
    if d:
        ev = d.get("u") or []
        src = len(ev) > 0 or bool(d.get("ov"))
        s = d.get("s")
        if s == "not_compatible":
            return "no_fit", ev
        if s == "confirmed_direct_fit" and src:
            return "confirmed", ev
        if s in ("confirmed_fit_with_adapter", "confirmed_fit_with_modifications") and src:
            return "requires_mod", ev
        if src:
            return "likely_verify", ev
        if bike_id not in fits:
            return "unknown", []
    if bike_id in fits:
        return "confirmed", seller
    if bike_id in part["no"]:
        return "no_fit", []
    return "unknown", []

# ------------------------------------------------------------------- URL utils
AFF_PARAMS = {"ref", "aff", "affiliate", "affid", "aff_id", "a_aid", "aid", "sca_ref", "rfsn", "ref_id",
              "via", "partner", "irclickid", "clickid", "tag", "utm_source", "utm_medium", "utm_campaign",
              "utm_term", "utm_content", "fbclid", "gclid"}
AFF_MARKER_PARAMS = AFF_PARAMS - {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"}
AFF_NETWORK_HOSTS = ("sjv.io", "shareasale.com", "awin1.com", "anrdoezrs.net", "jdoqocy.com", "dpbolvw.net",
                     "kqzyfj.com", "tkqlhce.com", "linksynergy.com", "pjtra.com", "pntra.com", "pntrs.com",
                     "amzn.to", "skimresources.com", "goaffpro.com", "uppromote.com", "refersion.com")
PROGRAM_NAMES = {"voromotors": "Voro", "tuttiosport": "Tuttio"}   # live programs -> name in disclosure
PENDING_PROGRAMS = ["SIRRIS", "Electro & Co", "Electro &amp; Co", "TB Electric", "REV Rides", "Charged Cycle Works"]
NON_USD_TLDS = (".ca", ".co.nz", ".co.uk", ".eu", ".de", ".fr", ".au", ".com.au", ".nl", ".es", ".it")

def host_of(u):
    return urllib.parse.urlsplit(u).netloc.lower()

def root_label(host):
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com"):
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else host

def unwrap(u: str) -> str:
    """Return the real store URL for an affiliate-network wrapper (sjv.io ?u=...)."""
    sp = urllib.parse.urlsplit(u)
    if sp.netloc.lower().endswith("sjv.io"):
        q = urllib.parse.parse_qs(sp.query)
        if q.get("u"):
            return q["u"][0]
    return u

def clean_fetch_url(u: str):
    """(fetch_url, variant_id|None). Strips affiliate/tracking params; never returns a tracking-network URL."""
    u = unwrap(u)
    sp = urllib.parse.urlsplit(u)
    q = urllib.parse.parse_qsl(sp.query, keep_blank_values=True)
    variant = None
    keep = []
    for k, v in q:
        if k.lower() == "variant":
            variant = v
        if k.lower() in AFF_PARAMS or k.lower() == "variant":
            continue
        keep.append((k, v))
    new = urllib.parse.urlunsplit((sp.scheme or "https", sp.netloc, sp.path, urllib.parse.urlencode(keep), ""))
    return new, variant

def shop_handle(url):
    m = re.search(r"/products/([^/?#]+)", urllib.parse.urlsplit(url).path)
    return urllib.parse.unquote(m.group(1)).lower() if m else None

def coll_handle(url):
    p = urllib.parse.urlsplit(url).path
    if "/products/" in p:
        return None
    m = re.search(r"/collections/([^/?#]+)/?$", p)
    return urllib.parse.unquote(m.group(1)).lower() if m else None

def same_page(a, b):
    pa, pb = urllib.parse.urlsplit(a), urllib.parse.urlsplit(b)
    ha, hb = pa.netloc.lower().removeprefix("www."), pb.netloc.lower().removeprefix("www.")
    return ha == hb and pa.path.rstrip("/").lower() == pb.path.rstrip("/").lower()

# ------------------------------------------------------------------ text utils
TAG_RE = re.compile(r"<[^>]+>")
PRICE_TOKEN = re.compile(r"[$€£]\s?\d[\d,]*(?:\.\d+)?")
DEAD_RE = re.compile(r"(no longer available|no longer sold|no longer offered|has been discontinued|"
                     r"product (?:is )?(?:not found|unavailable|removed)|page not found|"
                     r"this product (?:has been )?(?:removed|discontinued)|we couldn.?t find)", re.I)

def strip_html(h: str) -> str:
    h = re.sub(r"(?is)<(script|style|noscript|svg|template)[^>]*>.*?</\1>", " ", h or "")
    h = TAG_RE.sub(" ", h)
    return re.sub(r"\s+", " ", htmlmod.unescape(h)).strip()

def main_text(html_s: str) -> str:
    h = re.sub(r"(?is)<(script|style|noscript|svg|template|header|footer|nav|aside)[^>]*>.*?</\1>", " ", html_s)
    m = re.search(r"(?is)<main\b.*?</main>", h)
    if m:
        h = m.group(0)
    return strip_html(h)

def text_hash(s: str) -> str:
    s = PRICE_TOKEN.sub(" ", s.lower())
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return hashlib.sha1(s.encode()).hexdigest()[:16]

def to_float(x):
    try:
        return float(str(x).replace(",", "").replace("$", ""))
    except Exception:
        return None

# --------------------------------------------------------------------- probing
class HostProbe:
    """Probes every URL for one host sequentially at ~interval sec per request."""
    def __init__(self, host, interval):
        self.host, self.interval, self.last = host, interval, 0.0
        self.catalog = None       # {handle: product} when /products.json works
        self.shopify = None       # None unknown / True / False
        self.requests = 0

    def get(self, url, max_bytes=800_000, tries=3):
        for attempt in range(tries):
            wait = self.last + self.interval - time.time()
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.requests += 1
            res = hc.fetch(url, timeout=25, max_bytes=max_bytes)
            st = res["status"]
            if st in (0, 429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(min(30, 3 * (attempt + 1) * (3 if st == 429 else 1)))
                continue
            return res
        return res

    def load_catalog(self):
        cat, page = {}, 1
        while page <= 40:
            res = self.get(f"https://{self.host}/products.json?limit=250&page={page}", max_bytes=40_000_000)
            if res["status"] != 200:
                return None
            try:
                js = json.loads(res["body"].decode("utf-8", "replace"))
                prods = js["products"]
            except Exception:
                return None
            for p in prods:
                cat[p["handle"].lower()] = p
            if len(prods) < 250:
                break
            page += 1
        return cat or None

def shop_record(p, url_key, from_js=False):
    """Normalize a Shopify product (products.json item or /products/x.js)."""
    variants = {}
    for v in p.get("variants", []):
        price = v.get("price")
        price = (price / 100.0) if isinstance(price, int) else to_float(price)
        cap = v.get("compare_at_price")
        cap = (cap / 100.0) if isinstance(cap, int) else to_float(cap)
        if price is not None and price <= 0:
            price = None          # placeholder $0 variants (e.g. "Race: call for price")
        variants[str(v.get("id"))] = {"p": price, "avail": bool(v.get("available")), "cap": cap if cap and cap > 0 else None}
    tags = p.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    body = p.get("body_html") if not from_js else p.get("description")
    ptype = p.get("product_type") if not from_js else p.get("type")
    text = " ".join([p.get("title", ""), (p.get("handle", "") or "").replace("-", " "), strip_html(body or ""),
                     " ".join(tags), ptype or ""])
    fit_text = " ".join([p.get("title", ""), strip_html(body or ""), " ".join(sorted(tags)), ptype or ""])
    prices = [v["p"] for v in variants.values() if v["p"] is not None]
    # variant titles often carry the fitment list (e.g. "Komodo / Light Bee X"), so they count as fitment text
    vtitles = sorted({str(v.get("title") or "") for v in p.get("variants", []) if str(v.get("title") or "") != "Default Title"})
    text += " " + " ".join(vtitles)
    fit_text += " " + " ".join(vtitles)
    return {"key": url_key, "status": 200, "gone": None, "err": None, "kind": "product", "mode": "shopify",
            "title": p.get("title", ""), "handle": (p.get("handle") or "").lower(), "text": text,
            "hash": text_hash(fit_text), "variants": variants, "prices": prices,
            "avail": any(v["avail"] for v in variants.values()) if variants else None,
            "updated": p.get("updated_at", ""), "currency": None, "final": url_key}

def record_from_result(key, res, base_origin):
    """HTML / generic page record."""
    status = res["status"]
    rec = {"key": key, "status": status, "gone": None, "err": None, "kind": "page", "mode": "html", "title": "",
           "handle": "", "text": "", "hash": "", "variants": {}, "prices": [], "avail": None, "updated": "",
           "currency": None, "final": res["final"]}
    level, issues = hc.classify(res, base_origin, "buy")
    if level == "not_found" or level == "soft_404":
        rec["gone"] = ",".join(issues) or level
        return rec
    if level == "error":
        rec["err"] = ",".join(issues) or "error"
        if status == 403:
            rec["err"] = "http_403 (site may block bots)"
        return rec
    body = res["body"].decode("utf-8", "replace") if res.get("body") else ""
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", body)
    rec["title"] = re.sub(r"\s+", " ", htmlmod.unescape(m.group(1))).strip() if m else ""
    text = main_text(body)
    rec["text"] = rec["title"] + " " + text + " " + (shop_handle(key) or "").replace("-", " ")
    rec["hash"] = text_hash(text[:20000])
    if DEAD_RE.search(rec["title"] + " " + text[:2500]):
        rec["gone"] = "removed_wording"
    # JSON-LD / meta prices
    prices = []
    for mm in re.finditer(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', body):
        try:
            js = json.loads(mm.group(1))
        except Exception:
            continue
        stack = [js]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                if "offers" in x:
                    stack.append(x["offers"])
                if x.get("@type") in ("Offer", "AggregateOffer"):
                    for k in ("price", "lowPrice", "highPrice"):
                        f = to_float(x.get(k))
                        if f is not None:
                            prices.append(f)
                    if x.get("priceCurrency"):
                        rec["currency"] = x["priceCurrency"]
                    av = str(x.get("availability", "")).lower()
                    if av:
                        rec["avail"] = ("instock" in av or "limitedavailability" in av or "preorder" in av)
                for v in x.values():
                    if isinstance(v, (list, dict)):
                        stack.append(v)
    for mm in re.finditer(r'(?i)<meta[^>]+(?:product:price:amount|og:price:amount)[^>]*content=["\']([\d.,]+)', body):
        f = to_float(mm.group(1))
        if f is not None:
            prices.append(f)
    rec["prices"] = sorted(set(prices))
    return rec

def probe_host(host, items, interval, log):
    """items: list of (key, fetch_url, kind) for one host. Returns {key: record}."""
    hp = HostProbe(host, interval)
    out = {}
    origin = f"https://{host}"
    prod_items = [i for i in items if i[2] == "product"]
    coll_items = [i for i in items if i[2] == "collection"]
    other = [i for i in items if i[2] == "page"]
    search_items = [i for i in items if i[2] == "search"]
    if len(prod_items) + len(coll_items) >= 4:
        hp.catalog = hp.load_catalog()
        hp.shopify = hp.catalog is not None
    for key, url, kind in prod_items:
        h = shop_handle(url)
        if hp.catalog is not None and h in hp.catalog:
            out[key] = shop_record(hp.catalog[h], key)
            continue
        if hp.shopify is not False:
            res = hp.get(f"{origin}/products/{h}.js", max_bytes=3_000_000)
            js = None
            if res["status"] == 200:
                try:
                    js = json.loads(res["body"].decode("utf-8", "replace"))
                except Exception:
                    js = None
            if js and isinstance(js, dict) and js.get("handle"):
                hp.shopify = True
                rec = shop_record(js, key, from_js=True)
                if rec["handle"] != h:
                    rec["gone"] = f"handle_changed:{rec['handle']}"
                out[key] = rec
                continue
            if res["status"] in (404, 410) and (hp.shopify or hp.catalog is not None):
                out[key] = {"key": key, "status": res["status"], "gone": f"http_{res['status']}", "err": None, "kind": "product",
                            "mode": "shopify", "title": "", "handle": h, "text": "", "hash": "", "variants": {}, "prices": [],
                            "avail": None, "updated": "", "currency": None, "final": res["final"]}
                continue
            if hp.shopify is None and res["status"] in (200, 404, 403, 0) and not js:
                hp.shopify = False   # not a Shopify .js store: use HTML for the rest
            elif res["status"] in (429, 500, 502, 503, 504, 0) and hp.shopify:
                out[key] = {"key": key, "status": res["status"], "gone": None, "err": f"http_{res['status']}", "kind": "product",
                            "mode": "shopify", "title": "", "handle": h, "text": "", "hash": "", "variants": {}, "prices": [],
                            "avail": None, "updated": "", "currency": None, "final": res["final"]}
                continue
        res = hp.get(url)
        out[key] = record_from_result(key, res, origin)
        if out[key]["mode"] == "html" and shop_handle(res["final"]) and not same_page(res["final"], url) and not out[key]["gone"]:
            out[key]["gone"] = f"redirected_to:{res['final']}"
    for key, url, kind in coll_items:
        ch = coll_handle(url)
        recs = None
        if hp.shopify is not False:
            handles, page, ok = set(), 1, True
            while page <= 12:
                res = hp.get(f"{origin}/collections/{ch}/products.json?limit=250&page={page}", max_bytes=30_000_000)
                if res["status"] != 200:
                    ok = False
                    status = res["status"]
                    break
                try:
                    prods = json.loads(res["body"].decode("utf-8", "replace"))["products"]
                except Exception:
                    ok = False
                    status = 0
                    break
                handles.update(p["handle"].lower() for p in prods)
                if len(prods) < 250:
                    break
                page += 1
            if ok:
                title = ""
                r2 = hp.get(f"{origin}/collections/{ch}.json", max_bytes=300_000)
                try:
                    c = json.loads(r2["body"].decode("utf-8", "replace"))["collection"]
                    title = (c.get("title", "") + " " + strip_html(c.get("body_html", "")))
                except Exception:
                    pass
                text = (title + " " + ch.replace("-", " "))
                recs = {"key": key, "status": 200, "gone": None, "err": None, "kind": "collection", "mode": "shopify",
                        "title": title, "handle": ch, "text": text, "hash": hashlib.sha1("\n".join(sorted(handles)).encode()).hexdigest()[:16],
                        "variants": {}, "prices": [], "avail": None, "handles": handles, "updated": "", "currency": None, "final": url}
            elif status in (404, 410):
                recs = {"key": key, "status": status, "gone": f"http_{status}", "err": None, "kind": "collection", "mode": "shopify",
                        "title": "", "handle": ch, "text": "", "hash": "", "variants": {}, "prices": [], "avail": None,
                        "handles": set(), "updated": "", "currency": None, "final": url}
        if recs is None:
            res = hp.get(url)
            recs = record_from_result(key, res, origin)
            recs["kind"] = "collection"
            body = res["body"].decode("utf-8", "replace") if res.get("body") else ""
            recs["handles"] = {m.lower() for m in re.findall(r"/products/([a-z0-9][a-z0-9\-_%.]*)", body, re.I)}
        out[key] = recs
    for key, url, kind in search_items:
        res = hp.get(url)
        rec = record_from_result(key, res, origin)
        rec["kind"] = "search"
        rec["hash"] = ""          # result order is not stable; membership is checked instead
        body = res["body"].decode("utf-8", "replace") if res.get("body") else ""
        rec["handles"] = {m.lower() for m in re.findall(r"/products/([a-z0-9][a-z0-9\-_%.]*)", body, re.I)}
        out[key] = rec
    for key, url, kind in other:
        res = hp.get(url)
        out[key] = record_from_result(key, res, origin)
        if not out[key]["gone"] and not out[key]["err"] and not same_page(res["final"], url):
            out[key]["redirect"] = res["final"]
    log(f"  probed {host}: {len(items)} urls, {hp.requests} requests" + (", shopify catalog" if hp.catalog else ""))
    return out

# ---------------------------------------------------------------- flag helpers
class Flags:
    def __init__(self):
        self.rows = []
    def add(self, flag, severity, url="", pid="", part="", bike="", detail="", count=1):
        self.rows.append({"severity": severity, "flag": flag, "pid": pid, "part": part, "bike": bike,
                          "url": url, "detail": detail, "rows": count})

def parse_date(s):
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None

def price_issue(offer_p, live_prices, currency=None, host=""):
    """Return detail string if the live price disagrees with offer price p, else None."""
    if offer_p is None or not live_prices:
        return None
    if currency and currency.upper() != "USD":
        return None
    if any(host.endswith(t) for t in NON_USD_TLDS) or "canada" in host:
        return None
    best = min(live_prices, key=lambda x: abs(x - offer_p))
    diff = abs(best - offer_p)
    pct = diff / offer_p * 100 if offer_p else 100
    if diff >= PRICE_FLOOR and (pct >= PRICE_PCT or diff >= PRICE_ABS):
        rng = f"{min(live_prices):.2f}-{max(live_prices):.2f}" if len(set(live_prices)) > 1 else f"{live_prices[0]:.2f}"
        return f"data.js ${offer_p:.2f} vs live ${best:.2f} ({'+' if best > offer_p else '-'}{pct:.1f}%, ${diff:.2f}); live range ${rng}"
    return None

def git_data_at(repo: Path, days_ago: int, today: date, tmpdir: str):
    """Return (sha, commit_date, path_to_data_js) for data.js as of N days ago, or None."""
    try:
        before = (datetime.combine(today, datetime.min.time()) - timedelta(days=days_ago)).strftime("%Y-%m-%d 23:59:59")
        sha = subprocess.run(["git", "-C", str(repo), "rev-list", "-1", f"--before={before}", "HEAD", "--", "data.js"],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        if not sha:
            return None
        cd = subprocess.run(["git", "-C", str(repo), "show", "-s", "--format=%cs", sha], capture_output=True, text=True).stdout.strip()
        data = subprocess.run(["git", "-C", str(repo), "show", f"{sha}:data.js"], capture_output=True, timeout=60).stdout
        p = os.path.join(tmpdir, f"data-{sha[:8]}.js")
        open(p, "wb").write(data)
        return sha[:9], cd, p
    except Exception:
        return None

# ------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default=str(ROOT))
    ap.add_argument("--out", default=None, help="output dir (default /workspace/ebpp-monthly/YYYY-MM)")
    ap.add_argument("--state", default=None, help="state json (default <out parent>/state.json)")
    ap.add_argument("--no-state-write", action="store_true", help="do not update the baseline state (tests/samples)")
    ap.add_argument("--today", default=None, help="YYYY-MM-DD override (tests)")
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between requests to one host (default 1.0)")
    ap.add_argument("--workers", type=int, default=16, help="hosts probed in parallel (default 16)")
    ap.add_argument("--sample", type=int, default=0, help="only check N parts (spread across hosts), with their evidence + buy URLs")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--hosts", default="", help="comma list: only probe these hosts")
    ap.add_argument("--skip-network", action="store_true", help="structural checks only (builds, bikes.json drift, affiliate hygiene, stale chk, OOS history)")
    ap.add_argument("--skip-history", action="store_true", help="skip the git-history OOS_30D check")
    args = ap.parse_args()

    repo = Path(args.repo)
    today = parse_date(args.today) if args.today else date.today()
    out_dir = Path(args.out) if args.out else DEFAULT_OUT_ROOT / today.strftime("%Y-%m")
    out_dir.mkdir(parents=True, exist_ok=True)
    state_path = Path(args.state) if args.state else out_dir.parent / "state.json"
    t0 = time.time()
    def log(m):
        print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    cat = load_catalog(repo / "data.js", repo / "builds.js")
    bikes = cat["bikes"]; bike_by = {b["id"]: b for b in bikes}
    parts_all = cat["parts"]; part_by = {p["pid"]: p for p in parts_all}
    fitment = cat["fitment"]
    aliases = build_aliases(bikes)
    try:
        bikes_json = {b["id"]: b for b in json.load(open(repo / "data" / "bikes.json"))["bikes"]}
    except Exception:
        bikes_json = {}
    disclosure = ""
    try:
        disclosure = strip_html((repo / "affiliate-disclosure.html").read_text("utf-8"))
    except Exception:
        pass
    state = {}
    if state_path.exists():
        try:
            state = json.load(open(state_path))
        except Exception:
            state = {}
    first_run = not state.get("urls")
    log(f"loaded {len(bikes)} bikes, {len(parts_all)} parts ({sum(p['hidden'] for p in parts_all)} hidden), {len(fitment)} FITMENT rows; baseline {'MISSING (first run)' if first_run else 'from ' + str(state.get('run_date'))}")

    parts = [p for p in parts_all if not p["hidden"]]
    if args.sample:
        rnd = random.Random(args.seed)
        by_host = defaultdict(list)
        for p in parts:
            hs = {host_of(unwrap(o["url"])) for o in p["prices"] if o["url"]}
            for h in hs:
                by_host[h].append(p)
        chosen = {}
        hosts = sorted(by_host, key=lambda h: -len(by_host[h]))
        i = 0
        while len(chosen) < args.sample and i < 10_000:
            h = hosts[i % len(hosts)]
            c = rnd.choice(by_host[h])
            chosen[c["pid"]] = c
            i += 1
        parts = list(chosen.values())
        log(f"SAMPLE mode: {len(parts)} parts across {len({host_of(unwrap(o['url'])) for p in parts for o in p['prices'] if o['url']})} hosts")
    sel_pids = {p["pid"] for p in parts}

    flags = Flags()

    # ---- fitment rows (explicit + implied by fits list)
    rows = []   # dict(pid, bike, status, ev, source)
    for p in parts:
        if p["fits"] in ("universal", None) or not p["fits"]:
            continue
        bike_ids = {k.split("|", 1)[1] for k in fitment if k.startswith(p["pid"] + "|")} | set(p["fits"])
        for b in sorted(bike_ids):
            if b not in bike_by:
                continue
            st, ev = check_fit_status(p, b, fitment)
            if st in ("confirmed", "requires_mod"):
                explicit = f'{p["pid"]}|{b}' in fitment and (fitment[f'{p["pid"]}|{b}'].get("u"))
                rows.append({"pid": p["pid"], "bike": b, "status": st, "ev": list(ev), "source": "fitment-row" if explicit else "seller-listing"})
    log(f"{len(rows)} confirmed fitment rows to re-verify ({sum(r['source']=='fitment-row' for r in rows)} with evidence URLs, {sum(r['source']=='seller-listing' for r in rows)} from seller listings)")

    # ---- URL inventory
    url_info = {}   # key -> {"fetch":url,"kind":..}
    def reg(u):
        if not u:
            return None
        f, variant = clean_fetch_url(u)
        k = f
        kind = ("collection" if coll_handle(f) else "search" if urllib.parse.urlsplit(f).path.rstrip("/").endswith("/search")
                else "product" if shop_handle(f) else "page")
        url_info.setdefault(k, {"fetch": f, "kind": kind, "host": host_of(f)})
        return k
    for r in rows:
        r["keys"] = [k for k in (reg(u) for u in r["ev"]) if k]
    for p in parts:
        for o in p["prices"]:
            o["key"] = reg(o["url"])
    if not args.sample or True:
        for b in bikes:
            if b["srcUrl"] and not args.sample:
                b["key"] = reg(b["srcUrl"])
    if args.hosts:
        keep = {h.strip() for h in args.hosts.split(",") if h.strip()}
        url_info = {k: v for k, v in url_info.items() if v["host"] in keep}
    by_host = defaultdict(list)
    for k, v in url_info.items():
        by_host[v["host"]].append((k, v["fetch"], v["kind"]))
    log(f"{len(url_info)} unique URLs on {len(by_host)} hosts (est. network time at {args.interval}s/host: ~{int(max((len(v) for v in by_host.values()), default=0) * args.interval / 60)} min for the busiest host if no catalog)")

    probes = {}
    if not args.skip_network:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = [ex.submit(probe_host, h, items, args.interval, log) for h, items in sorted(by_host.items(), key=lambda x: -len(x[1]))]
            for f in futs:
                try:
                    probes.update(f.result())
                except Exception as e:
                    log(f"  host job failed: {e!r}")
        log(f"network done: {len(probes)} URLs probed in {int(time.time()-t0)}s")

    # ---- 1. fitment rows
    row_good = defaultdict(int)       # (pid,bike) -> count of healthy evidence urls that name the bike (or list the product)
    per_url = defaultdict(lambda: {"gone": None, "err": None, "rows": []})
    baseline = state.get("urls", {})
    new_state_urls = dict(baseline)
    model_checked = model_missing = model_never_seen = 0
    listing_kinds = ("collection", "search")
    for r in rows:
        p = part_by[r["pid"]]
        named_any, seen_before, page_urls, probed_ok = False, False, [], 0
        for k in r["keys"]:
            rec = probes.get(k)
            if rec is None:
                continue
            if rec["gone"]:
                per_url[k]["gone"] = rec["gone"]; per_url[k]["rows"].append(r)
                continue
            if rec["err"]:
                per_url[k]["err"] = rec["err"]; per_url[k]["rows"].append(r)
                continue
            if rec["kind"] in listing_kinds:
                # a bike collection / search list is the evidence: the product must still be listed there
                dom = url_info[k]["host"]
                h = None
                for o in p["prices"]:
                    if o["url"] and host_of(unwrap(o["url"])) == dom and shop_handle(clean_fetch_url(o["url"])[0]):
                        h = shop_handle(clean_fetch_url(o["url"])[0]); break
                if h and rec.get("handles") and h not in rec["handles"]:
                    per_url[k]["gone"] = f"{rec['kind']} page no longer lists product '{h}'"; per_url[k]["rows"].append(r)
                    continue
                row_good[(r["pid"], r["bike"])] += 1
                probed_ok += 1
                bs = new_state_urls.setdefault(k, {"h": rec["hash"], "m": {}})
                continue
            probed_ok += 1
            named = model_named(norm(rec["text"]), aliases[r["bike"]])
            bs = new_state_urls.setdefault(k, {"h": rec["hash"], "m": {}})
            prev = bs.get("m", {}).get(r["bike"])
            seen_before = seen_before or bool(prev)
            bs.setdefault("m", {})[r["bike"]] = bool(prev) or named
            page_urls.append(k)
            if named:
                named_any = True
                row_good[(r["pid"], r["bike"])] += 1
        if page_urls:
            model_checked += 1
            if not named_any:
                model_missing += 1
                if not seen_before:
                    model_never_seen += 1
                base = ("the page named the bike when last checked" if seen_before else
                        "never seen on this page by this script (alias gap, tag-based or size-based evidence, or JS-rendered page): verify by hand, low priority")
                flags.add("MODEL_NAME_REMOVED", "high" if seen_before else "low", page_urls[0], p["pid"], p["name"], r["bike"],
                          f"no evidence page names {bike_by[r['bike']]['name']} (aliases: {', '.join(aliases[r['bike']][:4])}); {base}; source={r['source']}; {len(page_urls)} page(s)")
    # per-URL flags (one row per URL, with how many fitment rows depend on it)
    for k, d in per_url.items():
        rr = d["rows"]
        uniq = sorted({(x["pid"], x["bike"]) for x in rr})
        lonely = [x for x in uniq if row_good[x] == 0]
        sample = "; ".join(f"{a}|{b}" for a, b in uniq[:3]) + (f" (+{len(uniq)-3} more)" if len(uniq) > 3 else "")
        p0 = part_by[uniq[0][0]]
        if d["gone"]:
            sev = "high" if lonely else "med"
            flags.add("FIT_EVIDENCE_GONE", sev, k, p0["pid"], p0["name"], uniq[0][1],
                      f"evidence URL gone: {d['gone']}; {len(lonely)} of {len(uniq)} row(s) have no other healthy evidence; rows: {sample}", len(uniq))
        elif d["err"]:
            flags.add("LINK_DEAD", "low", k, p0["pid"], p0["name"], uniq[0][1],
                      f"evidence URL unreachable after retries: {d['err']} (retry next run); rows: {sample}", len(uniq))
    # hash change vs last month (one flag per URL)
    hash_flagged = 0
    for k, rec in probes.items():
        if rec["gone"] or rec["err"] or not rec["hash"] or rec["kind"] in listing_kinds:
            continue
        if k not in per_url and not any(k in r["keys"] for r in rows):
            continue
        prev = baseline.get(k)
        if prev and prev.get("h") and prev["h"] != rec["hash"]:
            deps = [r for r in rows if k in r["keys"]]
            u = sorted({(x["pid"], x["bike"]) for x in deps})
            p0 = part_by[u[0][0]] if u else {"pid": "", "name": ""}
            flags.add("FIT_PAGE_CHANGED", "med", k, p0["pid"], p0["name"], u[0][1] if u else "",
                      f"fitment-relevant page text changed since {state.get('run_date')} (needs a human look); {len(u)} row(s) depend on it", len(u))
            hash_flagged += 1
        if k in new_state_urls:
            new_state_urls[k]["h"] = rec["hash"]
        else:
            new_state_urls[k] = {"h": rec["hash"], "m": {}}

    # ---- 2/3. prices + links (per offer; per-URL dead flags)
    dead_by_url = defaultdict(list)
    price_checked = price_unreadable = price_skipped_fx = 0
    for p in parts:
        live_offers = sum(1 for o in p["prices"] if o.get("key") and probes.get(o["key"]) and not probes[o["key"]]["gone"] and not probes[o["key"]]["err"])
        for o in p["prices"]:
            if not o["url"]:
                continue
            k = o.get("key")
            rec = probes.get(k)
            # stale chk
            cd = parse_date(o["chk"])
            if cd is None or (today - cd).days > STALE_DAYS:
                flags.add("PRICE_STALE", "low", o["url"], p["pid"], p["name"], "",
                          f"{o['v']} offer chk {o['chk'] or 'missing'} is older than {STALE_DAYS} days")
            if rec is None:
                continue
            if rec["gone"]:
                dead_by_url[k].append((p, o, "gone: " + rec["gone"], live_offers))
                continue
            if rec["err"]:
                dead_by_url[k].append((p, o, "unreachable: " + rec["err"], live_offers))
                continue
            if rec.get("redirect"):
                dead_by_url[k].append((p, o, "redirects to " + rec["redirect"], live_offers))
            # price
            _, variant = clean_fetch_url(o["url"])
            live = rec["prices"]
            if variant and rec["variants"].get(variant):
                v = rec["variants"][variant]["p"]
                live = [v] if v is not None else []
            if not live:
                price_unreadable += 1
                continue
            host = url_info[k]["host"]
            if any(host.endswith(t) for t in NON_USD_TLDS) or "canada" in host:
                price_skipped_fx += 1
                continue
            price_checked += 1
            msg = price_issue(o["p"], live, rec["currency"], host)
            if msg:
                caps = [v["cap"] for v in rec["variants"].values() if v.get("cap")]
                if o["p"] and any(abs(c - o["p"]) < 0.5 for c in caps):
                    msg += " [data.js price = the store's compare-at price: store is running a SALE, not a permanent change]"
                pct = abs((min(live, key=lambda x: abs(x - o["p"])) - o["p"]) / o["p"] * 100) if o["p"] else 100
                sale = "SALE" in msg
                flags.add("PRICE_CHANGED", "low" if sale or pct < 15 else "med", o["url"], p["pid"], p["name"], "", f"{o['v']}: {msg}")
    for k, lst in dead_by_url.items():
        pids = sorted({x[0]["pid"] for x in lst})
        p0, o0, why, _ = lst[0]
        only = sum(1 for x in lst if x[3] == 0)
        flags.add("LINK_DEAD", "high" if only and not why.startswith("unreachable") and not why.startswith("redirects") else ("low" if why.startswith(("unreachable", "redirects")) else "med"),
                  k, p0["pid"], p0["name"], "", f"{why}; {len(pids)} part(s): {', '.join(pids[:4])}{' ...' if len(pids) > 4 else ''}; {only} of them have no other live store", len(pids))
    # bikes: link/price/stale + bikes.json drift
    if not args.sample:
        for b in bikes:
            bj = bikes_json.get(b["id"])
            if bj is None:
                flags.add("PRICE_CHANGED", "med", "", "", b["name"], b["id"], "bike missing from data/bikes.json")
            elif bj.get("price_usd") != b["price"]:
                flags.add("PRICE_CHANGED", "med", "", "", b["name"], b["id"], f"BIKES price ${b['price']} vs data/bikes.json price_usd ${bj.get('price_usd')} (price alerts read bikes.json)")
            sc = parse_date(b["srcChk"])
            if b["srcUrl"] and (sc is None or (today - sc).days > STALE_DAYS):
                flags.add("PRICE_STALE", "low", b["srcUrl"], "", b["name"], b["id"], f"bike price source chk {b['srcChk'] or 'missing'} older than {STALE_DAYS} days")
            k = b.get("key"); rec = probes.get(k) if k else None
            if rec:
                if rec["gone"] or rec["err"]:
                    flags.add("LINK_DEAD", "high" if rec["gone"] else "low", b["srcUrl"], "", b["name"], b["id"], f"bike buy link {'gone: ' + rec['gone'] if rec['gone'] else 'unreachable: ' + rec['err']}")
                elif rec["prices"]:
                    _, variant = clean_fetch_url(b["srcUrl"])
                    live = rec["prices"]
                    if variant and rec["variants"].get(variant):
                        live = [rec["variants"][variant]["p"]]
                    cands = [x for x in (b["price"], b["msrp"]) if x]
                    if cands and all(price_issue(c, live, rec["currency"], url_info[k]["host"]) for c in cands):
                        flags.add("PRICE_CHANGED", "med", b["srcUrl"], "", b["name"], b["id"],
                                  f"bike live price {sorted(set(live))} matches neither BIKES price ${b['price']} nor msrp ${b['msrp']}")

    # ---- 4. builds / guides
    def part_issue(pid, bike_id):
        p = part_by.get(pid)
        if not p:
            return "not in catalog"
        if p["hidden"]:
            return "retired (hidden)"
        st, _ = check_fit_status(p, bike_id, fitment)
        if st != "confirmed":
            return f"fit is {st}, not confirmed"
        offers = [o for o in p["prices"] if o["p"] is not None and o["url"]]
        if not offers:
            return "no priced offer"
        if not any(o["chk"] for o in offers):
            return "price not re-checked"
        return None
    for kind, items in (("build", cat["builds"]), ("guide", cat["guides"])):
        for it in items:
            label = it.get("id") or f"{it['bike']}/{it.get('tier')}"
            if it["bike"] not in bike_by:
                flags.add("GUIDE_OR_BUILD_BROKEN", "high", "", "", label, it["bike"], f"{kind} references unknown bike")
                continue
            cats_seen = {}
            for pid in it["pids"]:
                iss = part_issue(pid, it["bike"])
                if iss is None and pid in part_by:
                    c = part_by[pid]["cat"]
                    if c in cats_seen and kind == "guide":
                        iss = f"two parts in category {c} (also {cats_seen[c]})"
                    cats_seen[c] = pid
                if iss:
                    flags.add("GUIDE_OR_BUILD_BROKEN", "high", "", pid, part_by.get(pid, {}).get("name", pid), it["bike"], f"{kind} '{label}': {iss}")

    # ---- 5. affiliate hygiene
    coded_hosts = defaultdict(list)   # program label -> sample urls
    def audit(url, where, is_bike, label="", bike_id="", src=""):
        if not url:
            return
        sp = urllib.parse.urlsplit(url)
        h = sp.netloc.lower()
        q = {k.lower(): v for k, v in urllib.parse.parse_qsl(sp.query, keep_blank_values=True)}
        target = unwrap(url)
        th = host_of(target)
        tl = root_label(th)
        is_net = any(h.endswith(n) for n in AFF_NETWORK_HOSTS)
        marker = [k for k in q if k in AFF_MARKER_PARAMS and not (k == "tag" and "amazon" not in h)]
        coded = is_net or bool(marker)
        if coded:
            coded_hosts[tl if is_net else root_label(h)].append(url)
        def bad(msg, sev="high"):
            flags.add("AFFILIATE_TAG_ISSUE", sev, url, "" if is_bike else label, label, bike_id, f"{where}: {msg}")
        if h.endswith("sjv.io") and not is_bike:
            bad("Voro/sjv.io affiliate link on a PART (Voro links go on bikes only)")
        if is_bike and tl == "voromotors":
            if not h.endswith("sjv.io"):
                bad("Voro bike link is not going through voromotors.sjv.io")
        if is_bike and h.endswith("sjv.io") and tl != "voromotors":
            bad(f"sjv.io link points at {th}, not Voro")
        if th.endswith("tuttiosport.com"):
            if q.get("ref") is None:
                bad("Tuttio link missing ref= affiliate code")
        if th.endswith("gritshift.com") or h.endswith("gritshift.com"):
            extra = [k for k in q if k in AFF_MARKER_PARAMS or k.startswith("utm_")]
            if extra or is_net:
                bad(f"GritShift link carries affiliate/tracking params: {','.join(extra) or h}")
        if marker and tl not in PROGRAM_NAMES and h != "tuttiosport.com":
            bad(f"affiliate-style param(s) {','.join(marker)} on {h} (not a live program)", "med")
    if True:
        for p in parts:
            for o in p["prices"]:
                audit(o["url"], f"{o['v']} offer", False, p["pid"])
                if o["url"] and o.get("aff") and not (host_of(o["url"]).endswith("tuttiosport.com") and "ref=" in o["url"]):
                    flags.add("AFFILIATE_TAG_ISSUE", "high", o["url"], p["pid"], p["name"], "", f"offer flagged aff:true but carries no known affiliate code")
                if o["url"] and "ref=" in o["url"] and host_of(o["url"]).endswith("tuttiosport.com") and not o.get("aff"):
                    flags.add("AFFILIATE_TAG_ISSUE", "med", o["url"], p["pid"], p["name"], "", "Tuttio link has ref= but is not marked aff:true (site would not label it 'affiliate link')")
        if not args.sample:
            for b in bikes:
                audit(b["srcUrl"], "bike buy link", True, b["name"], b["id"])
    disc_l = disclosure.lower()
    for lbl, urls in coded_hosts.items():
        name = PROGRAM_NAMES.get(lbl, lbl)
        if name.lower() not in disc_l:
            flags.add("AFFILIATE_TAG_ISSUE", "high", urls[0], "", name, "", f"{len(urls)} affiliate-coded link(s) to '{lbl}' but affiliate-disclosure.html does not mention {name}")
    if not args.sample:
        for pend in PENDING_PROGRAMS:
            if pend.lower() in disc_l and root_label(pend.lower().replace(" ", "")) not in coded_hosts:
                flags.add("AFFILIATE_TAG_ISSUE", "med", "", "", pend, "", f"disclosure mentions {pend} but no link actually carries its affiliate code (disclosure should list only live codes)")

    # ---- 6. OOS_30D via git history
    oos_note = ""
    if not args.skip_history:
        with tempfile.TemporaryDirectory() as td:
            old = git_data_at(repo, OOS_DAYS, today, td)
            mid = git_data_at(repo, OOS_DAYS // 2, today, td)
            if old:
                oc = load_catalog(Path(old[2]), repo / "builds.js")
                old_stock = {p["pid"]: p["stock"] for p in oc["parts"]}
                mid_stock = {}
                if mid:
                    mid_stock = {p["pid"]: p["stock"] for p in load_catalog(Path(mid[2]), repo / "builds.js")["parts"]}
                n = 0
                for p in parts:
                    if p["stock"] == "out_of_stock" and old_stock.get(p["pid"]) == "out_of_stock" and mid_stock.get(p["pid"], "out_of_stock") == "out_of_stock":
                        flags.add("OOS_30D", "low", p["prices"][0]["url"] if p["prices"] else "", p["pid"], p["name"], "",
                                  f"out of stock in data.js now (stockChk {p['stockChk'] or '?'}) and at {old[0]} ({old[1]})" + (f" and {mid[0]} ({mid[1]})" if mid else ""))
                        n += 1
                oos_note = f"compared with data.js at {old[0]} ({old[1]})"
            else:
                oos_note = "git history older than 30 days not available: OOS_30D skipped"
        log(f"OOS_30D: {oos_note}")

    # ---- write outputs
    frows = sorted(flags.rows, key=lambda r: (SEV_ORDER[r["severity"]], FLAG_ORDER.index(r["flag"]), r["pid"], r["bike"]))
    with open(out_dir / "flags.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["severity", "flag", "pid", "part", "bike", "url", "detail", "rows"])
        w.writeheader()
        w.writerows(frows)
    counts = Counter(r["flag"] for r in frows)
    sev_counts = Counter(r["severity"] for r in frows)
    prev_keys = None
    prev_dirs = sorted([d for d in out_dir.parent.glob("[0-9][0-9][0-9][0-9]-[0-9][0-9]") if d != out_dir and (d / "flags.csv").exists()])
    if prev_dirs:
        with open(prev_dirs[-1] / "flags.csv") as f:
            prev_keys = {(r["flag"], r["pid"], r["bike"], r["url"]) for r in csv.DictReader(f)}
    new_count = sum(1 for r in frows if (r["flag"], r["pid"], r["bike"], r["url"]) not in prev_keys) if prev_keys is not None else None
    elapsed = int(time.time() - t0)
    meta = {"run_date": str(today), "repo_head": subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip(),
            "stock_checked_in_data_js": cat["stockChecked"], "sample": args.sample or None, "skip_network": args.skip_network,
            "bikes": len(bikes), "parts": len(parts), "fitment_rows_checked": len(rows), "unique_urls": len(url_info), "urls_probed": len(probes),
            "hosts": len(by_host), "prices_compared": price_checked, "prices_unreadable": price_unreadable, "prices_skipped_non_usd": price_skipped_fx,
            "model_checks": model_checked, "model_missing": model_missing, "model_never_seen": model_never_seen, "hash_changes": hash_flagged, "baseline": "none (first run)" if first_run else state.get("run_date"),
            "flags_total": len(frows), "flags_by_type": dict(counts), "flags_by_severity": dict(sev_counts), "new_vs_last_month": new_count,
            "oos_history": oos_note, "elapsed_sec": elapsed}
    json.dump(meta, open(out_dir / "run.json", "w"), indent=1)

    lines = [f"eBikePartsPicker monthly re-check, {today} (flag-only; nothing in the repo was edited)",
             f"Checked {len(rows):,} confirmed fitment rows, {price_checked:,} live prices, {len(url_info):,} URLs on {len(by_host)} hosts" + (f" (SAMPLE of {args.sample} parts)" if args.sample else "") + f", in {elapsed//60} min.",
             "Flags: " + (", ".join(f"{f} {counts[f]}" for f in FLAG_ORDER if counts[f]) or "none") + f"  (total {len(frows)}; high {sev_counts['high']}, med {sev_counts['med']}, low {sev_counts['low']})"]
    if new_count is not None:
        lines.append(f"New since last month: {new_count}")
    if first_run:
        lines.append("First run: no baseline yet, so FIT_PAGE_CHANGED can't fire and MODEL_NAME_REMOVED could not say whether the name was ever there. Next month's run will compare against this one.")
    top = frows[:20]
    lines.append("")
    lines.append(f"Top {len(top)} (by severity):")
    for i, r in enumerate(top, 1):
        who = " / ".join(x for x in (r["pid"] or r["part"], r["bike"]) if x)
        lines.append(f"{i}. [{r['severity']}] {r['flag']} {who}: {r['detail'][:230]}" + (f" {r['url']}" if r["url"] else ""))
    lines.append("")
    lines.append(f"Full list: {out_dir / 'flags.csv'}")
    summary = "\n".join(lines)
    (out_dir / "summary.txt").write_text(summary + "\n")

    md = [f"# Monthly re-check {today}", "", "Flag-only run: data.js, builds.js and bikes.json were read, never edited. No fitment was downgraded.", "",
          "## Coverage", "",
          f"- Repo head: `{meta['repo_head']}` (data.js STOCK_CHECKED `{cat['stockChecked']}`)",
          f"- {len(parts):,} listed parts, {len(bikes)} bikes, {len(rows):,} confirmed fitment rows re-verified",
          f"- {len(url_info):,} unique URLs on {len(by_host)} hosts; {len(probes):,} probed" + (" (network skipped)" if args.skip_network else ""),
          f"- Prices compared: {price_checked:,} (unreadable live price: {price_unreadable:,}; non-USD store skipped: {price_skipped_fx:,})",
          f"- Model-name checks (per fitment row): {model_checked:,}; {model_missing:,} rows have no evidence page naming the bike ({model_never_seen:,} of them never seen before = low priority)",
          f"- Baseline: {meta['baseline']}; OOS history: {oos_note or 'skipped'}",
          f"- Run time: {elapsed//60} min {elapsed%60} s", "", "## Flags", "", "| Flag | Count |", "|---|---|"]
    md += [f"| {f} | {counts[f]} |" for f in FLAG_ORDER]
    pc = defaultdict(list)
    for r in frows:
        if r["flag"] == "PRICE_CHANGED" and r["url"]:
            m_ = re.search(r"\(([+-][\d.]+)%", r["detail"])
            if m_:
                pc[host_of(unwrap(r["url"]))].append((float(m_.group(1)), "SALE" in r["detail"]))
    md += [f"| **Total** | **{len(frows)}** |", "", f"Severity: high {sev_counts['high']}, med {sev_counts['med']}, low {sev_counts['low']}." + (f" New vs last month: {new_count}." if new_count is not None else ""), "",
           "## Price changes by store (a store-wide sale shows up here as one big cluster)", "", "| Store | PRICE_CHANGED | median % | marked SALE |", "|---|---|---|---|"]
    for h_, lst in sorted(pc.items(), key=lambda x: -len(x[1]))[:12]:
        pcts_ = sorted(x[0] for x in lst)
        md.append(f"| {h_} | {len(lst)} | {pcts_[len(pcts_)//2]:+.0f}% | {sum(1 for x in lst if x[1])} |")
    md += ["", "## Top 20", ""]
    for i, r in enumerate(top, 1):
        who = " / ".join(x for x in (r["pid"] or r["part"], r["bike"]) if x)
        md.append(f"{i}. **{r['flag']}** ({r['severity']}) `{who}`: {r['detail']}" + (f"\n   {r['url']}" if r["url"] else ""))
    md += ["", "## Notes", "",
           "- Severity: high = evidence gone / guide broken / affiliate rule broken; med = page changed, name missing, big price move; low = stale date, unreachable, small price move, OOS history.",
           "- FIT_PAGE_CHANGED hashes the product title, description, tags and type (Shopify) or the main page text (other stores, prices removed). Non-Shopify pages can change for harmless reasons; treat it as a prompt to look.",
           "- MODEL_NAME_REMOVED uses the alias map in scripts/monthly_recheck.py (ALIAS_OVERRIDES). A new seller spelling means add an alias, not a fitment change.",
           "- Next step with Josh's OK: a follow-up PR moves flagged confirmed rows to `verify` (fitment rule) and refreshes prices and chk dates. This script never does it."]
    (out_dir / "report.md").write_text("\n".join(md) + "\n")

    if not args.no_state_write and not args.sample and not args.skip_network:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        json.dump({"run_date": str(today), "urls": new_state_urls}, open(state_path, "w"))
        log(f"baseline state written: {state_path} ({len(new_state_urls)} URLs)")
    print()
    print(summary)

if __name__ == "__main__":
    main()
