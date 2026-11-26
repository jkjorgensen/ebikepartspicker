/* Page-view tracking: cookieless, no personal data. Sends {page, kind, id}
   to /api/view (Cloudflare Pages Function → CLICKS Analytics Engine).
   Outbound buy-link clicks are handled separately by track.js. */
(function(){
  function kindOf(p){
    if(p==='/' || p==='/index.html') return 'home';
    if(/^\/bikes\/[^/]+/.test(p) && p!=='/bikes/' && p!=='/bikes') return 'bike';
    if(/^\/parts\/[^/]+\/[^/]+/.test(p)) return 'part';
    if(/^\/parts\/[^/]+/.test(p) && p!=='/parts/' && p!=='/parts') return 'category';
    if(/^\/guides\//.test(p)) return 'guide';
    if(/^\/compare\//.test(p)) return 'compare';
    if(/^\/upgrades\//.test(p)) return 'upgrade';
    if(/^\/power/.test(p)) return 'power';
    return 'other';
  }
  function idOf(p, kind){
    var parts=p.replace(/\/+$/,'').split('/').filter(Boolean);
    if(kind==='bike' || kind==='category' || kind==='guide' || kind==='compare' || kind==='upgrade') return parts[1]||'';
    if(kind==='part') return parts[2]||'';
    return '';
  }
  function send(extra){
    var p=location.pathname.slice(0,200);
    var kind=kindOf(p);
    var body=JSON.stringify({t:'view',page:p,kind:kind,id:idOf(p,kind).slice(0,80),hash:(location.hash||'').slice(0,80),view:extra||''});
    try{ navigator.sendBeacon ? navigator.sendBeacon('/api/view',new Blob([body],{type:'application/json'})) : fetch('/api/view',{method:'POST',body:body,keepalive:true}); }catch(e){}
  }
  send();
  /* Builder deep-links live on the homepage hash; record a second event when the builder is shown. */
  function maybeBuilder(){
    var app=document.getElementById('app'), pane=document.getElementById('builderPane');
    if(app && !app.hidden && pane && !pane.hidden) send('builder');
  }
  if(location.hash && location.hash.length>1){
    document.addEventListener('DOMContentLoaded', maybeBuilder);
    window.addEventListener('hashchange', maybeBuilder);
  }
})();

/* Buy-click tracking (per part / store / bike / page). Sends one extra beacon to /api/buy
   for outbound BUY links only (store buttons, "Buy this part", "Buy the <bike>"), so the
   protected track.js keeps working unchanged. Part id comes from data-pid on the link or its
   row, else from /parts/<cat>/<id> pages, else the server looks it up from the store URL.
   Bike comes from data-bike, the builder's current bike (window.ebppCurrentBike, set by app.js), or /bikes/<id>. */
(function(){
  function closestAttr(el,name){ var n=el.closest?el.closest('['+name+']'):null; return n?n.getAttribute(name):''; }
  function onClick(ev){
    if(ev.type==='auxclick' && ev.button!==1) return;
    var a=ev.target&&ev.target.closest?ev.target.closest('a[href]'):null; if(!a) return;
    var u; try{u=new URL(a.href,location.href);}catch(e){return;}
    if(!/^https?:$/.test(u.protocol) || u.host===location.host) return;
    var pid=closestAttr(a,'data-pid');
    var isBuy=pid || /(^|\s)(buy|buybtn|buyalt|sbuy|rb|gvoro)(\s|$)/.test(a.className||'');
    if(!isBuy) return;
    var to=u.host, path=u.pathname, aff=0;
    if(/sjv\.io$/.test(u.host)){ try{var t=new URL(u.searchParams.get('u')); to=t.host; path=t.pathname; aff=1;}catch(e){} }
    var p=location.pathname, m;
    var bike=closestAttr(a,'data-bike');
    if(!bike && typeof window.ebppCurrentBike==='function'){ try{ bike=window.ebppCurrentBike()||''; }catch(e){} }
    if(!bike && (m=p.match(/^\/bikes\/([^/]+)/))) bike=m[1];
    var kind=/^\s*Buy the /i.test(a.textContent||'') || a.classList.contains('buybtn') ? 'bike' : 'part';
    var body=JSON.stringify({to:to,path:path.slice(0,200),page:p.slice(0,200),pid:(pid||'').slice(0,120),bike:(bike||'').slice(0,60),kind:kind,aff:aff});
    try{ navigator.sendBeacon ? navigator.sendBeacon('/api/buy',new Blob([body],{type:'application/json'})) : fetch('/api/buy',{method:'POST',body:body,keepalive:true}); }catch(e){}
  }
  document.addEventListener('click',onClick,true);
  document.addEventListener('auxclick',onClick,true);
})();
