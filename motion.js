/* eBikePartsPicker cinematic scroll motion v6.0.2 (2026-11-16): v5 story, now spring-driven.
   Lenis inertial scrolling synced to GSAP ScrollTrigger. Home page story, all scrubbed by scroll:
   1. the headline splits into letters that scatter away as you scroll;
   2. the hero bike tilts up out of the page, then a full-screen pinned reveal: the studio card
      grows to fill the screen, the lights come up with a volt light sweep, a giant outline word
      slides behind the bike, "Real parts / Real prices / Real fitment" fly in, and the camera
      pushes into the bike before it hands off to the Popular grid;
   3. Popular cards rise in with 3D depth, a two-row type marquee slides between sections,
      later sections slide up as they enter, and a volt glow follows the hovered card.
   v6: every scrubbed effect follows scroll through a small damped spring (rAF, no library), so it
   lands with a little weight and overshoot and then stops; the loop sleeps when nothing moves.
   Layered parallax depth in the hero, staggered card reveals (desktop adds a short blur-to-sharp),
   and volt accent lines that draw under section titles.
   Scroll-driven only: nothing plays or loops on its own. Transforms and opacity only (plus the
   desktop-only blur while a card is still arriving).
   prefers-reduced-motion: none of it runs (gsap.matchMedia reverts everything if it flips); the
   block below gives those visitors a short opacity-only fade instead.
   Never touches builder logic, prices, fitment, tracking or forms. polish.js still owns the
   progress bar, stats count, Popular title words and the volt band wipe. */
/* ---------- prefers-reduced-motion: a gentle, short opacity fade instead of movement ----------
   No transforms, no scrubbing, no smooth scroll. Elements already on screen are never hidden;
   ones below the fold fade in (0.45s) the first time they enter. Independent of GSAP so it
   also works if the motion libraries fail to load. Turns itself off if the setting flips. */
(function () {
  'use strict';
  var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!mq || !('IntersectionObserver' in window)) return;
  var root = document.documentElement, io = null, gm = null;
  var SEL = '.pop-title,.stats .stat,.voltband,.notify,.qstep,.qtitle,.qsub,.gstep,.alerts-box,.featured';
  var GRIDS = '#popGrid,#guideBikes,#upcomingList,#powerList';
  function mark(el) {
    if (!el || el.__rm || el.classList.contains('ux-skel-card')) return; el.__rm = 1;
    var r = el.getBoundingClientRect();
    if (el.offsetParent === null || r.top < window.innerHeight * 0.95) return; /* visible or hidden: leave alone */
    el.classList.add('mo-fd'); io.observe(el);
  }
  function on() {
    if (io) return;
    root.classList.add('mo-rm');
    io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); e.target.classList.add('mo-in'); } });
    }, { rootMargin: '0px 0px -6% 0px' });
    [].forEach.call(document.querySelectorAll(SEL), mark);
    gm = new MutationObserver(function (ms) { ms.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) mark(n); }); }); });
    [].forEach.call(document.querySelectorAll(GRIDS), function (g) { [].forEach.call(g.children, mark); gm.observe(g, { childList: true }); });
  }
  function off() {
    if (!io) return;
    io.disconnect(); gm.disconnect(); io = gm = null; root.classList.remove('mo-rm');
    [].forEach.call(document.querySelectorAll('.mo-fd'), function (el) { el.classList.remove('mo-fd', 'mo-in'); el.__rm = 0; });
  }
  function sync() { mq.matches ? on() : off(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
  if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
})();

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

  /* ---------- damped springs: scroll sets the target, a tiny rAF loop settles toward it ----------
     Underdamped (zeta < 1): values land with a touch of weight and overshoot, then stop.
     The loop only runs while some spring is still moving, so idle pages cost nothing. */
  var springs = [], rafId = 0, lastT = 0;
  var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  function spring(k, zeta, render) {
    var sp = { x: 0, v: 0, t: 0, k: k, c: 2 * zeta * Math.sqrt(k), render: render };
    springs.push(sp); return sp;
  }
  function snapTo(sp, t) { sp.t = sp.x = t; sp.v = 0; sp.render(t); }
  function step(now) {
    var dt = lastT ? Math.min(0.034, (now - lastT) / 1000) : 1 / 60; lastT = now;
    var moving = false;
    for (var i = 0; i < springs.length; i++) {
      var sp = springs[i], d = sp.x - sp.t;
      if (Math.abs(d) < 0.0005 && Math.abs(sp.v) < 0.0005) { if (d !== 0 || sp.v !== 0) snapTo(sp, sp.t); continue; }
      for (var j = 0, h = dt / 2; j < 2; j++) { sp.v += (-sp.k * (sp.x - sp.t) - sp.c * sp.v) * h; sp.x += sp.v * h; }
      sp.render(sp.x); moving = true;
    }
    rafId = moving ? requestAnimationFrame(step) : 0;
    if (!moving) lastT = 0;
  }
  function aim(sp, t) { if (sp.t === t) return; sp.t = t; if (!rafId) { lastT = 0; rafId = requestAnimationFrame(step); } }
  function stopSprings() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; lastT = 0; springs.length = 0; }
  /* drive a paused GSAP timeline with a spring instead of scrub */
  /* v6.0.2 "settle": a reveal follows scroll while you scroll, but it never rests half-done.
     Once it has fully arrived, or once scrolling stops (incl. iOS momentum) with it already on its
     way in, it springs to its final state and stays there. Still scroll-triggered only. */
  var settlers = [];
  function settleTarget(sp, p) { if (p >= 1) sp.done = true; return sp.done ? 1 : p; }
  function settleAll() {
    for (var i = 0; i < settlers.length; i++) { var o = settlers[i]; if (o.st.progress > 0 && !o.sp.done) { o.sp.done = true; aim(o.sp, 1); } }
  }
  ST.addEventListener('scrollEnd', settleAll);
  function springTL(tl, stv, k, zeta, settle) {
    tl.pause();
    var sp = spring(k, zeta, function (x) { tl.progress(clamp01(x)); });
    var tgt = function (p) { return settle ? settleTarget(sp, p) : p; };
    var st = ST.create(Object.assign({}, stv, {
      onUpdate: function (self) { aim(sp, tgt(self.progress)); },
      onRefresh: function (self) { if (stv.invalidateOnRefresh) tl.invalidate(); snapTo(sp, tgt(self.progress)); }
    }));
    snapTo(sp, tgt(st.progress));
    if (settle) settlers.push({ st: st, sp: sp });
    return st;
  }
  /* per-element spring: render(p) gets an unclamped progress (overshoot past 1 is the settle) */
  function springEl(stv, k, zeta, render) { /* reveals: always settle (see above) */
    var sp = spring(k, zeta, render);
    var st = ST.create(Object.assign({}, stv, {
      onUpdate: function (self) { aim(sp, settleTarget(sp, self.progress)); },
      onRefresh: function (self) { snapTo(sp, settleTarget(sp, self.progress)); }
    }));
    snapTo(sp, settleTarget(sp, st.progress));
    st.__sp = sp; settlers.push({ st: st, sp: sp });
    return st;
  }
  function killEl(st) {
    st.kill(); var i = springs.indexOf(st.__sp); if (i > -1) springs.splice(i, 1);
    for (var j = settlers.length - 1; j >= 0; j--) if (settlers[j].st === st) settlers.splice(j, 1);
  }
  var BLUR = window.matchMedia('(min-width: 780px) and (hover: hover)').matches && window.CSS && CSS.supports('filter', 'blur(1px)');
  function arrive(el, p, o) { /* shared reveal look: rise + depth + scale, blur-to-sharp on desktop */
    var q = 1 - p, a = clamp01(p * 1.25);
    el.style.opacity = a >= 1 ? '' : a.toFixed(3);
    el.style.transform = Math.abs(q) < 0.0005 ? '' : 'perspective(' + (o.persp || 1000) + 'px) translate3d(0,' + (q * o.y).toFixed(2) + 'px,' + (q * (o.z || 0)).toFixed(1) + 'px) rotateX(' + (q * (o.rx || 0)).toFixed(2) + 'deg) rotateY(' + (q * (o.ry || 0)).toFixed(2) + 'deg) scale(' + (1 - q * (o.s || 0)).toFixed(4) + ')';
    if (BLUR && o.blur) el.style.filter = q > 0.01 ? 'blur(' + Math.min(o.blur, q * o.blur).toFixed(2) + 'px)' : '';
  }
  function clearArrive(el) { el.style.opacity = el.style.transform = el.style.filter = el.style.transformOrigin = ''; }

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
    var tl = gsap.timeline({ defaults: { ease: 'none' } });
    chars.forEach(function (c, i) {
      tl.to(c, { yPercent: -(140 + rnd(i, 1) * 260), xPercent: (rnd(i, 2) - 0.5) * 160, rotation: (rnd(i, 3) - 0.5) * 90,
        opacity: 0, duration: 0.6, ease: 'power2.in' }, rnd(i, 4) * 0.4);
    });
    var e = $('.eyebrow', s), t = $('.tagline', s);
    if (e) tl.to(e, { y: -120, opacity: 0, letterSpacing: '14px', duration: 0.6 }, 0);
    if (t) tl.to(t, { y: -70, opacity: 0, duration: 0.7 }, 0.1);
    springTL(tl, { trigger: s, start: 'top top', end: function () { return '+=' + Math.round(window.innerHeight * 0.8); } }, 150, 0.8);
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
    var word = mk('mo-word', '<span>PART</span> <span>BY</span> <span>PART</span>', stage, img); /* exactly once, sized to fit (motion.css) */
    var sh = function () { return (mobile ? 0.05 : 0.08) * window.innerWidth; };
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
    gsap.set(word, { yPercent: -50 });

    /* a) tilt up out of the page as the stage scrolls into view */
    var pre = gsap.timeline({ defaults: { ease: 'none' } });
    pre.fromTo(card, { rotationX: 38, scale: 0.72, y: 120, opacity: 0.4 }, { rotationX: 0, scale: 1, y: 0, opacity: 1, ease: 'power2.out' }, 0)
       .fromTo(img, { rotationX: 30, rotation: -9, scale: 0.78, y: 160, opacity: 0.25 }, { rotationX: 0, rotation: -4, scale: 1, y: 0, opacity: 0.6, ease: 'power2.out' }, 0)
       .fromTo(word, { x: function () { return 2 * sh(); }, opacity: 0 }, { x: sh, opacity: 0.55 }, 0);
    springTL(pre, { trigger: pin, start: 'top bottom', end: 'top top', invalidateOnRefresh: true }, 140, 0.74);

    /* b) pinned (CSS sticky) reveal over the length of .hero-pin */
    var s1 = mobile ? 1.65 : 1.45, s2 = mobile ? 3.6 : 3.0;
    var glow = $('.hz-glow', stage), floor = $('.hz-floor', stage);
    var vh = function () { return window.innerHeight; };
    var tl = gsap.timeline({ defaults: { ease: 'none' } });
    tl.to(hint, { opacity: 0, y: -20, duration: 0.05 }, 0)
      .to(rail.firstChild, { scaleX: 1, duration: 1 }, 0)
      .to(card, { scale: cover, ease: 'power2.inOut', duration: 0.38 }, 0)
      .to(img, { scale: s1, rotation: 0, opacity: 1, yPercent: mobile ? 0 : 4, ease: 'power2.inOut', duration: 0.38 }, 0)
      .fromTo(word, { x: sh }, { x: function () { return -sh(); }, duration: 0.9 }, 0)
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
    /* layered parallax depth: back layers drift slower than the bike, captions faster */
    if (glow) tl.fromTo(glow, { y: 0, scale: 1 }, { y: function () { return vh() * 0.14; }, scale: 1.18, duration: 0.74 }, 0);
    if (floor) tl.fromTo(floor, { y: 0, scaleX: 1 }, { y: function () { return vh() * 0.06; }, scaleX: 1.3, duration: 0.7 }, 0);
    tl.fromTo(word, { y: 0 }, { y: function () { return -vh() * 0.05; }, duration: 0.9 }, 0)
      .fromTo(caps, { y: function () { return vh() * 0.06; } }, { y: function () { return -vh() * 0.08; }, duration: 0.95 }, 0)
      .fromTo(card, { y: 0 }, { y: function () { return vh() * 0.03; }, duration: 0.74 }, 0);
    tl
      .to(rail, { opacity: 0, duration: 0.05 }, 0.95);
    springTL(tl, { trigger: pin, start: 'top top', end: 'bottom bottom', invalidateOnRefresh: true }, mobile ? 190 : 165, 0.72);
    return function () {
      [card, word, sweep, caps, rail, hint].forEach(function (n) { n.remove(); });
      if (oldSizes) img.setAttribute('sizes', oldSizes);
    };
  }

  /* ---------- 3) Popular: title words rise, cards fly in with 3D depth ---------- */
  function popular(mobile) {
    var sec = $('.popular'), grid = $('#popGrid'); if (!sec || !grid) return;
    var title = $('.pop-title', sec), trig = [], done = new WeakSet(), cleanup = [];
    if (title) {
      var ws = $$('.w', title);
      /* y:0 explicitly, so GSAP never bakes polish.js's CSS word offset into its own transform
         (that left the title stuck ~0.6em low and half hidden by its overflow mask) */
      if (ws.length) springTL(gsap.timeline().fromTo(ws, { y: 0, yPercent: 120, rotation: 10, opacity: 0 }, { y: 0, yPercent: 0, rotation: 0, opacity: 1, stagger: 0.12, ease: 'power3.out' }),
        { trigger: title, start: 'top 98%', end: 'top 62%' }, 170, 0.66, true);
    }
    function build() {
      var cards = [].slice.call(grid.children).filter(function (c) { return !c.classList.contains('ux-skel-card'); });
      if (!cards.length || cards.every(function (c) { return done.has(c); })) return;
      trig.forEach(killEl); trig = [];
      var cols = mobile ? 2 : 4;
      cards.forEach(function (c, i) {
        done.add(c);
        var col = i % cols, side = (col - (cols - 1) / 2);
        var look = { y: mobile ? 110 : 160, z: -220, rx: 42, ry: side * (mobile ? -14 : -10), s: 0.18, blur: 8 };
        c.style.transformOrigin = '50% 100%';
        /* columns get slightly softer springs so a row lands left-to-right with a stagger */
        trig.push(springEl({ trigger: c, start: 'top bottom-=' + (col * (mobile ? 30 : 46)) + 'px', end: 'top ' + (mobile ? 62 : 58) + '%' },
          (mobile ? 230 : 210) - col * 16, 0.6, function (p) { arrive(c, p, look); }));
        cleanup.push(c);
      });
      refresh();
    }
    build();
    var mo = new MutationObserver(build); mo.observe(grid, { childList: true });
    return function () { mo.disconnect(); cleanup.forEach(clearArrive); };
  }

  /* ---------- 4) two-row type marquee between Popular and the volt band ---------- */
  function marquee() {
    var anchor = $('.volt-pin'); if (!anchor) return;
    var txt = 'NO GUESSING \u2014 JUST FITMENT \u2014 REAL PARTS \u2014 REAL PRICES \u2014 ';
    var m = mk('mo-marq', '<div class="mo-row"><span>' + txt + txt + '</span></div><div class="mo-row mo-row2"><span>' + txt + txt + '</span></div>', anchor.parentNode, anchor);
    var rows = $$('.mo-row span', m);
    var tl = gsap.timeline({ defaults: { ease: 'none' } });
    tl.fromTo(rows[0], { xPercent: 0 }, { xPercent: -35 }, 0).fromTo(rows[1], { xPercent: -40 }, { xPercent: -5 }, 0)
      .fromTo(m, { rotation: -4, scale: 0.92 }, { rotation: 2, scale: 1.04 }, 0);
    springTL(tl, { trigger: m, start: 'top bottom', end: 'bottom top' }, 110, 0.85);
    return function () { m.remove(); };
  }

  /* ---------- 5) section reveals: scroll position drives a spring (never hides what is already on screen) ---------- */
  function reveals() {
    var touched = [];
    function reveal(el, i) {
      if (!el || el.__mo) return; el.__mo = 1;
      var r = el.getBoundingClientRect();
      if (el.offsetParent === null || r.top < window.innerHeight * 0.92) return;
      var look = { y: 80, rx: 12, s: 0.05, persp: 900, blur: 6 };
      el.style.transformOrigin = '50% 0%'; touched.push(el);
      /* items in a grid row start a little later the further right they sit: a scroll-driven stagger */
      var lag = (i || 0) % 4 * 28;
      springEl({ trigger: el, start: 'top bottom-=' + lag + 'px', end: 'top 70%' }, 200 - ((i || 0) % 4) * 14, 0.62, function (p) { arrive(el, p, look); });
    }
    $$('.qstep,.qtitle,.qsub,.gstep,.alerts-box,.featured').forEach(function (el) { reveal(el, 0); });
    var grids = $$('#guideBikes,#upcomingList,#powerList');
    var gm = new MutationObserver(function (ms) {
      ms.forEach(function (m) { var g = m.target; if (g.__moDone || !g.children.length) return; g.__moDone = 1; [].slice.call(g.children, 0, 24).forEach(reveal); refresh(); });
    });
    grids.forEach(function (g) { if (g.children.length) { g.__moDone = 1; [].slice.call(g.children, 0, 24).forEach(reveal); } else gm.observe(g, { childList: true }); });
    return function () { gm.disconnect(); touched.forEach(function (el) { clearArrive(el); el.__mo = 0; }); grids.forEach(function (g) { g.__moDone = 0; }); };
  }

  /* ---------- 5b) volt accent lines draw under section titles as they scroll in (spring, with a small overshoot) ---------- */
  function accents() {
    var made = [];
    $$('.qtitle,.alerts-box h2').forEach(function (h) {
      if ($('.mo-acc', h)) return;
      var line = document.createElement('span'); line.className = 'mo-acc'; line.setAttribute('aria-hidden', 'true');
      h.appendChild(line); made.push(line);
      springEl({ trigger: h, start: 'top 92%', end: 'top 50%' }, 240, 0.5, function (p) {
        line.style.transform = 'scaleX(' + Math.max(0, p).toFixed(4) + ')';
      });
    });
    return function () { made.forEach(function (n) { n.remove(); }); };
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
    var undo = [smooth(), headline(), hero(m), popular(m), marquee(), reveals(), accents(), c.hover ? glows() : null];
    refresh();
    return function () { root.classList.remove('mo-on'); undo.forEach(function (f) { if (f) f(); }); stopSprings(); settlers.length = 0; };
  });

  /* layout changes (bike photos, data.js filling the grids, start/app switching) -> re-measure */
  window.addEventListener('load', refresh);
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(document.body);
  var s = $('#start'), a = $('#app');
  var vm = new MutationObserver(function () { if (lenis) lenis.scrollTo(window.scrollY, { immediate: true }); refresh(); });
  [s, a].forEach(function (el) { if (el) vm.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
})();
