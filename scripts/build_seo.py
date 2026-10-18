"""Generate static crawlable pages from the app data. Run: python scripts/seo_extract.py /tmp/seo.json && python scripts/build_seo.py /tmp/seo.json"""
import json,sys,os,html,shutil,urllib.parse
D=json.load(open(sys.argv[1])); ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE='https://ebikepartspicker.pages.dev'; V='4.8.1'; TODAY='2026-10-18'
e=lambda s: html.escape(str(s if s is not None else ''),quote=True)
money=lambda p: '${:,.0f}'.format(p) if p is not None else ''
CAT={c['id']:c for c in D['cats']}; BK={b['id']:b for b in D['bikes']}
TIER={'budget':'Budget','smart':'Smart money','dream':'Dream'}
def host(u):
  try:
    q=urllib.parse.urlparse(u)
    if 'sjv.io' in q.netloc: return 'Voro Motors'
    return q.netloc.replace('www.','')
  except Exception: return 'retailer'
def buy(pr,label=None):
  if not pr or not pr.get('url'): return ''
  if pr.get('aff'): return f'<a class="sbuy sbuy-voro" href="{e(pr["url"])}" rel="sponsored noopener" target="_blank">Buy at Voro Motors</a>'
  return f'<a class="sbuy" href="{e(pr["url"])}" rel="noopener" target="_blank">View at {e(pr.get("v") or host(pr["url"]))}</a>'
def builder(bid,sel=None):
  h={'b':bid}; 
  if sel: h['s']=sel
  return '/#'+urllib.parse.quote(json.dumps(h,separators=(',',':')),safe='{}":,')
def page(path,title,desc,body,crumbs,img=None,ld_extra=None):
  url=BASE+path; img=img or BASE+'/img/bikes/og-ventus-plus.jpg'
  bl={"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":i+1,"name":n,"item":BASE+u} for i,(n,u) in enumerate(crumbs)]}
  lds=[bl]+(ld_extra or [])
  cr=' <span>/</span> '.join(f'<a href="{e(u)}">{e(n)}</a>' for n,u in crumbs[:-1])+f' <span>/</span> {e(crumbs[-1][0])}'
  nav=''.join(f'<a href="/{s}.html">{t}</a>' for s,t in [x for x in [('about','About'),('fitment-methodology','Fitment methodology'),('affiliate-disclosure','Affiliate disclosure'),('privacy','Privacy'),('terms','Terms'),('contact','Contact')] if os.path.exists(os.path.join(ROOT,x[0]+'.html'))])
  AFF=' (<a href="/affiliate-disclosure.html">disclosure</a>)' if os.path.exists(os.path.join(ROOT,'affiliate-disclosure.html')) else ''
  out=f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="eBikePartsPicker"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{e(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{e(title)}"><meta name="twitter:description" content="{e(desc)}"><meta name="twitter:image" content="{e(img)}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M13 2 4 14h6l-1 8 9-12h-6l1-8z' fill='%23c8f04a'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css?v={V}">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<script type="application/ld+json">{json.dumps(lds if len(lds)>1 else bl,ensure_ascii=False)}</script>
</head><body class="tp seo">
<header class="tp-head"><a class="tp-brand" href="/">eBikePartsPicker</a><a class="tp-back" href="/">Open the parts builder \u2192</a></header>
<main class="tp-main seo-main"><nav class="crumbs">{cr}</nav>{body}
<p class="seo-fine">Prices and stock were checked on the retailer\u2019s page on the date shown and can change. Confirm fitment, price and stock before you buy. Some links are affiliate links{AFF}.</p></main>
<footer class="sitefoot tp-foot"><nav class="tp-nav">{nav}</nav></footer>
</body></html>
"""
  d=os.path.join(ROOT,path.strip('/')); os.makedirs(d,exist_ok=True); open(os.path.join(d,'index.html'),'w').write(out)
  return url
urls=[]
def bike_price(b):
  if b['price'] is None: return 'Price not yet verified'
  t={'msrp':' MSRP','voro':' at Voro Motors'}.get(b['src'],'')
  return money(b['price'])+t
def partrow(p,bid):
  pr=p['price']; img=f'<img src="/{e(p["img"])}" alt="{e(p["name"])} for the {e(BK[bid]["name"])}" loading="lazy" width="96" height="96">' if p['img'] else '<span class="sp-noimg"></span>'
  st='<span class="sp-mod">Requires modification</span>' if p['status']!='confirmed' else ('<span class="sp-uni">Universal fit</span>' if 'universal' in p.get('note','').lower() else '')
  price=f'<span class="sp-price">{money(pr["p"])}</span><span class="sp-chk">{e(pr.get("v") or "")}{(", checked "+e(pr["chk"])) if pr.get("chk") else ""}</span>' if pr and pr.get('p') is not None else '<span class="sp-chk">Price not listed</span>'
  return f'<li class="sp-row">{img}<div class="sp-info"><strong>{e(p["name"])}</strong>{st}<div>{price}</div></div><div class="sp-act">{buy(pr)}<a class="sp-open" href="{e(builder(bid,{p["cat"]:p["pid"]}))}">Add to build</a></div></li>'
guides_by_bike={}
for g in D['guides']: guides_by_bike.setdefault(g['bike'],[]).append(g)
power_bikes={pw['bike'] for pw in D['power']}
seo_bikes=[b for b in D['bikes'] if len(b['parts'])>=3]
# bike pages
for b in seo_bikes:
  bid=b['id']; parts=b['parts']; cats=[]
  for c in D['cats']:
    ps=[p for p in parts if p['cat']==c['id']]
    if ps: cats.append((c,sorted(ps,key=lambda p:(not (p['price'] or {}).get('aff'),p['status']!='confirmed',(p['price'] or {}).get('p') or 9e9))))
  nconf=sum(p['status']=='confirmed' for p in parts)
  FM='<a href="/fitment-methodology.html">How we confirm fitment</a> \u00b7 ' if os.path.exists(os.path.join(ROOT,'fitment-methodology.html')) else ''
  spec=[('Price',bike_price(b))]+([('Peak power',f'{b["kw"]} kW')] if b.get('kw') else [])+([('Weight',f'{b["weight"]} lb')] if b.get('weight') else [])
  specs=''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k,v in spec)
  bikebuy=f'<a class="sbuy sbuy-voro" href="{e(b["srcUrl"])}" rel="sponsored noopener" target="_blank">Buy the {e(b["name"])} at Voro Motors</a>' if b['src']=='voro' and b['srcUrl'] else ''
  gl=''.join(f'<li><a href="/guides/{bid}-{g["tier"]}/">{e(b["name"])} {e(TIER.get(g["tier"],g["tier"]))} build</a></li>' for g in guides_by_bike.get(bid,[]))
  extra=(f'<h2>Build guides</h2><ul class="seo-links">{gl}</ul>' if gl else '')+(f'<p><a href="/power/#{bid}">Power upgrades for the {e(b["name"])}</a></p>' if bid in power_bikes else '')
  toc=' '.join(f'<a href="#{c["id"]}">{e(c["name"])}</a>' for c,_ in cats)
  secs=''.join(f'<section id="{c["id"]}"><h2>{e(c["name"])} for the {e(b["name"])}</h2><ul class="sp-list">{"".join(partrow(p,bid) for p in ps)}</ul></section>' for c,ps in cats)
  body=f"""<h1>{e(b['name'])} upgrades &amp; parts</h1>
<p class="seo-lede">{nconf} aftermarket parts that fit the {e(b['name'])}: each is either listed for this bike by the seller or manufacturer, or sold as a universal-fit part. Prices were checked on the retailer\u2019s page. Pick parts to see your build\u2019s total price, weight and estimated power.</p>
<figure class="seo-hero"><img src="/img/bikes/{bid}.webp?v=4.1.0" alt="{e(b['name'])} electric dirt bike" width="1600" height="1000"></figure>
<dl class="seo-specs">{specs}</dl>
<p class="seo-cta"><a class="cta" href="{e(builder(bid))}">Build your {e(b['name'])}</a> {bikebuy}</p>
{extra}<nav class="seo-toc">{toc}</nav>{secs}
<p>{FM}<a href="/bikes/">All bikes</a></p>"""
  il={"@context":"https://schema.org","@type":"ItemList","name":f"{b['name']} upgrades and parts","numberOfItems":len(parts),"itemListElement":[{"@type":"ListItem","position":i+1,"name":p['name']} for i,p in enumerate(parts[:100])]}
  urls.append(page(f'/bikes/{bid}/',f"{b['name']} Upgrades & Parts | Fit-Checked, Prices Checked | eBikePartsPicker",
    f"{nconf} aftermarket parts that fit the {b['name']}: suspension, wheels, brakes, controls and more, with prices checked {D['checked']}. Build and price your {b['name']}.",
    body,[('Home','/'),('Bikes','/bikes/'),(b['name'],f'/bikes/{bid}/')],BASE+f'/img/bikes/{bid}-800.webp',[il]))
# bikes index
li=''.join(f'<li><a href="/bikes/{b["id"]}/">{e(b["name"])} upgrades &amp; parts</a> <span class="sp-chk">{sum(p["status"]=="confirmed" for p in b["parts"])} confirmed parts</span></li>' for b in seo_bikes)
urls.append(page('/bikes/','E-Moto Bikes: Upgrades & Parts by Model | eBikePartsPicker','Browse fit-checked aftermarket parts for the Sur-Ron Light Bee, Ultra Bee, Talaria Sting MX4, E Ride Pro and more, with checked prices.',
  f'<h1>Upgrades &amp; parts by bike</h1><ul class="seo-links">{li}</ul>',[('Home','/'),('Bikes','/bikes/')]))
# guides
for g in D['guides']:
  b=BK[g['bike']]; tn=TIER.get(g['tier'],g['tier']); tot=sum(r['p'] for r in g['rows'])
  rows=''.join(f'<li class="sp-row">'+(f'<img src="/{e(r["img"])}" alt="{e(r["name"])} for the {e(b["name"])}" loading="lazy" width="96" height="96">' if r['img'] else '<span class="sp-noimg"></span>')+f'<div class="sp-info"><span class="sp-cat">{e(r["cat"])}</span><strong>{e(r["name"])}</strong><div><span class="sp-price">{money(r["p"])}</span><span class="sp-chk">{e(r["v"])}, checked {e(r["chk"])}</span></div></div><div class="sp-act">{buy(r)}</div></li>' for r in g['rows'])
  sel={}
  for bb in D['bikes']:
    if bb['id']==b['id']:
      m={p['pid']:p['cat'] for p in bb['parts']}
  for r in g['rows']:
    if r['pid'] in m: sel[m[r['pid']]]=r['pid']
  pc=''.join(f'<li>{e(x)}</li>' for x in g['pros']); cc=''.join(f'<li>{e(x)}</li>' for x in g['cons'])
  pw=f'<p><a href="/power/#{b["id"]}">Add the power upgrade for the {e(b["name"])}</a> (priced separately)</p>' if g.get('power') else ''
  body=f"""<h1>{e(b['name'])} {e(tn)} build</h1><p class="seo-lede">{e(g['blurb'])} Every part is a confirmed fit for the {e(b['name'])} (the seller listing names it) and every price was checked on the retailer\u2019s page.</p>
<ul class="sp-list">{rows}</ul>
<p class="seo-total">Parts total: <strong>{money(tot)}</strong>{(' \u00b7 With the bike ('+e(bike_price(b))+'): <strong>'+money(tot+b['price'])+'</strong>') if b['price'] else ''}</p>
<p class="seo-cta"><a class="cta" href="{e(builder(b['id'],sel))}">Customize this build</a>{(' <a class="sbuy sbuy-voro" href="'+e(b['srcUrl'])+'" rel="sponsored noopener" target="_blank">Buy the '+e(b['name'])+' at Voro Motors</a>') if b['src']=='voro' and b['srcUrl'] else ''}</p>{pw}
<div class="seo-pc"><div><h2>Pros</h2><ul>{pc}</ul></div><div><h2>Cons</h2><ul>{cc}</ul></div></div>
<p>More: <a href="/bikes/{b['id']}/">all {e(b['name'])} parts</a>{''.join(f' \u00b7 <a href="/guides/{b["id"]}-{o["tier"]}/">{e(TIER.get(o["tier"]))} build</a>' for o in guides_by_bike[b['id']] if o['tier']!=g['tier'])}</p>"""
  urls.append(page(f'/guides/{b["id"]}-{g["tier"]}/',f"{b['name']} {tn} Build: Parts List & Total ({money(tot)}) | eBikePartsPicker",
    f"{tn} {b['name']} build: {', '.join(r['name'] for r in g['rows'][:3])}. Every part fit-confirmed, prices checked {D['checked']}. Parts total {money(tot)}.",
    body,[('Home','/'),('Bikes','/bikes/'),(b['name'],f'/bikes/{b["id"]}/'),(f'{tn} build',f'/guides/{b["id"]}-{g["tier"]}/')],BASE+f'/img/bikes/{b["id"]}-800.webp'))
# power
ps=''
for pw in D['power']:
  b=BK[pw['bike']]; tot=sum(r['p'] for r in pw['rows'])
  rows=''.join(f'<li class="sp-row"><span class="sp-noimg"></span><div class="sp-info"><span class="sp-cat">{e(r["cat"])}</span><strong>{e(r["name"])}</strong><div><span class="sp-price">{money(r["p"])}</span><span class="sp-chk">{e(r["v"])}, checked {e(r["chk"])}</span></div></div><div class="sp-act">{buy(r)}</div></li>' for r in pw['rows'])
  ps+=f'<section id="{b["id"]}"><h2>{e(b["name"])}: {e(pw["title"])}</h2><ul class="sp-list">{rows}</ul><p class="seo-total">Power upgrade total: <strong>{money(tot)}</strong></p><p><a href="/#power-{b["id"]}">See fit evidence, estimated system power and the limiting part</a></p></section>'
urls.append(page('/power/','E-Moto Power Upgrades: Ultra Bee & Talaria MX4 Motor, Controller, Battery | eBikePartsPicker',
  'Sourced power-upgrade combos for the Sur-Ron Ultra Bee and Talaria Sting MX4: motor, controller, battery and harness that the sellers say work together, with checked prices.',
  f'<h1>Power upgrades</h1><p class="seo-lede">Motor, controller and battery combos are only listed when seller or manufacturer listings show the parts fit the bike and work together (voltage, connectors or harness, mounting).</p>{ps}',
  [('Home','/'),('Power upgrades','/power/')]))
# categories
KEY=['fork','shock','wheels','brakes','tires','pegs','controller','motor','batteries','handlebars']
for cid in [c for c in KEY if c in CAT]:
  c=CAT[cid]; rows=[]
  seen={}
  for b in D['bikes']:
    for p in b['parts']:
      if p['cat']==cid and p['status']=='confirmed': seen.setdefault(p['pid'],[p,[]])[1].append(b)
  if len(seen)<3: continue
  items=sorted(seen.values(),key=lambda x:x[0]['name'])
  li=''.join(f'<li class="sp-row">'+(f'<img src="/{e(p["img"])}" alt="{e(p["name"])}" loading="lazy" width="96" height="96">' if p['img'] else '<span class="sp-noimg"></span>')+f'<div class="sp-info"><strong>{e(p["name"])}</strong><div class="sp-chk">Confirmed for: '+', '.join(f'<a href="/bikes/{bb["id"]}/">{e(bb["name"])}</a>' if bb in seo_bikes else e(bb['name']) for bb in bs[:8])+(' and more' if len(bs)>8 else '')+'</div>'+(f'<div><span class="sp-price">{money(p["price"]["p"])}</span><span class="sp-chk">{e(p["price"].get("v") or "")}{", checked "+e(p["price"]["chk"]) if p["price"].get("chk") else ""}</span></div>' if p['price'] and p['price'].get('p') is not None else '')+f'</div><div class="sp-act">{buy(p["price"])}</div></li>' for p,bs in items)
  urls.append(page(f'/parts/{cid}/',f"E-Moto {c['name']} Upgrades: Which Bikes They Fit | eBikePartsPicker",
    f"{len(items)} aftermarket {c['name'].lower()} options for Sur-Ron, Talaria, E Ride Pro and more, each with the bikes the seller confirms, and prices checked {D['checked']}.",
    f'<h1>{e(c["name"])} upgrades</h1><p class="seo-lede">{e(c["blurb"])}</p><ul class="sp-list">{li}</ul>',[('Home','/'),('Parts','/parts/'),(c['name'],f'/parts/{cid}/')]))
cats_done=[u for u in urls if '/parts/' in u]
li=''.join(f'<li><a href="{u.replace(BASE,"")}">{e(CAT[u.rstrip("/").split("/")[-1]]["name"])}</a></li>' for u in cats_done)
urls.append(page('/parts/','E-Moto Parts by Category | eBikePartsPicker','Aftermarket e-moto parts by category, with the bikes each part is confirmed to fit.',f'<h1>Parts by category</h1><ul class="seo-links">{li}</ul>',[('Home','/'),('Parts','/parts/')]))
static=['/','/about.html','/fitment-methodology.html','/affiliate-disclosure.html','/contact.html','/privacy.html','/terms.html','/report-a-part.html','/submission-guidelines.html']
allu=[BASE+(s[:-5] if s.endswith('.html') else s) for s in static if os.path.exists(os.path.join(ROOT,s.strip('/') or 'index.html'))]+urls
open(os.path.join(ROOT,'sitemap.xml'),'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{u}</loc><lastmod>{TODAY}</lastmod></url>\n' for u in allu)+'</urlset>\n')
open(os.path.join(ROOT,'robots.txt'),'w').write(f'User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n')
print(len(allu),'urls')
