/* eBikePartsPicker cinematic scroll motion v5 (2026-11-12).
   Lenis inertial scrolling synced to GSAP ScrollTrigger. Home page story, all scrubbed by scroll:
   1. the headline splits into letters that scatter away as you scroll;
   2. the hero bike tilts up out of the page, then a full-screen pinned reveal: the studio card
      grows to fill the screen, the lights come up with a volt light sweep, a giant outline word
      slides behind the bike, "Real parts / Real prices / Real fitment" fly in, and the camera
      pushes into the bike before it hands off to the Popular grid;
   3. Popular cards rise in with 3D depth, a two-row type marquee slides between sections,
      later sections slide up as they enter, and a volt glow follows the hovered card.
   Scroll-driven only: nothing plays or loops on its own. Transforms and opacity only.
   prefers-reduced-motion: none of it runs (gsap.matchMedia reverts everything if it flips).
   Never touches builder logic, prices, fitment, tracking or forms. polish.js still owns the
   progress bar, stats count, Popular title words and the volt band wipe. */
(function () {
  'use strict';
  if (!window.gsap || !window.ScrollTrigger || !window.Lenis) return;
  var gsap = window.gsap, ST = window.ScrollTrigger, root = document.documentElement;
  gsap.registerPlugin(ST);
  ST.config({ ignoreMobileResize: true });
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return [].slice.call((c || document).querySelectorAll(s)); };
  var mk = function (cls, html, parent, before) {
    var d = document.createElement('div'); d.className = cls; d.setAttribute('aria-hidden', 'true');
    if (html) d.innerHTML = html;
    if (parent) parent.insertBefore(d, before || null);
    return d;
  };
  var lenis = null;
  var PREVENT = '.ux-pick-list,.combo-list,[role=dialog],.modal-overlay,.ux-zoom,.ux-search,[data-lenis-prevent]';
  /* deterministic "random" so the scatter looks the same every visit */
  var rnd = function (i, k) { var x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

  function locked() {
    if (root.classList.contains('ux-lock')) return true;
    if (document.body && document.body.style.overflow === 'hidden') return true;
    return $$('.modal-overlay').some(function (m) { return !m.hidden; });
  }
  function syncLock() { if (lenis) { locked() ? lenis.stop() : lenis.start(); } }
  var refreshT = 0;
  function refresh() { clearTimeout(refreshT); refreshT = setTimeout(function () { if (lenis) lenis.resize(); ST.refresh(); }, 120); }

  /* ---------- smooth inertial scroll (wheel only; touch stays native) ---------- */
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

  /* ---------- 1) headline splits into letters that scatter on scroll ---------- */
  function headline() {
    var s = $('#start'), d = s && $('.display', s); if (!d) return;
    var orig = d.innerHTML, label = d.textContent.replace(/\s+/g, ' ').trim();
    var chars = [];
    function splitNode(node, into) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { into.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'mo-wd';
            part.split('').forEach(function (ch) { var c = document.createElement('span'); c.className = 'mo-c'; c.textContent = ch; w.appendChild(c); chars.push(c); });
            into.appendChild(w);
          });
        } else if (n.nodeType === 1) {
          var clone = n.cloneNode(false); into.appendChild(clone); splitNode(n, clone);
        }
      });
    }
    var frag = document.createDocumentFragment(), tmp = document.createElement('div');
    tmp.innerHTML = orig; splitNode(tmp, frag);
    d.innerHTML = ''; d.appendChild(frag);
    d.setAttribute('aria-label', label);
    $$('.mo-wd', d).forEach(function (w) { w.setAttribute('aria-hidden', 'true'); });
    var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: s, start: 'top top', end: function () { return '+=' + Math.round(window.innerHeight * 0.8); }, scrub: true } });
    chars.forEach(function (c, i) {
      tl.to(c, { yPercent: -(140 + rnd(i, 1) * 260), xPercent: (rnd(i, 2) - 0.5) * 160, rotation: (rnd(i, 3) - 0.5) * 90,
        opacity: 0, duration: 0.6, ease: 'power2.in' }, rnd(i, 4) * 0.4);
    });
    var e = $('.eyebrow', s), t = $('.tagline', s);
    if (e) tl.to(e, { y: -120, opacity: 0, letterSpacing: '14px', duration: 0.6 }, 0);
    if (t) tl.to(t, { y: -70, opacity: 0, duration: 0.7 }, 0.1);
    return function () { d.innerHTML = orig; d.removeAttribute('aria-label'); };
  }

  /* ---------- 2) hero: tilt up, then the full-screen pinned reveal ---------- */
  function hero(mobile) {
    var pin = $('.hero-pin'), stage = pin && $('.herostage', pin), img = $('#heroImg');
    if (!pin || !stage || !img) return;
    var name = (img.getAttribute('alt') || '').replace(/\s*electric dirt bike\s*$/i, '');
    var oldSizes = img.getAttribute('sizes');
    img.setAttribute('sizes', '(max-width: 900px) 200vw, 1600px'); /* sharper photo once it is zoomed */
    var card = mk('mo-card', '', stage, stage.firstChild);
    var word = mk('mo-word', '<span>PART BY PART&nbsp;&nbsp;PART BY PART</span>', stage, img);
    var sweep = mk('mo-sweep', '', stage);
    var caps = mk('mo-caps', (name ? '<div class="mo-cap mo-cap0">' + name.replace(/[<>&]/g, '') + '</div>' : '') +
      '<div class="mo-cap mo-cap1"><i></i>Real parts.</div><div class="mo-cap mo-cap2"><i></i>Real prices.</div><div class="mo-cap mo-cap3"><i></i>Real fitment.</div>', stage);
    var rail = mk('mo-rail', '<span></span>', stage);
    var hint = mk('mo-hint', 'Scroll', stage);
    var cw = function () { return card.offsetWidth || 1; }, ch = function () { return card.offsetHeight || 1; };
    var cover = function () { return Math.max(window.innerWidth / cw(), window.innerHeight / ch()) * 1.12; };
    var vw = function () { return window.innerWidth; };
    gsap.set([card, img], { transformPerspective: 1100 });
    gsap.set(sweep, { skewX: -18 });

    /* a) tilt up out of the page as the stage scrolls into view */
    var pre = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: pin, start: 'top bottom', end: 'top top', scrub: true, invalidateOnRefresh: true } });
    pre.fromTo(card, { rotationX: 38, scale: 0.72, y: 120, opacity: 0.4 }, { rotationX: 0, scale: 1, y: 0, opacity: 1, ease: 'power2.out' }, 0)
       .fromTo(img, { rotationX: 30, rotation: -9, scale: 0.78, y: 160, opacity: 0.25 }, { rotationX: 0, rotation: -4, scale: 1, y: 0, opacity: 0.6, ease: 'power2.out' }, 0)
       .fromTo(word, { xPercent: 28, opacity: 0 }, { xPercent: 12, opacity: 0.55 }, 0);

    /* b) pinned (CSS sticky) reveal over the length of .hero-pin */
    var s1 = mobile ? 1.65 : 1.45, s2 = mobile ? 3.6 : 3.0;
    var glow = $('.hz-glow', stage), floor = $('.hz-floor', stage);
    var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: pin, start: 'top top', end: 'bottom bottom',
      scrub: mobile ? 0.3 : true, invalidateOnRefresh: true } });
    tl.to(hint, { opacity: 0, y: -20, duration: 0.05 }, 0)
      .to(rail.firstChild, { scaleX: 1, duration: 1 }, 0)
      .to(card, { scale: cover, ease: 'power2.inOut', duration: 0.38 }, 0)
      .to(img, { scale: s1, rotation: 0, opacity: 1, yPercent: mobile ? 0 : 4, ease: 'power2.inOut', duration: 0.38 }, 0)
      .fromTo(word, { xPercent: 12 }, { xPercent: -62, duration: 0.9 }, 0)
      .to(word, { opacity: 1, duration: 0.2 }, 0.05)
      .fromTo(sweep, { x: function () { return -0.6 * vw(); } }, { x: function () { return 1.4 * vw(); }, ease: 'power1.inOut', duration: 0.3 }, 0.14)
      .fromTo(sweep, { opacity: 0 }, { opacity: 1, duration: 0.06, yoyo: true, repeat: 1, repeatDelay: 0.18 }, 0.14);
    $$('.mo-cap', caps).forEach(function (c, i) {
      var from = i === 0 ? { y: 30 } : { y: 90, x: (i % 2 ? -1 : 1) * (mobile ? 40 : 120), rotationX: -50 };
      tl.fromTo(c, Object.assign({ opacity: 0, scale: 0.86, transformPerspective: 700 }, from),
        { opacity: 1, x: 0, y: 0, rotationX: 0, scale: 1, ease: 'power3.out', duration: 0.14 }, 0.3 + i * 0.07)
        .to(c, { opacity: 0, y: -60, scale: 1.08, ease: 'power2.in', duration: 0.1 }, 0.66 + i * 0.02);
    });
    tl.to(img, { scale: s1 * 1.1, duration: 0.22 }, 0.38)
      .to(img, { scale: s2, yPercent: mobile ? -6 : -2, ease: 'power2.in', duration: 0.3 }, 0.6)
      .to(img, { opacity: 0, ease: 'power1.in', duration: 0.12 }, 0.74)
      .to(word, { opacity: 0, duration: 0.12 }, 0.66)
      .to(card, { opacity: 0, ease: 'power1.in', duration: 0.16 }, 0.74);
    if (glow) tl.to(glow, { opacity: 0, duration: 0.14 }, 0.74);
    if (floor) tl.to(floor, { opacity: 0, duration: 0.1 }, 0.7);
    tl
      .to(rail, { opacity: 0, duration: 0.05 }, 0.95);
    return function () {
      [card, word, sweep, caps, rail, hint].forEach(function (n) { n.remove(); });
      if (oldSizes) img.setAttribute('sizes', oldSizes);
    };
  }

  /* ---------- 3) Popular: title words rise, cards fly in with 3D depth ---------- */
  function popular(mobile) {
    var sec = $('.popular'), grid = $('#popGrid'); if (!sec || !grid) return;
    var title = $('.pop-title', sec), trig = [], done = new WeakSet();
    if (title) {
      var ws = $$('.w', title);
      if (ws.length) gsap.fromTo(ws, { yPercent: 120, rotation: 10, opacity: 0 }, { yPercent: 0, rotation: 0, opacity: 1, stagger: 0.12, ease: 'power3.out',
        scrollTrigger: { trigger: title, start: 'top 98%', end: 'top 62%', scrub: true } });
    }
    function build() {
      var cards = [].slice.call(grid.children).filter(function (c) { return !c.classList.contains('ux-skel-card'); });
      if (!cards.length || cards.every(function (c) { return done.has(c); })) return;
      trig.forEach(function (t) { t.kill(); }); trig = [];
      var cols = mobile ? 2 : 4;
      cards.forEach(function (c, i) {
        done.add(c);
        var col = i % cols, side = (col - (cols - 1) / 2);
        var tw = gsap.fromTo(c, { opacity: 0, y: mobile ? 110 : 160, z: -220, rotationX: 42, rotationY: side * (mobile ? -14 : -10), scale: 0.82, transformPerspective: 1000, transformOrigin: '50% 100%' },
          { opacity: 1, y: 0, z: 0, rotationX: 0, rotationY: 0, scale: 1, ease: 'power2.out',
            scrollTrigger: { trigger: c, start: 'top bottom-=' + (col * (mobile ? 30 : 46)) + 'px', end: 'top ' + (mobile ? 62 : 58) + '%', scrub: mobile ? 0.3 : true } });
        trig.push(tw.scrollTrigger);
      });
      refresh();
    }
    build();
    var mo = new MutationObserver(build); mo.observe(grid, { childList: true });
    return function () { mo.disconnect(); };
  }

  /* ---------- 4) two-row type marquee between Popular and the volt band ---------- */
  function marquee() {
    var anchor = $('.volt-pin'); if (!anchor) return;
    var txt = 'NO GUESSING \u2014 JUST FITMENT \u2014 REAL PARTS \u2014 REAL PRICES \u2014 ';
    var m = mk('mo-marq', '<div class="mo-row"><span>' + txt + txt + '</span></div><div class="mo-row mo-row2"><span>' + txt + txt + '</span></div>', anchor.parentNode, anchor);
    var rows = $$('.mo-row span', m);
    var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: m, start: 'top bottom', end: 'bottom top', scrub: true } });
    tl.fromTo(rows[0], { xPercent: 0 }, { xPercent: -35 }, 0).fromTo(rows[1], { xPercent: -40 }, { xPercent: -5 }, 0)
      .fromTo(m, { rotation: -4, scale: 0.92 }, { rotation: 2, scale: 1.04 }, 0);
    return function () { m.remove(); };
  }

  /* ---------- 5) slide-up reveals with depth (fire once as each enters; never hides what is on screen) ---------- */
  var io = null, pend = [];
  function reveal(el) {
    if (!el || el.__mo) return; el.__mo = 1;
    var r = el.getBoundingClientRect();
    if (el.offsetParent !== null && r.top < window.innerHeight * 0.92) return;
    gsap.set(el, { opacity: 0, y: 90, rotationX: 14, scale: 0.95, transformPerspective: 900, transformOrigin: '50% 0%' });
    io.observe(el);
  }
  function flush() {
    var els = pend.splice(0).sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
    gsap.to(els, { opacity: 1, y: 0, rotationX: 0, scale: 1, duration: 1.1, ease: 'expo.out', stagger: 0.08, clearProps: 'opacity,transform', overwrite: true });
  }
  function reveals() {
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); pend.push(e.target); } });
      if (pend.length) requestAnimationFrame(flush);
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.qstep,.qtitle,.qsub,.gstep,.alerts-box,.featured').forEach(reveal);
    var grids = $$('#guideBikes,#upcomingList,#powerList');
    var gm = new MutationObserver(function (ms) {
      ms.forEach(function (m) { var g = m.target; if (g.__moDone || !g.children.length) return; g.__moDone = 1; [].slice.call(g.children, 0, 24).forEach(reveal); });
    });
    grids.forEach(function (g) { if (g.children.length) { g.__moDone = 1; [].slice.call(g.children, 0, 24).forEach(reveal); } else gm.observe(g, { childList: true }); });
    return function () { io.disconnect(); gm.disconnect(); };
  }

  /* ---------- 6) volt glow easing toward the hovered card (mouse only) ---------- */
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
    var m = !!c.mob;
    var undo = [smooth(), headline(), hero(m), popular(m), marquee(), reveals(), c.hover ? glows() : null];
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
