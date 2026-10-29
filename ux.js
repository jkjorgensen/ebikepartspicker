/* eBikePartsPicker UX layer (2026-10-29): remembered bike, instant search, mobile build bar + undo.
   Runs on the home page (talks to app.js through window.__app) and on static pages (reads
   data-* fit lists the generator writes). Never invents fit: a green badge only where the
   catalog confirms it; anything else reads "Not verified". No network calls except the
   local /search-index.json. */
(function(){
'use strict';
var V = '4.11.0';
var NS = 'ebpp.';
function lsGet(k, d){ try{ var v = localStorage.getItem(NS+k); return v==null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(NS+k, JSON.stringify(v)); }catch(e){} }
function $(s, r){ return (r||document).querySelector(s); }
function $$(s, r){ return [].slice.call((r||document).querySelectorAll(s)); }
function el(tag, cls, txt){ var e = document.createElement(tag); if(cls) e.className = cls; if(txt!=null) e.textContent = txt; return e; }
var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
var A = null; /* window.__app on the home page */

/* ---------- search index (local JSON, fetched once) ---------- */
var IDX = null, idxP = null;
function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9.]+/g,' ').trim(); }
function prepItem(it, prim, sec){
  var t = norm(prim).split(' ').filter(Boolean);
  it.t = t; it.c = t.join('');
  it.s = (sec||[]).map(function(x){ var tt = norm(x).split(' ').filter(Boolean); return {t:tt, c:tt.join('')}; });
  return it;
}
function loadIndex(){
  if(IDX) return Promise.resolve(IDX);
  if(!idxP) idxP = fetch('/search-index.json?v='+V).then(function(r){ return r.json(); }).then(function(j){
    var bikeName = {}; j.b.forEach(function(b){ bikeName[b[0]] = b[1]; });
    var catName = {}; j.c.forEach(function(c){ catName[c[0]] = c[1]; });
    var items = [];
    j.b.forEach(function(b){ items.push(prepItem({k:'bike', id:b[0], n:b[1], u:b[2], img:'/img/bikes/'+b[0]+'-800.webp?v=4.5.0'}, b[1], [b[3]||''])); });
    j.c.forEach(function(c){ items.push(prepItem({k:'cat', id:c[0], n:c[1], u:c[2], cnt:c[3]}, c[1], [])); });
    j.p.forEach(function(p){
      var fits = (p[5]||[]);
      items.push(prepItem({k:'part', id:p[0], n:p[1], cat:p[2], catN:catName[p[2]]||'', u:p[3], img:p[4]?'/'+p[4]:'', f:fits, pr:p[6]},
        p[1], [catName[p[2]]||''].concat(fits.map(function(id){ return bikeName[id]||''; }))));
    });
    IDX = {items:items, bikes:j.b, bikeName:bikeName};
    return IDX;
  });
  return idxP;
}
/* tiny Damerau-Levenshtein with an early exit */
function lev(a, b, max){
  if(Math.abs(a.length-b.length) > max) return max+1;
  var prev2 = null, prev = [], cur, i, j;
  for(j=0;j<=b.length;j++) prev[j]=j;
  for(i=1;i<=a.length;i++){
    cur=[i]; var rowMin=i;
    for(j=1;j<=b.length;j++){
      var cost = a[i-1]===b[j-1]?0:1;
      var v = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost);
      if(prev2 && i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) v = Math.min(v, prev2[j-2]+1);
      cur[j]=v; if(v<rowMin) rowMin=v;
    }
    if(rowMin>max) return max+1;
    prev2=prev; prev=cur;
  }
  return prev[b.length];
}
function tokScore(q, t, c){
  /* exact / prefix / substring of the collapsed name ("surron" in "sur ron", "ultrabee") */
  var k, best = 0;
  for(k=0;k<t.length;k++){
    if(t[k]===q) return 3;
    if(t[k].indexOf(q)===0) best = Math.max(best, 2.6);
  }
  if(best) return best;
  if(q.length>=2 && c.indexOf(q)!==-1) return 2.2;
  var max = q.length>=7 ? 2 : q.length>=4 ? 1 : 0;
  if(!max) return 0;
  var np = t.length, cand = t.slice();
  for(k=0;k<t.length-1;k++) cand.push(t[k]+t[k+1]);
  for(k=0;k<cand.length;k++){
    var w = cand[k]; if(w.length < 4 || w.length < q.length-1) continue;
    var d = lev(q, w, max);
    if(d>max && k<np && w.length>q.length) d = lev(q, w.slice(0, q.length), max); /* typo while still typing */
    if(d<=max) best = Math.max(best, 1.6 - 0.35*d);
  }
  return best;
}
function search(q, limit){
  var qn = norm(q); if(!qn || !IDX) return [];
  var qt = qn.split(' ').filter(Boolean), qc = qt.join('');
  var out = [];
  IDX.items.forEach(function(it){
    var score = 0, ok = true;
    qt.forEach(function(w){
      if(!ok) return;
      var s = tokScore(w, it.t, it.c);
      it.s.forEach(function(f){ s = Math.max(s, 0.7*tokScore(w, f.t, f.c)); });
      if(!s) ok = false; else score += s;
    });
    if(!ok && qt.length>1 && qc.length>=4 && it.c.indexOf(qc)!==-1){ ok = true; score = 2.6*qt.length; }
    if(!ok) return;
    if(qt.length>1 && it.c.indexOf(qc)!==-1) score += 1.5;
    if(it.k==='bike') score += 0.6; else if(it.k==='cat') score += 0.4;
    out.push({it:it, s:score});
  });
  out.sort(function(a,b){ return (b.s-a.s) || (a.it.n.length-b.it.n.length); });
  return out.slice(0, limit||8).map(function(x){ return x.it; });
}
window.__ebppSearch = function(q){ return search(q, 8).map(function(i){ return i.k+': '+i.n; }); }; /* QA hook */

/* ---------- remembered bike ---------- */
function myBike(){ return lsGet('bike', null); }
function bikeNameOf(id){
  if(A && A.bikeById(id)) return A.bikeById(id).name;
  if(IDX && IDX.bikeName[id]) return IDX.bikeName[id];
  var h = $('[data-ux-bikes]'); return id;
}
function shortName(n){ return String(n||'').replace(/^(Sur-Ron|Talaria|E Ride Pro|Arctic Leopard|Rawrr|Altis|79Bike|Ventus)\s+/,''); }
function setMyBike(id){
  lsSet('bike', id); lsSet('pickDone', 1);
  paintBikeChips();
  if(A) A.setBike(id);
  applyStaticFit();
  document.dispatchEvent(new CustomEvent('ebpp:bike', {detail:id}));
}
function paintBikeChips(){
  var id = myBike();
  $$('[data-ux-bike]').forEach(function(b){
    b.innerHTML = '';
    var ic = el('span','ux-bike-ic'); ic.setAttribute('aria-hidden','true');
    ic.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 9 9h5l4.5 8M9 9 7.5 6H5m9 3 1.5-3H18"/></svg>';
    b.appendChild(ic);
    var t = el('span','ux-bike-t', id ? shortName(bikeNameOf(id)) : 'Pick your bike');
    b.appendChild(t);
    b.classList.toggle('set', !!id);
    b.setAttribute('aria-label', id ? 'Your bike: '+bikeNameOf(id)+'. Change bike' : 'Pick your bike');
  });
}

/* ---------- "What do you ride?" card: non-blocking, dismissible ---------- */
var pickCard = null;
function bikeList(){
  if(typeof BIKES!=='undefined') return BIKES.map(function(b){ return [b.id, b.name]; });
  return IDX ? IDX.bikes.map(function(b){ return [b[0], b[1]]; }) : [];
}
function openPicker(fromChip){
  if(pickCard){ pickCard.hidden = false; var i0 = $('input', pickCard); if(fromChip) i0.focus(); return; }
  pickCard = el('div','ux-pick'); pickCard.setAttribute('role','dialog'); pickCard.setAttribute('aria-labelledby','uxPickT');
  var h = el('div','ux-pick-h');
  var tt = el('div'); var t = el('strong', null, 'What do you ride?'); t.id='uxPickT';
  tt.appendChild(t); tt.appendChild(el('p', null, 'We\u2019ll show parts that fit it first. Saved on this device only.'));
  var x = el('button','ux-x','\u00d7'); x.type='button'; x.setAttribute('aria-label','Not now');
  h.appendChild(tt); h.appendChild(x); pickCard.appendChild(h);
  var box = el('div','ux-pick-box');
  var inp = el('input'); inp.type='text'; inp.placeholder='Type your bike, e.g. Light Bee'; inp.setAttribute('aria-label','Your bike'); inp.autocomplete='off';
  var list = el('div','ux-pick-list'); list.setAttribute('role','listbox');
  box.appendChild(inp); box.appendChild(list); pickCard.appendChild(box);
  var foot = el('div','ux-pick-f');
  var skip = el('button','ux-link','Not now'); skip.type='button';
  foot.appendChild(skip);
  if(myBike()){ var clr = el('button','ux-link','Forget my bike'); clr.type='button'; foot.appendChild(clr);
    clr.addEventListener('click', function(){ try{ localStorage.removeItem(NS+'bike'); }catch(e){} paintBikeChips(); applyStaticFit(); closePicker(); }); }
  pickCard.appendChild(foot);
  var act = 0, cur = [];
  function renderList(){
    var q = norm(inp.value), all = bikeList();
    if(q){
      var qt = q.split(' ');
      cur = all.map(function(b){ var it = prepItem({}, b[1], []), s = 0, ok = true;
        qt.forEach(function(w){ var v = tokScore(w, it.t, it.c); if(!v) ok=false; s+=v; });
        if(!ok && it.c.indexOf(qt.join(''))!==-1){ ok=true; s=3; }
        return ok ? {b:b, s:s} : null; }).filter(Boolean).sort(function(a,b){ return b.s-a.s; }).map(function(x){ return x.b; });
    } else {
      var pop = ['lightbee','ultrabee','mx4','mx5','ss20','ss30','sr','komodo','storm-bee','ventus-plus','bonnell-805rx'];
      cur = pop.map(function(id){ return all.filter(function(b){ return b[0]===id; })[0]; }).filter(Boolean);
    }
    act = 0; list.innerHTML = '';
    if(!cur.length){ list.appendChild(el('div','ux-empty','No bikes match \u2014 try the brand or model name.')); return; }
    cur.slice(0, 8).forEach(function(b, i){
      var o = el('button','ux-pick-o'+(b[0]===myBike()?' on':'')); o.type='button'; o.setAttribute('role','option');
      o.textContent = b[1];
      o.addEventListener('click', function(){ choose(b[0]); });
      list.appendChild(o);
    });
    hl();
  }
  function hl(){ $$('.ux-pick-o', list).forEach(function(o,i){ o.classList.toggle('act', i===act); o.setAttribute('aria-selected', i===act?'true':'false'); }); }
  function choose(id){
    setMyBike(id); closePicker();
    toastMsg('Saved: '+bikeNameOf(id)+'. Parts that fit it show first.');
  }
  inp.addEventListener('input', renderList);
  inp.addEventListener('keydown', function(e){
    var n = Math.min(cur.length, 8);
    if(e.key==='ArrowDown'){ e.preventDefault(); act = (act+1)%Math.max(n,1); hl(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); act = (act-1+n)%Math.max(n,1); hl(); }
    else if(e.key==='Enter'){ if(cur[act]) choose(cur[act][0]); }
    else if(e.key==='Escape'){ closePicker(); }
  });
  x.addEventListener('click', function(){ lsSet('pickDone', 1); closePicker(); });
  skip.addEventListener('click', function(){ lsSet('pickDone', 1); closePicker(); });
  document.body.appendChild(pickCard);
  renderList();
  if(fromChip) inp.focus();
  requestAnimationFrame(function(){ pickCard.classList.add('in'); });
}
function closePicker(){ if(pickCard){ pickCard.hidden = true; } }
function maybeFirstVisit(){
  if(myBike() || lsGet('pickDone', 0)) return;
  if(/^#\{|^#%7B/i.test(location.hash)) return; /* opened a shared build: don't interrupt */
  setTimeout(function(){ if(!myBike() && !lsGet('pickDone',0)) (IDX||typeof BIKES!=='undefined' ? Promise.resolve() : loadIndex()).then(function(){ openPicker(false); }); }, 900);
}

/* ---------- static pages: "Fits your bike" from generator data only ---------- */
function applyStaticFit(){
  var id = myBike(), nm = id ? bikeNameOf(id) : '';
  var lists = $$('[data-ux-fitlist]');
  lists.forEach(function(ul){
    var rows = $$('li[data-pid]', ul);
    rows.forEach(function(li){
      var b = $('.ux-fit', li); if(b) b.remove();
      li.classList.remove('ux-fits');
      if(!id) return;
      var fits = (li.getAttribute('data-fit')||'').split(' '), mod = (li.getAttribute('data-mod')||'').split(' '), no = (li.getAttribute('data-no')||'').split(' ');
      var badge = el('span','ux-fit');
      if(fits.indexOf(id)!==-1){ badge.className += ' yes'; badge.textContent = '\u2713 Fits your bike'; li.classList.add('ux-fits'); li._r = 0; }
      else if(mod.indexOf(id)!==-1){ badge.className += ' mod'; badge.textContent = 'Fits your bike with mods'; li._r = 1; }
      else if(no.indexOf(id)!==-1){ badge.className += ' no'; badge.textContent = 'Doesn\u2019t fit your '+shortName(nm); li._r = 3; }
      else { badge.className += ' nv'; badge.textContent = 'Not verified for your '+shortName(nm); li._r = 2; }
      var host = $('.sp-info strong', li) || $('.sp-info', li);
      if(host) host.insertAdjacentElement('afterend', badge);
    });
    if(!ul._orig) ul._orig = rows.slice();
    var order = id ? ul._orig.slice().sort(function(a,b){ return (a._r||0)-(b._r||0) || ul._orig.indexOf(a)-ul._orig.indexOf(b); }) : ul._orig;
    order.forEach(function(li){ ul.appendChild(li); });
  });
  /* bike page for a different bike than yours: gentle pointer, never a redirect */
  var bp = $('[data-ux-pagebike]');
  var note = $('.ux-other'); if(note) note.remove();
  if(bp && id && bp.getAttribute('data-ux-pagebike')!==id){
    var n = el('p','ux-other');
    n.appendChild(document.createTextNode('These parts are for the '+bp.getAttribute('data-name')+'. Your bike is the '+nm+'. '));
    var a = el('a', null, 'See parts for your bike \u2192'); a.href = '/bikes/'+id+'/';
    n.appendChild(a); bp.insertAdjacentElement('afterend', n);
    if(!IDX || !IDX.bikes.some(function(b){ return b[0]===id && /^\/bikes\//.test(b[2]); })) a.href = '/#'+encodeURIComponent(JSON.stringify({b:id}));
  }
  /* part page: highlight your bike's row in the fit table */
  $$('[data-ux-fitrow]').forEach(function(r){ r.classList.toggle('ux-mine', r.getAttribute('data-ux-fitrow')===id); });
  var pf = $('[data-ux-partfit]');
  if(pf){
    pf.innerHTML = ''; pf.hidden = !id;
    if(id){
      var st = (JSON.parse(pf.getAttribute('data-ux-partfit')||'{}'))[id] || 'nv';
      var lab = {confirmed:'\u2713 Fits your '+nm, requires_mod:'Fits your '+nm+' with modifications', no_fit:'Doesn\u2019t fit your '+nm, nv:'Not verified for your '+nm};
      var bb = el('span','ux-fit '+({confirmed:'yes',requires_mod:'mod',no_fit:'no'}[st]||'nv'), lab[st]||lab.nv);
      pf.appendChild(bb);
    }
  }
}

/* ---------- instant search overlay ---------- */
var sOv = null;
function openSearch(){
  if(!sOv) buildSearch();
  sOv.hidden = false; document.documentElement.classList.add('ux-lock');
  var inp = $('input', sOv); inp.value = ''; renderResults('');
  setTimeout(function(){ inp.focus(); }, 10);
  loadIndex().then(function(){ renderResults(inp.value); });
}
function closeSearch(){ if(sOv){ sOv.hidden = true; document.documentElement.classList.remove('ux-lock'); } }
var sAct = 0, sCur = [];
function buildSearch(){
  sOv = el('div','ux-sov'); sOv.hidden = true;
  var p = el('div','ux-spanel'); p.setAttribute('role','dialog'); p.setAttribute('aria-modal','true'); p.setAttribute('aria-label','Search');
  var row = el('div','ux-srow');
  var inp = el('input'); inp.type='search'; inp.placeholder='Search parts, bikes, categories'; inp.setAttribute('aria-label','Search parts, bikes and categories');
  inp.setAttribute('role','combobox'); inp.setAttribute('aria-controls','uxSres'); inp.setAttribute('aria-expanded','true'); inp.autocomplete='off'; inp.spellcheck=false;
  var x = el('button','ux-sclose','Esc'); x.type='button'; x.setAttribute('aria-label','Close search');
  row.appendChild(inp); row.appendChild(x); p.appendChild(row);
  var res = el('div','ux-sres'); res.id='uxSres'; res.setAttribute('role','listbox'); p.appendChild(res);
  sOv.appendChild(p); document.body.appendChild(sOv);
  sOv.addEventListener('mousedown', function(e){ if(e.target===sOv) closeSearch(); });
  x.addEventListener('click', closeSearch);
  inp.addEventListener('input', function(){ renderResults(inp.value); });
  inp.addEventListener('keydown', function(e){
    if(e.key==='ArrowDown'){ e.preventDefault(); if(sCur.length){ sAct=(sAct+1)%sCur.length; hlS(); } }
    else if(e.key==='ArrowUp'){ e.preventDefault(); if(sCur.length){ sAct=(sAct-1+sCur.length)%sCur.length; hlS(); } }
    else if(e.key==='Enter'){ e.preventDefault(); if(sCur[sAct]) go(sCur[sAct]); }
    else if(e.key==='Escape'){ closeSearch(); }
  });
}
function hlS(){ $$('.ux-sopt', sOv).forEach(function(o,i){ o.classList.toggle('act', i===sAct); o.setAttribute('aria-selected', i===sAct?'true':'false'); if(i===sAct) o.scrollIntoView({block:'nearest'}); }); }
var KIND = {bike:'Bike', cat:'Category', part:'Part'};
function renderResults(q){
  var res = $('.ux-sres', sOv); res.innerHTML = '';
  if(!IDX){ for(var i=0;i<4;i++) res.appendChild(el('div','ux-skel')); return; }
  if(!norm(q)){
    var mb = myBike();
    res.appendChild(el('div','ux-shint', mb ? 'Try \u201c'+shortName(bikeNameOf(mb)).toLowerCase()+' brakes\u201d, \u201ctires\u201d or \u201cultra bee\u201d' : 'Try \u201csurron fork\u201d, \u201ctalaria tires\u201d or \u201cultra bee\u201d'));
    sCur = []; return;
  }
  sCur = search(q, 8); sAct = 0;
  if(!sCur.length){
    var em = el('div','ux-empty');
    em.appendChild(el('strong', null, 'Nothing matches \u201c'+q.trim()+'\u201d.'));
    em.appendChild(el('span', null, 'Try a brand (Sur-Ron, Talaria), a part type (brakes, tires) or a model.'));
    res.appendChild(em); return;
  }
  var mb2 = myBike();
  sCur.forEach(function(it, i){
    var o = el('a','ux-sopt'); o.href = urlFor(it); o.setAttribute('role','option'); o.id = 'uxso'+i;
    var th = el('span','ux-sth');
    if(it.img){ var im = el('img'); im.src = it.img; im.alt=''; im.loading='lazy'; im.width=48; im.height=48; th.appendChild(im); }
    else th.textContent = it.k==='cat' ? '#' : '';
    o.appendChild(th);
    var tx = el('span','ux-stx');
    tx.appendChild(el('strong', null, it.n));
    var meta = KIND[it.k] + (it.k==='part' && it.catN ? ' \u00b7 '+it.catN : '') + (it.k==='cat' && it.cnt ? ' \u00b7 '+it.cnt+' parts' : '');
    tx.appendChild(el('small', null, meta));
    o.appendChild(tx);
    if(it.k==='part' && mb2 && it.f.indexOf(mb2)!==-1) o.appendChild(el('span','ux-fit yes','\u2713 Fits your bike'));
    o.addEventListener('click', function(e){ e.preventDefault(); go(it); });
    o.addEventListener('mousemove', function(){ if(sAct!==i){ sAct=i; hlS(); } });
    res.appendChild(o);
  });
  hlS();
}
function urlFor(it){
  if(it.k==='bike' && A) return '#bike-'+it.id;
  return it.u || '/';
}
function go(it){
  closeSearch();
  if(it.k==='bike' && A){ A.state.sel = {}; window.openBikeInBuilder(it.id); return; }
  location.href = it.u || '/';
}

/* ---------- builder: mobile bottom bar + undo toast ---------- */
var mbar = null, undoEl = null, undoT = null;
function ensureBar(){
  if(mbar || !A) return;
  mbar = el('div','ux-mbar'); mbar.setAttribute('aria-label','Build summary');
  var l = el('div','ux-mbar-l');
  var n = el('small','ux-mbar-n'); var t = el('strong','ux-mbar-t');
  l.appendChild(n); l.appendChild(t);
  var b = el('button','cta ux-mbar-b','Review build'); b.type='button';
  b.addEventListener('click', function(){ A.review(); });
  mbar.appendChild(l); mbar.appendChild(b);
  document.getElementById('app').appendChild(mbar);
}
function updateBar(){
  if(!A) return; ensureBar();
  var show = A.inBuilder();
  mbar.hidden = !show; document.body.classList.toggle('ux-has-mbar', show);
  if(!show) return;
  var st = A.state, n = 0;
  CATEGORIES.forEach(function(c){ if(st.sel[c.id]) n++; });
  var t = A.totals(), b = A.bikeById(st.bike);
  $('.ux-mbar-n', mbar).textContent = n ? n+' part'+(n>1?'s':'')+' \u00b7 '+shortName(b?b.name:'') : 'No parts yet \u00b7 '+shortName(b?b.name:'');
  $('.ux-mbar-t', mbar).textContent = t.tbd ? 'Total TBD' : A.money(t.price);
  var onReview = st.step >= A.groups.length;
  $('.ux-mbar-b', mbar).hidden = onReview;
}
function changed(c, prev, next){
  if(!A) return;
  var on = c.options[next], off = c.options[prev];
  var msg = next===0 ? 'Removed '+off.name : prev===0 ? 'Added '+on.name : 'Swapped to '+on.name;
  showUndo(msg, function(){ A.state.sel[c.id] = prev; A.render(); A.saveHash(); saveBuild(); });
  if(next!==0) snap(c.id);
  saveBuild();
}
function showUndo(msg, fn){
  if(!undoEl){
    undoEl = el('div','ux-undo'); undoEl.setAttribute('role','status'); undoEl.setAttribute('aria-live','polite');
    undoEl.appendChild(el('span','ux-undo-m'));
    var b = el('button','ux-undo-b','Undo'); b.type='button'; undoEl.appendChild(b);
    document.body.appendChild(undoEl);
  }
  $('.ux-undo-m', undoEl).textContent = msg;
  var b2 = $('.ux-undo-b', undoEl);
  b2.onclick = function(){ fn(); hideUndo(); toastMsg('Undone.'); };
  var tt = document.getElementById('toast'); if(tt) tt.style.display = 'none';
  undoEl.classList.add('in'); undoEl.hidden = false;
  clearTimeout(undoT); undoT = setTimeout(hideUndo, 5000);
}
function hideUndo(){ if(undoEl){ undoEl.classList.remove('in'); undoEl.hidden = true; } }
/* snap-in: a quick settle on the part you just added + the running total (skipped for reduced motion) */
function snap(cid){
  if(REDUCED) return;
  requestAnimationFrame(function(){
    var t = [$('.ppick[data-cat="'+cid+'"] .dd-btn'), mbar && !mbar.hidden ? $('.ux-mbar-t', mbar) : null];
    t.forEach(function(x){ if(!x) return; x.classList.remove('ux-snap'); void x.offsetWidth; x.classList.add('ux-snap'); });
  });
}

/* ---------- my builds + recently viewed (this device only, no account) ---------- */
function saveBuild(){
  if(!A) return;
  var st = A.state, s = {}, n = 0;
  CATEGORIES.forEach(function(c){ var i = st.sel[c.id]; if(!i) return; var o = c.options[i]; s[c.id] = (o&&o.pid)?o.pid:i; n++; });
  var L = lsGet('builds', []).filter(function(x){ return x.b!==st.bike; });
  if(n){ var t = A.totals(); L.unshift({b:st.bike, s:s, n:n, p:t.tbd?null:t.price, at:Date.now()}); }
  lsSet('builds', L.slice(0,6));
}
function addRecent(it){
  var L = lsGet('recent', []).filter(function(x){ return x.u!==it.u; });
  L.unshift(it); lsSet('recent', L.slice(0,8));
}
function trackPage(){
  var pp = $('[data-ux-part]');
  if(pp) addRecent({k:'p', n:pp.getAttribute('data-name'), u:pp.getAttribute('data-url'), i:pp.getAttribute('data-img')||''});
  var bp = $('[data-ux-pagebike]');
  if(bp) addRecent({k:'b', n:bp.getAttribute('data-name'), u:location.pathname, i:'img/bikes/'+bp.getAttribute('data-ux-pagebike')+'-800.webp'});
}
function renderShelf(){
  var host = document.getElementById('uxShelf'); if(!host || !A) return;
  host.innerHTML = '';
  var B = lsGet('builds', []).filter(function(x){ return A.bikeById(x.b); }), R = lsGet('recent', []);
  if(!B.length && !R.length){ host.hidden = true; return; }
  host.hidden = false;
  function sec(title, items, mk){
    if(!items.length) return;
    var s = el('section','ux-shelf-s'); s.appendChild(el('h2','ux-shelf-h',title));
    var row = el('div','ux-shelf-row'); items.forEach(function(x){ row.appendChild(mk(x)); }); s.appendChild(row); host.appendChild(s);
  }
  sec('My builds', B, function(x){
    var b = A.bikeById(x.b), a = el('a','ux-card');
    a.href = '/#'+encodeURIComponent(JSON.stringify({b:x.b, s:x.s}));
    var im = el('img'); im.src = '/img/bikes/'+x.b+'-800.webp'; im.alt = ''; im.width = 160; im.height = 100; im.loading = 'lazy'; im.decoding = 'async';
    a.appendChild(im); a.appendChild(el('strong',null,b.name));
    a.appendChild(el('small',null, x.n+' upgrade'+(x.n>1?'s':'')+' \u00b7 '+(x.p!=null?A.money(x.p):'Total TBD')));
    a.addEventListener('click', function(e){ e.preventDefault(); location.hash = a.getAttribute('href').slice(1); location.reload(); });
    return a;
  });
  sec('Recently viewed', R, function(x){
    var a = el('a','ux-card ux-card-s'); a.href = x.u;
    if(x.i){ var im = el('img'); im.src = '/'+x.i.replace(/^\//,''); im.alt = ''; im.width = 160; im.height = 100; im.decoding = 'async'; a.appendChild(im); }
    a.appendChild(el('strong',null,x.n)); a.appendChild(el('small',null, x.k==='b'?'Bike':'Part'));
    return a;
  });
  var clr = el('button','ux-shelf-x','Clear history'); clr.type = 'button';
  clr.addEventListener('click', function(){ lsSet('builds', []); lsSet('recent', []); renderShelf(); });
  host.appendChild(clr);
}

/* ---------- part page photo zoom ---------- */
function wireZoom(){
  $$('[data-ux-zoom]').forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      var ov = el('div','ux-zoom'); ov.setAttribute('role','dialog'); ov.setAttribute('aria-label','Photo');
      var im = el('img'); im.src = a.getAttribute('href'); im.alt = ($('img',a)||{}).alt||'';
      var x = el('button','ux-zoom-x','\u00d7'); x.type='button'; x.setAttribute('aria-label','Close photo');
      ov.appendChild(im); ov.appendChild(x); document.body.appendChild(ov);
      document.documentElement.classList.add('ux-lock');
      im.addEventListener('click', function(ev){ ev.stopPropagation(); im.classList.toggle('z2'); });
      function close(){ ov.remove(); document.documentElement.classList.remove('ux-lock'); document.removeEventListener('keydown', k); }
      function k(ev){ if(ev.key==='Escape') close(); }
      ov.addEventListener('click', close); x.addEventListener('click', close); document.addEventListener('keydown', k);
      x.focus();
    });
  });
}
function toastMsg(m){
  if(A){ A.toast(m); return; }
  var t = $('.ux-toast') || document.body.appendChild(el('div','toast ux-toast'));
  t.textContent = m; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display='none'; }, 3200);
}

/* ---------- wiring ---------- */
function wire(){
  $$('[data-ux-search]').forEach(function(b){ b.addEventListener('click', openSearch); });
  $$('[data-ux-bike]').forEach(function(b){ b.addEventListener('click', function(){ (IDX||typeof BIKES!=='undefined' ? Promise.resolve() : loadIndex()).then(function(){ openPicker(true); }); }); });
  document.addEventListener('keydown', function(e){
    var tag = (e.target && e.target.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if((e.key==='/' && !typing) || ((e.metaKey||e.ctrlKey) && (e.key==='k'||e.key==='K'))){ e.preventDefault(); openSearch(); }
    else if(e.key==='Escape'){ closeSearch(); }
  });
  paintBikeChips();
  var needIdx = !A || $('[data-ux-fitlist]') || $('[data-ux-pagebike]');
  if(needIdx && myBike() && typeof BIKES==='undefined') loadIndex().then(function(){ paintBikeChips(); applyStaticFit(); });
  applyStaticFit();
  maybeFirstVisit();
  trackPage(); wireZoom(); renderShelf();
  if(A){ updateBar(); window.addEventListener('resize', updateBar);
    ['tabBuilder','tabQuiz','tabBuilds','tabCompare','tabUpcoming','tabUsed'].forEach(function(id){ var t = document.getElementById(id); if(t) t.addEventListener('click', function(){ setTimeout(updateBar, 0); }); });
    var bs = document.getElementById('btnStart'); if(bs) bs.addEventListener('click', function(){ setTimeout(updateBar, 0); });
  }
}
window.__ux = {
  myBike: myBike, changed: changed, rendered: function(){ updateBar(); }, openSearch: openSearch, openPicker: function(){ openPicker(true); }
};
function init(){ A = window.__app || null; wire(); }
/* with deferred scripts app.js runs after this file: wait for it on the builder page */
var started = false;
function start(){ if(started) return; started = true; init(); }
if(document.getElementById('app')){
  if(window.__app) start(); else { document.addEventListener('ebpp:app', start); document.addEventListener('DOMContentLoaded', start); }
} else if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
