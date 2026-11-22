/* build-form.js: "Submit your build" form with real owner photos (v4.17.16).
   Separate from forms.js on purpose. Photos are resized IN THE BROWSER to WebP,
   max 1600 px on the long side and max 500 KB each, before upload, so the
   Function stays light and every photo fits a single Workers KV value.
   Posts multipart to /api/build-submit, which checks Turnstile and stores the
   submission as PENDING. If the backend isn't switched on yet (no KV binding or
   Turnstile keys), the form says so and offers email instead of failing silently. */
(function(){
  var TO='ebikepartspicker@gmail.com', MAXPX=1600, MAXB=500*1024, MAXN=4;
  var f=document.querySelector('form[data-build-form]'); if(!f) return;
  var msg=f.querySelector('.form-msg'), btn=f.querySelector('button[type=submit]');
  var input=f.querySelector('input[type=file][name=photo]'), prev=f.querySelector('.bf-previews');
  var ts=f.querySelector('.bf-turnstile'), off=document.getElementById('bfOff');
  var blobs=[], enabled=false, widget=null;

  function say(t){ if(msg) msg.textContent=t; }
  function setOff(){
    enabled=false; btn.disabled=true;
    if(off) off.hidden=false;
    say('');
  }
  /* 1) is the backend on? GET returns {enabled, siteKey}. Any failure = off. */
  fetch('/api/build-submit',{headers:{accept:'application/json'}})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(c){
      if(!c || !c.enabled || !c.siteKey){ setOff(); return; }
      enabled=true; btn.disabled=false;
      if(c.maxPhotoBytes) MAXB=c.maxPhotoBytes;
      window.__bfTs=function(){ try{ widget=window.turnstile.render(ts,{sitekey:c.siteKey,theme:'dark'}); }catch(e){ setOff(); } };
      var s=document.createElement('script');
      s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__bfTs&render=explicit'; s.async=true; s.defer=true;
      s.onerror=function(){ say('The spam check could not load. Please try again later or email us.'); btn.disabled=true; };
      document.head.appendChild(s);
    })
    .catch(setOff);

  /* 2) resize to WebP <= MAXPX, step quality (then size) down until <= MAXB */
  function toWebp(file){
    return new Promise(function(res,rej){
      if(!/^image\//.test(file.type)) return rej('type');
      var url=URL.createObjectURL(file), img=new Image();
      img.onload=function(){
        URL.revokeObjectURL(url);
        var w=img.naturalWidth, h=img.naturalHeight, sc=Math.min(1, MAXPX/Math.max(w,h));
        var q=0.85, tries=0;
        (function go(){
          var c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w*sc)); c.height=Math.max(1,Math.round(h*sc));
          c.getContext('2d').drawImage(img,0,0,c.width,c.height);
          c.toBlob(function(b){
            if(!b || b.type!=='image/webp') return rej('webp');
            if(b.size<=MAXB) return res({blob:b,w:c.width,h:c.height});
            if(++tries>8) return rej('big');
            if(q>0.55) q-=0.1; else sc*=0.85;
            go();
          },'image/webp',q);
        })();
      };
      img.onerror=function(){ URL.revokeObjectURL(url); rej('decode'); };
      img.src=url;
    });
  }
  input.addEventListener('change',function(){
    var files=[].slice.call(input.files||[]).slice(0,MAXN);
    if((input.files||[]).length>MAXN) say('Up to '+MAXN+' photos. Using the first '+MAXN+'.');
    blobs=[]; prev.innerHTML='';
    if(!files.length) return;
    say('Preparing photos…');
    Promise.all(files.map(function(fl){ return toWebp(fl).catch(function(e){ return {err:e,name:fl.name}; }); })).then(function(out){
      var bad=0, nowebp=0;
      out.forEach(function(o){
        if(o.err){ bad++; if(o.err==='webp') nowebp++; return; }
        blobs.push(o.blob);
        var im=document.createElement('img'); im.src=URL.createObjectURL(o.blob); im.alt='Selected photo preview'; im.width=120; im.height=Math.round(120*o.h/o.w); prev.appendChild(im);
      });
      if(nowebp && !blobs.length){ say('This browser can\u2019t convert photos to WebP. Please use Chrome, Edge or Firefox, or email your photos.'); return; }
      say(bad ? (bad+' photo'+(bad>1?'s':'')+' could not be read (try JPG or PNG). '+blobs.length+' ready.') : (blobs.length+' photo'+(blobs.length>1?'s':'')+' ready.'));
    });
  });

  function mailto(){
    var d=new FormData(f), lines=[];
    ['name','email','bike','title','parts','story','instagram'].forEach(function(k){ var v=d.get(k); if(v) lines.push(k+': '+v); });
    return 'mailto:'+TO+'?subject='+encodeURIComponent('Build submission')+'&body='+encodeURIComponent(lines.join('\n')+'\n\n(Attach your photos to this email.)');
  }
  var ml=document.getElementById('bfMail'); if(ml) ml.addEventListener('click',function(){ ml.href=mailto(); });

  var ERR={bad_email:'Please enter a valid email.',missing:'Please fill in the bike and the parts list.',photo_terms:'Please confirm these are your own real photos.',
    no_photo:'Please add at least one photo of your bike.',too_many_photos:'Up to 4 photos.',photo_too_large:'A photo is too large after resizing. Try another photo.',
    photo_type:'Photos must be JPG, PNG or WebP.',turnstile_missing:'Please complete the spam check.',turnstile_failed:'The spam check failed. Please try again.',
    daily_limit:'We\u2019ve hit today\u2019s submission limit. Please try again tomorrow.',too_large:'Photos are too large in total. Try fewer photos.'};
  f.addEventListener('submit',function(ev){
    ev.preventDefault();
    if(!enabled){ setOff(); return; }
    if(!blobs.length){ say(ERR.no_photo); return; }
    var d=new FormData(f); d.delete('photo'); d.append('page',location.pathname);
    blobs.forEach(function(b,i){ d.append('photo',b,'photo'+i+'.webp'); });
    btn.disabled=true; say('Uploading…');
    fetch('/api/build-submit',{method:'POST',body:d})
      .then(function(r){ return r.json().catch(function(){ return {ok:false,error:'http_'+r.status}; }); })
      .then(function(j){
        btn.disabled=false;
        if(window.turnstile && widget!==null){ try{ window.turnstile.reset(widget); }catch(e){} }
        if(j.ok){ f.reset(); blobs=[]; prev.innerHTML=''; say(f.getAttribute('data-ok')||'Thanks! Your build is in the review queue.'); return; }
        if(j.error==='not_configured'){ setOff(); return; }
        say(ERR[j.error]||'Something went wrong. Please try again or email us.');
      })
      .catch(function(){ btn.disabled=false; say('Upload failed. Check your connection and try again, or email us.'); });
  });
})();
