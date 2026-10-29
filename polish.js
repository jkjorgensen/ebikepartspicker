/* eBikePartsPicker — design polish motion (2026-10-29). Progressive enhancement only:
   no-JS and reduced-motion users see full content, static. Nothing here touches
   builder logic, prices, fitment, tracking, or forms. */
(function () {
  'use strict';
  try {
    var reduced = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var bar = document.getElementById('polishProgress');
    var topbar = document.querySelector('.topbar');
    var hero = document.getElementById('heroImg');
    var start = document.getElementById('start');
    var ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY || 0;
        var h = document.documentElement.scrollHeight - window.innerHeight;
        if (bar) bar.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
        if (topbar) topbar.classList.toggle('polish-scrolled', y > 8);
        if (!reduced && hero && start && start.offsetParent !== null) {
          var t = Math.min(y, 400);
          hero.style.transform = 'translateY(' + (t * 0.06) + 'px) scale(' + (1 + t * 0.0001) + ')';
        }
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (reduced || !('IntersectionObserver' in window)) return;

    /* Scroll reveals (start page sections only — never the interactive builder). */
    var targets = document.querySelectorAll(
      '.stats, .herostage, .popular, .featured, .notify, .voltband');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    targets.forEach(function (el) { el.classList.add('rv'); io.observe(el); });

    /* Count-up stats: targets are the real numbers already in the markup. */
    var statIds = ['statBikes', 'statParts', 'statCats'];
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        cio.unobserve(el);
        var target = parseInt(el.textContent.replace(/[^0-9]/g, ''), 10);
        if (!target) return;
        var t0 = performance.now(), dur = 1200;
        (function tick(now) {
          var p = Math.min((now - t0) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * eased);
          if (p < 1) requestAnimationFrame(tick);
          else el.textContent = target;
        })(t0);
      });
    }, { threshold: 0.4 });
    statIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) cio.observe(el);
    });
  } catch (err) { /* polish must never break the page */ }
})();
