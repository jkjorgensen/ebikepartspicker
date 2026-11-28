"""Nov 28 growth round helpers for build_seo.py (kept in their own module so the
generator diff stays small).

- drop_html(): static "Price dropped" badge, only from a real recorded drop
  (offer was/wasChk written by tools/stock_check.py when a store's price fell
  below the previously checked price). Shown for 14 days after the new check.
- sort_offers() / part_buy_cta(): on part pages, a partner (affiliate) store
  that actually sells the part is listed first and gets the primary button.
  Only offers already marked aff (Tuttio today) qualify; Voro parts, GritShift
  and everything else stay plain links.
- guide_bike_buy(): guide pages show the bike's partner buy box (Voro/Tuttio),
  not only for the three bikes priced at Voro.
- bike_faq(): FAQ + short comparison for the top-viewed bike pages, built only
  from data already on the site (catalog counts, listed bike specs and their
  sources, build guide totals, buy links). No new specs.
"""
import html, json, os, urllib.parse
from datetime import datetime

e = lambda s: html.escape(str(s if s is not None else ''), quote=True)
money = lambda p: '${:,.0f}'.format(p) if p is not None else ''
money2 = lambda p: ('${:,.2f}'.format(p).replace('.00', '')) if p is not None else ''
PRICE_DROP_DAYS = 14
SEP = ' \u00b7 '

# Top bike pages by views with no buy clicks (Analytics Engine ebpp_clicks, last 30 days to
# Nov 28, 2026: ss30 43 views, sr 32, ultrabee 28, ss20 25, tuttio-soleil01 25; 0 clicks from
# those pages). Search Console had 0-1 impressions for each in the same window.
FAQ_BIKES = ['ss30', 'sr', 'ultrabee', 'ss20', 'tuttio-soleil01']
COMPARE_WITH = {
  'ss30': ['ss20', 'ss40', 'sr'],
  'sr': ['ss30', 'ultrabee'],
  'ultrabee': ['ultrabee-21kw', 'sr'],
  'ss20': ['ss30', 'lightbee'],
  'tuttio-soleil01': ['yozma-in10', 'segway-x160', 'rtr-lite'],
}


def _date(s):
  try: return datetime.strptime(s, '%Y-%m-%d').date()
  except Exception: return None


def price_drop(pr, today):
  if not pr or pr.get('p') is None or pr.get('was') is None or not pr.get('chk'): return None
  try:
    if not float(pr['was']) > float(pr['p']): return None
  except Exception: return None
  d, t = _date(pr['chk']), _date(today)
  if not d or not t or (t - d).days > PRICE_DROP_DAYS: return None
  return pr


def drop_html(pr, today):
  d = price_drop(pr, today)
  if not d: return ''
  tip = f"Was {money2(d['was'])}" + (f" (checked {d['wasChk']})" if d.get('wasChk') else '') + f", now {money2(d['p'])} (checked {d['chk']})"
  return f'<span class="pdrop" title="{e(tip)}">Price dropped <s class="pdrop-was">{e(money2(d["was"]))}</s></span>'


def sort_offers(prices):
  """Partner (affiliate) offers first, then the rest in their existing order."""
  return sorted(prices, key=lambda x: 0 if x.get('aff') and x.get('url') else 1)


def part_buy_cta(o, host):
  af = [x for x in o.get('prices') or [] if x.get('aff') and x.get('url')]
  if not af: return ''
  x = af[0]; vendor = x.get('v') or host(x['url'])
  pr = f' \u2014 {money2(x["p"])}' if x.get('p') is not None else ''
  return (f'<div class="pp-buy"><a class="sbuy sbuy-voro" href="{e(x["url"])}" rel="sponsored noopener" target="_blank">Buy at {e(vendor)}{e(pr)}</a>'
          f' <a class="sp-chk" href="/affiliate-disclosure">(affiliate link)</a></div>')


def is_aff_buy(buy):
  return bool(buy and buy.get('url') and (buy.get('aff') or 'sjv.io' in buy['url']))


def guide_bike_buy(b, buy_urls, bike_buy_html):
  return bike_buy_html(b['id'], b['name']) if is_aff_buy(buy_urls.get(b['id'])) else ''


def _bikes_json(root):
  j = json.load(open(os.path.join(root, 'data', 'bikes.json')))
  return {b['id']: b for b in (j['bikes'] if isinstance(j, dict) else j)}


def _host(u):
  try: return urllib.parse.urlparse(u).netloc.replace('www.', '')
  except Exception: return ''


def bike_faq(b, D, root, buy_urls, bike_price, cat_names, compare_dir_exists, base):
  """Returns (html, FAQPage dict) or ('', None). Every answer comes from data already
  shown on the site; anything not on file is left out rather than estimated."""
  if b['id'] not in FAQ_BIKES: return '', None
  BJ = _bikes_json(root); bj = BJ.get(b['id'], {}); ss = bj.get('stock_specs') or {}
  BK = {x['id']: x for x in D['bikes']}
  name = b['name']; qa = []  # (question, answer_html, answer_text)

  conf = [p for p in b['parts'] if p['status'] == 'confirmed']
  mod = [p for p in b['parts'] if p['status'] == 'requires_mod']
  if conf:
    bycat = {}
    for p in conf: bycat[p['cat']] = bycat.get(p['cat'], 0) + 1
    top = sorted(bycat.items(), key=lambda kv: -kv[1])[:4]
    tops = ', '.join(f'{cat_names.get(c, c)} ({n})' for c, n in top)
    t = (f'{len(conf)} aftermarket parts are confirmed to fit the {name} across {len(bycat)} categories'
         + (f', plus {len(mod)} that fit with modifications' if mod else '')
         + f'. The biggest categories are {tops}. A part is only listed as a confirmed fit when the seller or manufacturer names this bike, or it is sold as universal fit.')
    qa.append((f'How many aftermarket parts fit the {name}?', e(t) + ' <a href="/fitment-methodology">How we confirm fitment</a>.', t))

  specs = []
  if b.get('kw'): specs.append(f'{b["kw"]} kW peak power')
  if b.get('weight'): specs.append(f'{b["weight"]} lb')
  if ss.get('front_wheel_in') and ss.get('rear_wheel_in'): specs.append(f'{ss["front_wheel_in"]}-inch front and {ss["rear_wheel_in"]}-inch rear wheels')
  if specs or b.get('price') is not None:
    t = f'We list the {name} at {bike_price(b)}' + (f' (checked {b["srcChk"]})' if b.get('srcChk') else '') + (', with ' + ', '.join(specs) if specs else '') + '.'
    h = e(t)
    if ss.get('wheel_source_url'):
      h += f' Wheel sizes from <a href="{e(ss["wheel_source_url"])}" rel="noopener" target="_blank">{e(_host(ss["wheel_source_url"]))}</a>.'
      t += f' Wheel sizes from {_host(ss["wheel_source_url"])}.'
    qa.append((f'What are the {name}\u2019s stock specs and price?', h, t))

  gs = sorted([g for g in D['guides'] if g['bike'] == b['id']], key=lambda g: ['budget', 'smart', 'dream'].index(g['tier']) if g['tier'] in ('budget', 'smart', 'dream') else 9)
  if gs:
    lab = {'budget': 'Budget', 'smart': 'Smart money', 'dream': 'Dream'}
    parts = [f'{lab.get(g["tier"], g["tier"])} {money(sum(r["p"] for r in g["rows"]))} ({len(g["rows"])} parts)' for g in gs]
    t = f'Our {name} build guides use only confirmed-fit parts at checked prices: ' + '; '.join(parts) + '. Totals are parts only, not the bike.'
    h = e(f'Our {name} build guides use only confirmed-fit parts at checked prices: ') + '; '.join(
      f'<a href="/guides/{e(b["id"])}-{e(g["tier"])}/">{e(lab.get(g["tier"], g["tier"]))} {e(money(sum(r["p"] for r in g["rows"])))}</a> ({len(g["rows"])} parts)' for g in gs) + '. Totals are parts only, not the bike.'
    qa.append((f'What does it cost to upgrade the {name}?', h, t))

  pw = [x for x in D['power'] if x['bike'] == b['id']]
  if pw:
    x = pw[0]; tot = sum(r['p'] for r in x['rows'])
    t = f'Yes. Our {name} power upgrade ({x["title"]}) is {len(x["rows"])} confirmed-fit parts totaling {money(tot)} at checked prices: ' + ', '.join(r['name'] for r in x['rows']) + '.'
    qa.append((f'Is there a power upgrade for the {name}?', e(t) + f' <a href="/power/#{e(b["id"])}">See the power upgrade</a>.', t))

  buy = buy_urls.get(b['id'])
  if buy and buy.get('url'):
    aff = is_aff_buy(buy)
    t = f'We link to {buy.get("source") or "a store"} for the {name}' + (f', and also to {buy.get("altSource")}' if buy.get('alt') and buy.get('altSource') else '') + '.'
    h = e(f'We link to ') + f'<a href="{e(buy["url"])}" rel="{"sponsored noopener" if aff else "noopener"}" target="_blank">{e(buy.get("source") or "a store")}</a>' + (
      f', and also to <a href="{e(buy["alt"])}" rel="noopener" target="_blank">{e(buy.get("altSource") or "another store")}</a>' if buy.get('alt') else '') + e(f' for the {name}.') + (
      ' <a href="/affiliate-disclosure">(affiliate link)</a>' if aff else '')
    qa.append((f'Where can I buy the {name}?', h, t))

  # comparison
  rows = []
  for oid in COMPARE_WITH.get(b['id'], []):
    o = BK.get(oid)
    if not o: continue
    rows.append(o)
  cmp_html = ''
  if rows:
    def cell(x, k, fmt):
      v = x.get(k)
      return fmt(v) if v not in (None, '') else 'Not verified'
    allb = [b] + rows
    hdr = ''.join(f'<th>{e(x["name"])}</th>' for x in allb)
    def nconf(x): return sum(1 for p in x['parts'] if p['status'] == 'confirmed')
    trs = [('Price', [bike_price(x) for x in allb]),
           ('Peak power', [cell(x, 'kw', lambda v: f'{v} kW') for x in allb]),
           ('Weight', [cell(x, 'weight', lambda v: f'{v} lb') for x in allb]),
           ('Confirmed-fit parts', [str(nconf(x)) for x in allb])]
    body = ''.join(f'<tr><th scope="row">{e(k)}</th>' + ''.join(f'<td>{e(v)}</td>' for v in vs) + '</tr>' for k, vs in trs)
    links = []
    for o in rows:
      pair = None
      for a, c in ((b['id'], o['id']), (o['id'], b['id'])):
        if compare_dir_exists(f'{a}-vs-{c}'): pair = f'{a}-vs-{c}'
      links.append(f'<a href="/compare/{e(pair)}/">{e(name)} vs {e(o["name"])}</a>' if pair else f'<a href="/bikes/{e(o["id"])}/">{e(o["name"])} parts</a>')
    sents = []
    for o in rows:
      bits = []
      if b.get('kw') and o.get('kw'): bits.append(f'{b["kw"]} kW vs {o["kw"]} kW')
      if b.get('weight') and o.get('weight'): bits.append(f'{b["weight"]} lb vs {o["weight"]} lb')
      bits.append(f'{nconf(b)} vs {nconf(o)} confirmed-fit parts in our catalog')
      sents.append(f'Against the {o["name"]}: ' + ', '.join(bits) + '.')
    cmp_html = (f'<section class="seo-cmp"><h2>{e(name)} compared</h2><p>{e(" ".join(sents))}</p>'
                f'<div class="seo-cmp-wrap"><table class="pp-tab"><thead><tr><th></th>{hdr}</tr></thead><tbody>{body}</tbody></table></div>'
                f'<p class="sp-chk">Specs and prices as listed on each bike\u2019s page here. More: {SEP.join(links)}</p></section>')
  if not qa and not cmp_html: return '', None
  faq_html = ''
  ld = None
  if qa:
    faq_html = f'<section class="seo-faq"><h2>{e(name)} FAQ</h2>' + ''.join(f'<h3>{e(q)}</h3><p>{h}</p>' for q, h, _ in qa) + '</section>'
    ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
      {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": t}} for q, _, t in qa]}
  return cmp_html + faq_html, ld
