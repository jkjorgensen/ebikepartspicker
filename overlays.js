/* overlays.js — part overlay layers drawn on top of the builder's base bike photo.
   Coordinates are % of the base image (img/bike-<id>.png): x,y = layer CENTER,
   w = layer width as % of base width (height follows the PNG's aspect ratio).
   z orders layers (higher = on top). A layer with role:'cover' hides the stock
   part underneath (e.g. a dark disc behind new spokes). See part-overlay-design.md. */
var OVERLAYS = {
  'ultrabee': {
    'charged-21-front-wheel-ultrabee': [
      {src:'img/overlays/cover-wheel-dark.png', x:81.4, y:70.6, w:26.0, z:10, role:'cover'},
      {src:'img/overlays/charged-21-front-wheel-ultrabee.png', x:81.4, y:70.6, w:26.5, z:20}
    ]
  }
};

/* Position the overlay box exactly over the visible (object-fit:contain) image area. */
function fitOverlayBox(img, box){
  var W = img.clientWidth, H = img.clientHeight, nw = img.naturalWidth, nh = img.naturalHeight;
  if(!W || !H || !nw || !nh){ box.style.display='none'; return; }
  var s = Math.min(W/nw, H/nh), dw = nw*s, dh = nh*s;
  box.style.display = '';
  box.style.left = (img.offsetLeft + (W-dw)/2)+'px'; box.style.top = (img.offsetTop + (H-dh)/2)+'px';
  box.style.width = dw+'px'; box.style.height = dh+'px';
}
function renderOverlays(bikeId, sel){
  var img = document.getElementById('bikeImg'), box = document.getElementById('bikeOverlays');
  if(!img || !box) return;
  var map = OVERLAYS[bikeId] || {}, layers = [];
  CATEGORIES.forEach(function(c){
    var o = c.options[sel[c.id]||0];
    if(o && o.pid && map[o.pid]) layers = layers.concat(map[o.pid].map(function(l){ return {l:l, cat:c.id}; }));
  });
  var key = bikeId+'|'+layers.map(function(x){ return x.l.src; }).join(',');
  if(box.getAttribute('data-key') !== key){
    box.innerHTML = ''; box.setAttribute('data-key', key);
    layers.sort(function(a,b){ return (a.l.z||0)-(b.l.z||0); }).forEach(function(x){
      var e = document.createElement('img'); e.src = x.l.src; e.alt = ''; e.className = 'ovl'+(x.l.role==='cover'?' ovl-cover':'');
      e.style.left = x.l.x+'%'; e.style.top = x.l.y+'%'; e.style.width = x.l.w+'%'; e.style.zIndex = x.l.z||0;
      box.appendChild(e);
    });
  }
  fitOverlayBox(img, box);
}
