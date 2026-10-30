/* Home button: back to the start page from the builder. Additive only.
   Shows #start, hides #app, clears the build hash from the URL (so a
   refresh stays on the start page instead of jumping back into the
   builder), and scrolls to the top. Does not touch builder state. */
(function () {
  function goHome() {
    var s = document.getElementById('start');
    var a = document.getElementById('app');
    if (s) s.hidden = false;
    if (a) a.hidden = true;
    try { history.replaceState(null, '', '/'); } catch (e) {}
    window.scrollTo(0, 0);
  }
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('tabHome');
    if (b) b.addEventListener('click', goHome);
  });
})();
