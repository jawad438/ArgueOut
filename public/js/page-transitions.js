/* page-transitions.js — slide-IN page transitions on mobile widths.

   Plays a short slide-in on every page arrival (link nav, back/forward,
   JS redirect). Animates <html> via the .ao-page-enter class in style.css.

   IMPORTANT: this intentionally does NOT intercept link clicks to play a
   slide-OUT before navigating. An earlier version did, applying opacity:0
   to the whole page and then calling location.href. On a slow connection or
   a cold-starting server the new page can take several seconds to load, and
   during that time the old page stayed held at opacity:0 — a black screen
   that still received taps, which read as the app "freezing". Letting links
   navigate normally keeps the current page fully visible until the next one
   is ready; the slide-in on arrival is enough to feel like a transition. */

(function () {
  function isMobile() { return window.matchMedia('(max-width: 1024px)').matches; }

  function playEnter() {
    if (!isMobile()) return;
    var html = document.documentElement;
    // Defensive: clear any stale leaving class left by an older cached build.
    html.classList.remove('ao-page-leaving');
    html.classList.add('ao-page-enter');
    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      html.classList.remove('ao-page-enter');
      html.removeEventListener('animationend', cleanup);
    }
    html.addEventListener('animationend', cleanup);
    // Fallback in case the animation never fires (e.g. prefers-reduced-motion
    // sets animation:none), so the class can never get stuck on <html>.
    setTimeout(cleanup, 280);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', playEnter);
  } else {
    playEnter();
  }
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) playEnter();
  });
})();
