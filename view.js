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
