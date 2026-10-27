/* Posts [data-form] forms to /api/submit. If storage isn't set up yet, falls back to
   opening the visitor's email app with the same details prefilled. */
(function(){
  var TO='ebikepartspicker@gmail.com';
  document.querySelectorAll('form[data-form]').forEach(function(f){
    f.addEventListener('submit',function(ev){
      ev.preventDefault();
      var msg=f.querySelector('.form-msg'), btn=f.querySelector('button[type=submit]');
      var d={type:f.getAttribute('data-form'),page:location.pathname};
      new FormData(f).forEach(function(v,k){d[k]=v;});
      if(d.type==='alert' && location.hash){ d.build=location.href.slice(0,1500); try{d.bike=JSON.parse(decodeURIComponent(location.hash.slice(1))).b||'';}catch(e){} }
      btn.disabled=true; msg.textContent='Sending…';
      fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)})
        .then(function(r){return r.json().then(function(j){return {s:r.status,j:j};});})
        .then(function(r){
          btn.disabled=false;
          if(r.j.ok){ f.reset(); msg.textContent=f.getAttribute('data-ok')||'Thanks, got it.'; return; }
          if(r.j.error==='bad_email'){ msg.textContent='Please enter a valid email.'; return; }
          if(r.j.error==='missing'){ msg.textContent='Please fill in the required field.'; return; }
          fallback();
        }).catch(function(){btn.disabled=false; fallback();});
      function fallback(){
        if(d.type==='alert'){ msg.textContent='Alerts aren\u2019t switched on yet. Please check back soon.'; return; }
        var body=Object.keys(d).filter(function(k){return k!=='type'&&k!=='website'&&d[k];}).map(function(k){return k+': '+d[k];}).join('\n');
        msg.textContent='Opening your email app instead…';
        location.href='mailto:'+TO+'?subject='+encodeURIComponent(d.type==='report'?'Part report':'eBikePartsPicker')+'&body='+encodeURIComponent(body);
      }
    });
  });
})();
