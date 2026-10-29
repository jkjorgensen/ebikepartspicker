"""Refresh data/seo-fit-snapshot.json from the app's real checkFit. Run: python3 scripts/dump_snapshot.py"""
import json,os
from playwright.sync_api import sync_playwright
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS=r"""()=>({bikes:BIKES.map(b=>({id:b.id,name:b.name,price:b.price,src:b.src,weight:b.weight,kw:b.kw,size:b.size})),
 cats:CATEGORIES.map(c=>({id:c.id,name:c.name,opts:c.options.filter(o=>o.pid&&!o.hidden).map(o=>({pid:o.pid,name:o.name,img:o.img||'',
  prices:(o.prices||[]).map(p=>({v:p.v,p:p.p,url:p.url,chk:p.chk||''})),fit:Object.fromEntries(BIKES.map(b=>[b.id,checkFit(b.id,o).status])),stock:o.stock||''}))}))})"""
with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox']);pg=b.new_page()
  pg.goto('file://'+R+'/index.html',wait_until='commit');pg.wait_for_function('typeof checkFit=="function" && typeof CATEGORIES!="undefined"')
  d=pg.evaluate(JS);b.close()
json.dump(d,open(R+'/data/seo-fit-snapshot.json','w'),indent=1,ensure_ascii=False)
print(len(d['bikes']),'bikes',sum(len(c['opts']) for c in d['cats']),'opts')
