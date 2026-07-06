/* page-transitions.js — slide page transitions on mobile widths.

   Plays a slide-OUT the instant a same-origin link is tapped (immediate tap
   feedback — see the "1-2 second freeze" complaint this fixes), then a
   slide-IN on every page arrival (link nav, back/forward, JS redirect).
   Animates <html> via the .ao-page-enter/.ao-page-leaving classes in
   style.css.

   SAFETY NOTE — read before changing the exit animation: an earlier version
   of this file drove the leaving page to opacity:0 (fully hidden) and relied
   on navigation completing soon after to reveal the next page. On a slow
   connection or a cold-starting Render.com server, that left the old page
   invisible-but-still-tappable for however long the fetch took, with no
   timer to bring it back — this is what read as the app "freezing"/going
   black. The current ao-slide-out keyframe (style.css) never goes below
   opacity 0.4 and is a pure CSS animation with `forwards` fill, so no matter
   how long navigation takes, the worst case is "dimmed and shifted a bit" —
   never invisible, never stuck, no JS reveal-timer required. Do not change
   the exit keyframe's end state back to opacity:0. */

(function () {
  function isMobile() { return window.matchMedia('(max-width: 1024px)').matches; }

  // Once a navigation is committed to, ignore further taps — without this,
  // an impatient double-tap on a slow device could queue a second
  // location.href change that fires while the first is already unloading,
  // occasionally landing on the wrong page or showing two overlapping slides.
  var leaving = false;

  document.addEventListener('click', function (e) {
    if (leaving || !isMobile() || e.defaultPrevented || e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.target && a.target !== '' && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(javascript:|mailto:|tel:)/i.test(href)) return;
    var url;
    try { url = new URL(href, location.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.href.split('#')[0] === location.href.split('#')[0]) return;

    e.preventDefault();
    leaving = true;
    document.documentElement.classList.add('ao-page-leaving');
    // Wait for the FULL exit animation (180ms, matches the ao-slide-out
    // duration in style.css) before handing off to the real navigation.
    // Navigating mid-animation is what read as "freezing mid-run" — the
    // browser starts tearing the current page down for the new document
    // load while the slide-out is still playing, so the animation visibly
    // stalls partway through instead of completing. Letting it finish first
    // gives three clean beats instead: full slide-out plays out, THEN the
    // browser shows a blank tab while it loads the destination (already
    // usually cache-warm via instant-nav.js's touchstart prefetch), THEN the
    // destination's static skeleton HTML paints and its own slide-in plays.
    setTimeout(function () { location.href = url.href; }, 180);
  }, true);

  function playEnter() {
    leaving = false;
    if (!isMobile()) return;
    var html = document.documentElement;
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
    setTimeout(cleanup, 350);
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
