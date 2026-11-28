#!/usr/bin/env python3
"""Audit Product structured data on the built pages (read-only, stdlib only).

eBikePartsPicker is a comparison/affiliate site, not a seller. Google's
merchant-listing docs say only pages where a shopper can purchase the product
qualify for merchant listings (Shopping tab / free listings); pages that link
to other sites that sell it do not. They can qualify for *product snippets*,
which accept AggregateOffer. This script flags markup that implies we sell the
product. Run it on the Product+Offer schema PR (audit item 1e) before merging.

Usage:  python3 scripts/check_product_markup.py [--root .] [--strict]
Exit 1 with --strict if any issue is found.
"""
import argparse, json, re, sys
from collections import Counter
from pathlib import Path

LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
MERCHANT_ONLY = {"shippingDetails", "hasMerchantReturnPolicy"}

def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)

def types(n):
    t = n.get("@type", [])
    return t if isinstance(t, list) else [t]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    root = Path(a.root)
    pages = Counter(); issues = []
    for f in sorted(root.rglob("index.html")):
        rel = f.relative_to(root)
        if rel.parts[0] in ("vendor", "node_modules"):
            continue
        for m in LD.finditer(f.read_text(errors="ignore")):
            try:
                data = json.loads(m.group(1))
            except ValueError:
                issues.append((str(rel), "unparsable JSON-LD")); continue
            for n in walk(data):
                ts = types(n)
                if "Product" in ts:
                    pages["pages with Product"] += 1
                    offers = n.get("offers")
                    if not offers:
                        issues.append((str(rel), "Product without offers/review/rating (not eligible for snippets)")); continue
                    for o in (offers if isinstance(offers, list) else [offers]):
                        ot = types(o)
                        if "Offer" in ot and "AggregateOffer" not in ot:
                            issues.append((str(rel), "plain Offer: implies eBPP sells it; use AggregateOffer (lowPrice/highPrice/offerCount) or one Offer per linked retailer with that retailer as seller"))
                        if "AggregateOffer" in ot:
                            for k in ("lowPrice", "priceCurrency"):
                                if k not in o:
                                    issues.append((str(rel), f"AggregateOffer missing {k}"))
                        bad = MERCHANT_ONLY & set(o)
                        if bad:
                            issues.append((str(rel), f"merchant-only properties on a non-seller page: {sorted(bad)}"))
    print(f"Product pages: {pages['pages with Product']}")
    by = Counter(msg for _, msg in issues)
    for msg, c in by.most_common():
        print(f"  {c:5d}  {msg}")
        for p, m in [i for i in issues if i[1] == msg][:3]:
            print(f"          e.g. {p}")
    if not issues:
        print("No issues.")
    sys.exit(1 if (issues and a.strict) else 0)

if __name__ == "__main__":
    main()
