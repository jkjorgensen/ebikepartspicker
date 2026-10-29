"""Static '[bike] upgrades' and '[bike] vs [bike]' pages from real data only.
Input: data/seo-fit-snapshot.json (dumped from the live app's checkFit) + data/bikes.json.
Run: python3 scripts/build_upgrades_vs.py"""
import json,os,html,urllib.parse
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D=json.load(open(f'{R}/data/seo-fit-snapshot.json'))
BJ={b['id']:b for b in (lambda j:j if isinstance(j,list) else j['bikes'])(json.load(open(f'{R}/data/bikes.json')))}
BK={b['id']:b for b in D['bikes']}
BASE='https://ebikepartspicker.pages.dev'; IMGV='4.5.0'
e=lambda s: html.escape(str(s if s is not None else ''),quote=True)
money=lambda p: '${:,.0f}'.format(p) if p is not None else 'Not verified'
UP=['lightbee','ss20','mx4','ultrabee','ss30','mx5','sr','ventus-plus','komodo']
VS=[('lightbee','mx4'),('ultrabee','mx5'),('lightbee','ss20'),('sr','ultrabee'),('ultrabee','ss30'),('mx5','ss30'),('lightbee','sr'),('ss20','mx4'),('ultrabee','komodo'),('ventus-plus','ultrabee'),('storm-bee','ultrabee'),('mx4','ss30')]
GOAL={'motor':'Power','controllers':'Power','controller':'Power','batteries':'Power','battery':'Power',
 'forks':'Suspension','fork':'Suspension','shocks':'Suspension','shock':'Suspension','linkage':'Suspension',
 'brakes':'Brakes','tires':'Wheels & tires','wheels':'Wheels & tires'}
def host(u): return urllib.parse.urlparse(u).netloc.replace('www.','')
def fits(bid):
  out={}
  for c in D['cats']:
    for o in c['opts']:
      st=o['fit'].get(bid)
      if st in('confirmed','requires_mod') and o['prices']:
        p=min(o['prices'],key=lambda x:x.get('p') or 9e9)
        out.setdefault(GOAL.get(c['id'],'Other upgrades'),[]).append((c['name'],o,st,p))
  return out
def head(title,desc,path,img):
  return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}">
<link rel="canonical" href="{BASE}{path}"><meta property="og:type" content="article"><meta property="og:site_name" content="eBikePartsPicker"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{BASE}{path}"><meta property="og:image" content="{BASE}/img/bikes/{img}-800.webp">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M13 2 4 14h6l-1 8 9-12h-6l1-8z' fill='%23c8f04a'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/styles.css?v=4.11.0">
</head><body class="tp">
<header class="tp-head"><a class="tp-brand" href="/">eBikePartsPicker</a><div class="ux-tools"><button type="button" class="ux-sbtn" data-ux-search aria-label="Search parts, bikes and categories"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="ux-sbtn-t">Search</span><kbd>/</kbd></button><button type="button" class="ux-bike" data-ux-bike><span class="ux-bike-t">Pick your bike</span></button></div><a class="tp-back" href="/">← Back to the builder</a></header>
<main class="tp-main">'''
FOOT='''<p class="seo-fine">Prices were checked on the retailer’s page on the date shown and can change. Fit status comes from the seller or manufacturer listing; confirm fitment, price and stock before you buy. Some links on this site are affiliate links (<a href="/affiliate-disclosure.html">disclosure</a>).</p></main>
<footer class="sitefoot tp-foot"><nav class="tp-nav"><a href="/about.html">About</a><a href="/contact.html">Contact</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms of use</a><a href="/affiliate-disclosure.html">Affiliate disclosure</a><a href="/fitment-methodology.html">Fitment methodology</a><a href="/report-a-part.html">Report a part</a></nav></footer>
<script src="/track.js?v=1" defer></script>
<script src="/ux.js?v=4.11.0" defer></script>
</body></html>'''
def spec(bid):
  b=BK[bid]; s=BJ.get(bid,{}).get('stock_specs',{})
  src={'msrp':'MSRP','voro':'at Voro Motors'}.get(b['src'],'retailer price')
  return {'Price':f"{money(b['price'])} ({src})",'Peak power':f"{b['kw']} kW" if b.get('kw') else 'Not verified',
   'Weight':f"{b['weight']} lb" if b.get('weight') else 'Not verified',
   'Wheels (F/R)':f"{s['front_wheel_in']}\" / {s['rear_wheel_in']}\"" if s.get('front_wheel_in') else 'Not verified',
   'Size class':{'light':'Lightweight','mid':'Mid-size','full':'Full-size'}.get(b.get('size'),'Not verified')}
pages=[]
for bid in UP:
  b=BK[bid]; g=fits(bid); n=sum(len(v) for v in g.values()); path=f'/upgrades/{bid}/'
  t=f"{b['name']} Upgrades: {n} Fit-Checked Parts by Goal | eBikePartsPicker"
  d=f"{b['name']} upgrades grouped by goal — power, suspension, brakes, wheels and tires — with seller-confirmed fitment and prices checked on the retailer page."
  h=head(t,d,path,bid)+f'<h1>{e(b["name"])} upgrades</h1><img src="/img/bikes/{bid}-800.webp?v={IMGV}" alt="{e(b["name"])} electric dirt bike" width="800" height="500" style="width:100%;height:auto;border-radius:14px;background:#0d0f12">'
  h+=f'<p>{n} parts in our catalog have seller-confirmed fitment for the {e(b["name"])} (stock: {e(spec(bid)["Peak power"])}, {e(spec(bid)["Weight"])}). Grouped by what you want to improve. Parts marked “fits with mods” need the adapter or changes the seller lists.</p>'
  h+=f'<p><a class="cta" href="/#{{%22b%22:%22{bid}%22}}">Open the {e(b["name"])} in the builder</a> · <a href="/bikes/{bid}/">All {e(b["name"])} parts</a></p>'
  for goal in ['Power','Suspension','Brakes','Wheels & tires','Other upgrades']:
    if goal not in g: continue
    h+=f'<h2>{goal}</h2><ul>'
    for cn,o,st,p in sorted(g[goal],key=lambda x:(x[0],x[3].get('p') or 9e9)):
      h+=f'<li><strong>{e(o["name"])}</strong> <small>({e(cn)}{", fits with mods" if st=="requires_mod" else ""})</small> — {money(p.get("p"))} at <a href="{e(p["url"])}" rel="noopener" target="_blank">{e(p.get("v") or host(p["url"]))}</a>{", checked "+e(p["chk"]) if p.get("chk") else ""}</li>'
    h+='</ul>'
  os.makedirs(R+path,exist_ok=True); open(R+path+'index.html','w').write(h+FOOT); pages.append(path)
for a,c in VS:
  A,C=BK[a],BK[c]; sa,sc=spec(a),spec(c); fa,fc=sum(len(v) for v in fits(a).values()),sum(len(v) for v in fits(c).values())
  path=f'/compare/{a}-vs-{c}/'
  t=f"{A['name']} vs {C['name']}: Specs, Price & Upgrade Options | eBikePartsPicker"
  d=f"{A['name']} vs {C['name']} side by side: price, peak power, weight, wheel sizes and how many fit-checked upgrade parts each has."
  h=head(t,d,path,a)+f'<h1>{e(A["name"])} vs {e(C["name"])}</h1>'
  h+=f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><img src="/img/bikes/{a}-800.webp?v={IMGV}" alt="{e(A["name"])}" width="800" height="500" style="width:100%;height:auto;border-radius:12px"><img src="/img/bikes/{c}-800.webp?v={IMGV}" alt="{e(C["name"])}" width="800" height="500" style="width:100%;height:auto;border-radius:12px"></div>'
  h+=f'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr><th style="text-align:left"></th><th style="text-align:left">{e(A["name"])}</th><th style="text-align:left">{e(C["name"])}</th></tr>'
  for k in sa: h+=f'<tr style="border-top:1px solid #2a2f37"><td style="padding:8px 6px">{k}</td><td>{e(sa[k])}</td><td>{e(sc[k])}</td></tr>'
  h+=f'<tr style="border-top:1px solid #2a2f37"><td style="padding:8px 6px">Fit-checked upgrade parts in our catalog</td><td>{fa}</td><td>{fc}</td></tr></table></div>'
  def diff(k,x,y,u,lo=False):
    if x is None or y is None: return ''
    if x==y: return f'<li>Same {k}: {x}{u}.</li>'
    hi,lw=(A,C) if (x>y)!=lo else (C,A); v=abs(x-y)
    amt=('${:,.0f}'.format(v) if u==' USD' else f'{round(v,1):g}{u}'); return f'<li>The {e(hi["name"])} has {"lower" if lo else "higher"} {k} by {amt}.</li>'
  h+='<h2>Key differences</h2><ul>'+diff('peak power',A.get('kw'),C.get('kw'),' kW')+diff('weight',A.get('weight'),C.get('weight'),' lb',True)+diff('price',A.get('price'),C.get('price'),' USD',True)+'</ul>'
  h+=f'<p>Specs are from manufacturer or retailer listings; ride feel, range and reliability aren’t compared here because we don’t have verified data for them.</p>'
  h+=f'<p><a class="cta" href="/upgrades/{a}/">{e(A["name"])} upgrades</a> <a class="cta" href="/upgrades/{c}/">{e(C["name"])} upgrades</a></p>' if a in UP and c in UP else '<p>'+' · '.join(f'<a href="/{d}/{x}/">{e(BK[x]["name"])} {"upgrades" if d=="upgrades" else "parts"}</a>' for x in (a,c) for d in [('upgrades' if x in UP else 'bikes')] if os.path.exists(f'{R}/{d}/{x}/index.html'))+'</p>'
  os.makedirs(R+path,exist_ok=True); open(R+path+'index.html','w').write(h+FOOT); pages.append(path)
# compare index + links from upgrades pages
li=''.join(f'<li><a href="/compare/{a}-vs-{c}/">{e(BK[a]["name"])} vs {e(BK[c]["name"])}</a></li>' for a,c in VS)
h=head('Compare E-Moto Bikes: Specs, Price & Upgrade Options | eBikePartsPicker','Side-by-side comparisons of popular e-moto bikes: price, peak power, weight, wheel sizes and fit-checked upgrade counts.','/compare/','ultrabee')+f'<h1>Compare bikes</h1><ul>{li}</ul>'
os.makedirs(R+'/compare',exist_ok=True); open(R+'/compare/index.html','w').write(h+FOOT); pages.append('/compare/')
for bid in UP:
  cs=[(a,c) for a,c in VS if bid in (a,c)]
  if not cs: continue
  f=R+f'/upgrades/{bid}/index.html'; s=open(f).read()
  s=s.replace('<p class="seo-fine">','<h2>Compare</h2><ul>'+''.join(f'<li><a href="/compare/{a}-vs-{c}/">{e(BK[a]["name"])} vs {e(BK[c]["name"])}</a></li>' for a,c in cs)+'</ul><p class="seo-fine">',1)
  open(f,'w').write(s)
sm=open(R+'/sitemap.xml').read()
add=''.join(f'<url><loc>{BASE}{p}</loc></url>\n' for p in pages if BASE+p not in sm)
open(R+'/sitemap.xml','w').write(sm.replace('</urlset>',add+'</urlset>'))
print(len(pages),'pages')
