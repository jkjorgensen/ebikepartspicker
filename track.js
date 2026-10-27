/* Outbound-click tracking: cookieless, no personal data. Sends {to host, path, page}
   to /api/click (Cloudflare Pages Function). Never delays navigation. */
(function(){
  document.addEventListener('click',function(ev){
    var a=ev.target&&ev.target.closest?ev.target.closest('a[href]'):null; if(!a) return;
    var u; try{u=new URL(a.href,location.href);}catch(e){return;}
    if(u.host===location.host) return;
    var to=u.host, path=u.pathname;
    if(/sjv\.io$/.test(u.host)){ try{var t=new URL(u.searchParams.get('u')); to=t.host+' (affiliate)'; path=t.pathname;}catch(e){} }
    var body=JSON.stringify({to:to,path:path.slice(0,200),page:location.pathname.slice(0,200)});
    try{ navigator.sendBeacon ? navigator.sendBeacon('/api/click',new Blob([body],{type:'application/json'})) : fetch('/api/click',{method:'POST',body:body,keepalive:true}); }catch(e){}
  },true);
})();
