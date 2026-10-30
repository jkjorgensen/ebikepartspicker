/* eBikePartsPicker — premium scroll motion v3 (2026-10-30). Every effect is scrubbed by
   scroll position (rAF, transform/opacity only); nothing plays on its own. No-JS and
   prefers-reduced-motion users get the static, fully visible page. Never touches builder
   logic, prices, fitment, tracking or forms. */
(function () {
  'use strict';
  try {
    var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var bar = document.getElementById('polishProgress');
    var topbar = document.querySelector('.topbar');
    var start = document.getElementById('start');
    var root = document.documentElement;
    var C = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
    var ease = function (x) { return 1 - Math.pow(1 - x, 3); };
    var reduced = function () { return !!(mq && mq.matches); };
    var on = false, ticking = false, vh = window.innerHeight;

    function split(el) {
      if (!el || el.getAttribute('data-split')) return;
      el.setAttribute('data-split', '1');
      var words = el.textContent.trim().split(/\s+/);
      el.textContent = '';
      words.forEach(function (w, i) {
        var s = document.createElement('span'); s.className = 'w'; s.textContent = w;
        el.appendChild(s); if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      });
    }
    var heroPin = document.querySelector('.hero-pin'), stage = heroPin && heroPin.querySelector('.herostage');
    var hero = document.getElementById('heroImg'), glow = document.querySelector('.hz-glow'), floor = document.querySelector('.hz-floor');
    var voltPin = document.querySelector('.volt-pin'), volt = document.querySelector('.voltband');
    var popTitle = document.querySelector('.pop-title'), grid = document.getElementById('popGrid');
    var notify = document.querySelector('.notify');
    var stats = [].slice.call(document.querySelectorAll('.stats .stat'));
    var nums = ['statBikes', 'statParts', 'statCats'].map(function (id) { return document.getElementById(id); });
    var targets = null, statsLive = false;

    function enable() {
      if (on || reduced()) return;
      on = true; root.classList.add('m-on');
      [popTitle].concat(volt ? [].slice.call(volt.querySelectorAll('.volt-eyebrow,h2,p')) : []).forEach(split);
      /* counting is scroll-scrubbed only if the stats start below the fold; otherwise show the real numbers */
      targets = nums.map(function (el) { return el ? parseInt(el.textContent.replace(/[^0-9]/g, ''), 10) || 0 : 0; });
      statsLive = stats.length && stats[0].getBoundingClientRect().top > vh * 0.9;
    }
    function disable() {
      if (!on) return; on = false; root.classList.remove('m-on');
      nums.forEach(function (el, i) { if (el && targets) el.textContent = targets[i]; });
      [hero, glow, floor, stage].forEach(function (el) { if (el) el.style.transform = ''; });
    }
    function words(el, p) {
      if (!el) return; var ws = el.querySelectorAll('.w'), n = ws.length || 1;
      for (var i = 0; i < ws.length; i++) ws[i].style.setProperty('--o', ease(C(p * (n + 2) / 3 - i / 3)).toFixed(3));
    }
    function prog(el, a, b) { /* 0 when el top is at a*vh, 1 at b*vh */
      var t = el.getBoundingClientRect().top; return C((a * vh - t) / ((a - b) * vh));
    }
    function frame() {
      ticking = false;
      var y = window.scrollY || 0, h = root.scrollHeight - vh;
      if (bar) bar.style.transform = 'scaleX(' + (h > 0 ? y / h : 0).toFixed(4) + ')';
      if (topbar) topbar.classList.toggle('polish-scrolled', y > 8);
      if (!on || !start || start.offsetParent === null) return;
      /* hero accent sweep */
      root.style.setProperty('--sweep', (C(y / 260) * 100).toFixed(1) + '%');
      /* pinned hero: bike stays still; layered parallax on glow/floor only */
      if (heroPin && hero) {
        var r = heroPin.getBoundingClientRect(), span = Math.max(1, r.height - stage.offsetHeight);
        var p = C(-(r.top - parseFloat(getComputedStyle(stage).top)) / span), q = C((vh - r.top) / vh);
        if (glow) glow.style.transform = 'translate3d(' + ((p - 0.5) * -60).toFixed(1) + 'px,' + (p * 70).toFixed(1) + 'px,0) scale(' + (1 + p * 0.4).toFixed(3) + ')';
        if (floor) floor.style.transform = 'translate3d(' + ((p - 0.5) * 40).toFixed(1) + 'px,' + (p * -20).toFixed(1) + 'px,0) scaleX(' + (1 + p * 0.3).toFixed(3) + ')';
      }
      /* stats rise + scroll-scrubbed count up to the real numbers */
      if (stats.length) {
        var sp = statsLive ? prog(stats[0].parentNode, 1, 0.6) : 1;
        stats.forEach(function (s, i) { s.style.setProperty('--o', ease(C(sp * 1.6 - i * 0.2)).toFixed(3)); });
        nums.forEach(function (el, i) { if (el) el.textContent = sp >= 1 ? targets[i] : Math.round(targets[i] * ease(sp)); });
      }
      /* popular: pinned title (CSS sticky), words reveal, cards stagger */
      if (popTitle) words(popTitle, prog(popTitle, 0.95, 0.6));
      if (grid) {
        var cards = grid.children, cols = window.innerWidth < 700 ? 2 : 4;
        for (var k = 0; k < cards.length; k++)
          cards[k].style.setProperty('--o', ease(C(prog(cards[k], 1.02, 0.62) * 1.25 - (k % cols) * 0.12)).toFixed(3));
      }
      /* volt band: pinned, wipes open, then words reveal line by line */
      if (voltPin && volt) {
        var vr = voltPin.getBoundingClientRect(), vp = C((vh - vr.top) / (vr.height));
        var wipe = ease(C(vp * 2.4 - 0.15));
        volt.style.setProperty('--vw', ((1 - wipe) * 100).toFixed(2));
        volt.style.setProperty('--vx', ((1 - wipe) * -40).toFixed(1));
        var ls = volt.querySelectorAll('.volt-eyebrow,h2,p');
        for (var j = 0; j < ls.length; j++) words(ls[j], C(vp * 2.6 - 0.55 - j * 0.28));
      }
      if (notify) notify.style.setProperty('--o', ease(prog(notify, 1, 0.75)).toFixed(3));
    }
    function req() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
    if (bar) { bar.style.width = '100%'; bar.style.transformOrigin = '0 50%'; bar.style.transform = 'scaleX(0)'; }
    enable();
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { reduced() ? disable() : enable(); req(); });
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', function () { vh = window.innerHeight; req(); }, { passive: true });
    if (grid && 'MutationObserver' in window) new MutationObserver(req).observe(grid, { childList: true });
    frame();
  } catch (err) { document.documentElement.classList.remove('m-on'); }
})();
