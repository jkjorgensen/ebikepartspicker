"""Extract site data via the real app logic (checkFit/resolveGuide) for static SEO pages."""
import json,sys
from playwright.sync_api import sync_playwright
ROOT='/workspace/ebikepartspicker/'
JS=r"""()=>{
 const best=o=>{if(!o.prices||!o.prices.length)return null;const af=o.prices.filter(p=>p.aff);if(af.length)return af[0];return o.prices.reduce((a,b)=>b.p<a.p?b:a)};
 const out={checked:CHECKED,bikes:[],cats:CATEGORIES.map(c=>({id:c.id,name:c.name,blurb:c.blurb||''})),guides:[],power:[]};
 BIKES.forEach(b=>{
   const parts=[];
   CATEGORIES.forEach(c=>c.options.forEach(o=>{ if(!o.pid||o.hidden) return; const f=checkFit(b.id,o); if(f.status!=='confirmed'&&f.status!=='requires_mod') return;
     const bp=best(o); parts.push({cat:c.id,pid:o.pid,name:o.name,status:f.status,note:(f.reasons||[''])[0],img:o.img||'',stock:o.stock||'',
       price:bp?{v:bp.v,p:bp.p,url:bp.url,aff:!!bp.aff,chk:bp.chk||''}:null}); }));
   out.bikes.push({id:b.id,name:b.name,price:b.price,src:b.src,msrp:b.msrp||null,srcUrl:b.srcUrl||'',srcChk:b.srcChk||'',weight:b.weight,kw:b.kw,size:b.size,sparse:!!b.sparse,parts});
 });
 GUIDES.forEach(g=>{const r=resolveGuide(g); if(r.issues.length) return;
   out.guides.push({bike:g.bike,tier:g.tier,name:g.name,blurb:g.blurb,pros:g.pros,cons:g.cons,power:g.power||null,
     rows:r.rows.map(x=>({cat:x.cat.name,pid:x.opt.pid,name:x.opt.name,img:x.opt.img||'',p:x.bp.p,v:x.bp.v,url:x.bp.url,aff:!!x.bp.aff,chk:x.bp.chk}))});});
 (window.POWER||[]).forEach(pw=>{const r=resolveGuide({bike:pw.bike,pids:pw.pids}); if(r.issues.length) return;
   out.power.push({bike:pw.bike,title:pw.title||pw.name||'',rows:r.rows.map(x=>({cat:x.cat.name,name:x.opt.name,p:x.bp.p,v:x.bp.v,url:x.bp.url,aff:!!x.bp.aff,chk:x.bp.chk}))});});
 return out;}"""
with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox']);pg=b.new_page()
  pg.goto('file://'+ROOT+'index.html',wait_until='commit');pg.wait_for_function('typeof bikeImgSrc=="function" && typeof resolveGuide=="function"')
  d=pg.evaluate(JS);b.close()
json.dump(d,open(sys.argv[1] if len(sys.argv)>1 else '/tmp/seo.json','w'),indent=1)
print(len(d['bikes']),'bikes',len(d['guides']),'guides',len(d['power']),'power')
