/* eBikePartsPicker premium scroll motion v4 (2026-11-12).
   Lenis inertial scrolling synced to GSAP ScrollTrigger, a pinned hero bike that scrub-scales
   up and hands off into the popular grid, headline parallax, slide-up reveals, and a volt glow
   that eases toward the hovered card. Scroll-driven only: nothing plays or loops on its own.
   prefers-reduced-motion: none of it runs (gsap.matchMedia reverts everything if it flips).
   Never touches builder logic, prices, fitment, tracking or forms. polish.js still owns the
   progress bar, stats, popular-card stagger and the volt band. */
(function () {
  'use strict';
  if (!window.gsap || !window.ScrollTrigger || !window.Lenis) return;
  var gsap = window.gsap, ST = window.ScrollTrigger, root = document.documentElement;
  gsap.registerPlugin(ST);
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return [].slice.call((c || document).querySelectorAll(s)); };
  var lenis = null;
  var PREVENT = '.ux-pick-list,.combo-list,[role=dialog],.modal-overlay,.ux-zoom,.ux-search,[data-lenis-prevent]';

  function locked() {
    if (root.classList.contains('ux-lock')) return true;
    if (document.body && document.body.style.overflow === 'hidden') return true;
    return $$('.modal-overlay').some(function (m) { return !m.hidden; });
  }
  function syncLock() { if (lenis) { locked() ? lenis.stop() : lenis.start(); } }
  var refreshT = 0;
  function refresh() { clearTimeout(refreshT); refreshT = setTimeout(function () { if (lenis) lenis.resize(); ST.refresh(); }, 120); }

  /* ---------- 1) smooth inertial scroll ---------- */
  function smooth() {
    lenis = new window.Lenis({ duration: 1.15, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true, syncTouch: false, allowNestedScroll: true,
      prevent: function (node) { return !!(node && node.closest && node.closest(PREVENT)); } });
    lenis.on('scroll', ST.update);
    var raf = function (t) { lenis.raf(t * 1000); };
    gsap.ticker.add(raf); gsap.ticker.lagSmoothing(0);
    var mo = new MutationObserver(syncLock);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    $$('.modal-overlay').forEach(function (m) { mo.observe(m, { attributes: true, attributeFilter: ['hidden'] }); });
    syncLock();
    return function () { gsap.ticker.remove(raf); mo.disconnect(); lenis.destroy(); lenis = null; };
  }

  /* ---------- 2) pinned hero: scrub-scale, then hand off ---------- */
  function hero(mobile) {
    var pin = $('.hero-pin'), stage = pin && $('.herostage', pin), img = $('#heroImg');
    if (!pin || !stage || !img) return;
    var vig = document.createElement('div'); vig.className = 'mo-vig'; vig.setAttribute('aria-hidden', 'true'); stage.appendChild(vig);
    var top = function () { return parseFloat(getComputedStyle(stage).top) || 0; };
    var cover = function () {
      var w = stage.offsetWidth || 1, h = stage.offsetHeight || 1;
      return mobile ? Math.max(window.innerWidth / w, 1) * 1.02 : Math.max(window.innerWidth / w, window.innerHeight / h) * 1.04;
    };
    var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
      trigger: pin, start: function () { return 'top ' + top() + 'px'; },
      end: function () { return 'bottom ' + (top() + stage.offsetHeight) + 'px'; },
      scrub: mobile ? 0.35 : true, invalidateOnRefresh: true } });
    tl.fromTo(stage, { scale: 1, borderRadius: 22 }, { scale: cover, borderRadius: 0, ease: 'power2.inOut', duration: 0.62 }, 0)
      .fromTo(img, { scale: 1 }, { scale: mobile ? 1.38 : 1.55, ease: 'power1.in', duration: 0.78 }, 0.04)
      .to(vig, { opacity: 1, duration: 0.3 }, 0.45)
      .to(stage, { opacity: 0, ease: 'power1.in', duration: 0.34 }, 0.62);
    return function () { vig.remove(); };
  }

  /* headline parallax: drifts slower than the page and dims as it leaves */
  function parallax() {
    var s = $('#start'); if (!s) return;
    var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: s, start: 'top top', end: '+=' + Math.round(window.innerHeight * 0.9), scrub: true } });
    var d = $('.display', s), t = $('.tagline', s), e = $('.eyebrow', s);
    if (d) tl.to(d, { yPercent: 38, opacity: 0.2 }, 0);
    if (t) tl.to(t, { yPercent: 70, opacity: 0.15 }, 0);
    if (e) tl.to(e, { yPercent: 60, opacity: 0.2 }, 0);
  }

  /* ---------- 3) slide-up reveals (fire once as each enters; never hides what is already on screen) ---------- */
  var io = null, pend = [];
  function reveal(el) {
    if (!el || el.__mo) return; el.__mo = 1;
    var r = el.getBoundingClientRect();
    if (el.offsetParent !== null && r.top < window.innerHeight * 0.92) return; /* already visible: leave it */
    gsap.set(el, { opacity: 0, y: 46 });
    io.observe(el);
  }
  function flush() {
    var els = pend.splice(0).sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
    gsap.to(els, { opacity: 1, y: 0, duration: 1, ease: 'expo.out', stagger: 0.075, clearProps: 'opacity,transform', overwrite: true });
  }
  function reveals() {
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); pend.push(e.target); } });
      if (pend.length) requestAnimationFrame(flush);
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.qstep,.qtitle,.qsub,.gstep,.alerts-box,.featured').forEach(reveal);
    /* card grids: animate the first population only, so re-renders stay instant */
    var grids = $$('#guideBikes,#upcomingList,#powerList');
    var gm = new MutationObserver(function (ms) {
      ms.forEach(function (m) { var g = m.target; if (g.__moDone || !g.children.length) return; g.__moDone = 1; [].slice.call(g.children, 0, 24).forEach(reveal); });
    });
    grids.forEach(function (g) { if (g.children.length) { g.__moDone = 1; [].slice.call(g.children, 0, 24).forEach(reveal); } else gm.observe(g, { childList: true }); });
    return function () { io.disconnect(); gm.disconnect(); };
  }

  /* ---------- 4) volt glow easing toward the hovered card ---------- */
  function glows() {
    var offs = [];
    $$('#popGrid,#guideBikes,#upcomingList').forEach(function (grid) {
      var host = grid.parentElement; if (!host) return;
      host.classList.add('mo-glowhost');
      var g = document.createElement('div'); g.className = 'mo-glow'; g.setAttribute('aria-hidden', 'true');
      host.insertBefore(g, host.firstChild);
      var qx = gsap.quickTo(g, 'x', { duration: 0.7, ease: 'power3.out' }), qy = gsap.quickTo(g, 'y', { duration: 0.7, ease: 'power3.out' });
      var shown = false;
      function over(ev) {
        var c = ev.target; while (c && c.parentElement !== grid) c = c.parentElement;
        if (!c) return;
        var hr = host.getBoundingClientRect(), cr = c.getBoundingClientRect();
        var x = cr.left - hr.left + cr.width / 2, y = cr.top - hr.top + cr.height / 2;
        if (!shown) { gsap.set(g, { x: x, y: y }); shown = true; }
        qx(x); qy(y); gsap.to(g, { opacity: 1, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
      }
      function out() { shown = false; gsap.to(g, { opacity: 0, duration: 0.6, ease: 'power2.out', overwrite: 'auto' }); }
      grid.addEventListener('pointerover', over); grid.addEventListener('pointerleave', out);
      offs.push(function () { grid.removeEventListener('pointerover', over); grid.removeEventListener('pointerleave', out); g.remove(); host.classList.remove('mo-glowhost'); });
    });
    return function () { offs.forEach(function (f) { f(); }); };
  }

  var mm = gsap.matchMedia();
  mm.add({ desk: '(prefers-reduced-motion: no-preference) and (min-width: 780px)',
           mob: '(prefers-reduced-motion: no-preference) and (max-width: 779px)',
           hover: '(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)' }, function (ctx) {
    var c = ctx.conditions; if (!c.desk && !c.mob) return;
    root.classList.add('mo-on');
    var undo = [smooth(), hero(!!c.mob), reveals(), c.hover ? glows() : null];
    parallax();
    refresh();
    return function () { root.classList.remove('mo-on'); undo.forEach(function (f) { if (f) f(); }); };
  });

  /* layout changes (bike photos, data.js filling the grids, start/app switching) -> re-measure */
  window.addEventListener('load', refresh);
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(document.body);
  var s = $('#start'), a = $('#app');
  var vm = new MutationObserver(function () { if (lenis) lenis.scrollTo(window.scrollY, { immediate: true }); refresh(); });
  [s, a].forEach(function (el) { if (el) vm.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
})();
