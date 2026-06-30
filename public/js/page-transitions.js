/* page-transitions.js — slide-sideways page transitions on mobile widths.
   Intercepts same-origin link clicks to play a slide-out before navigating,
   and plays a slide-in on every page arrival (link, back/forward, JS
   redirect). Animates <html> via the .ao-page-enter/.ao-page-leaving
   classes defined in style.css. */

(function () {
  function isMobile() { return window.matchMedia('(max-width: 1024px)').matches; }

  document.addEventListener('click', function (e) {
    if (!isMobile() || e.defaultPrevented || e.button !== 0 ||
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
    document.documentElement.classList.add('ao-page-leaving');
    setTimeout(function () { location.href = url.href; }, 150);
  }, true);

  function playEnter() {
    if (!isMobile()) return;
    var html = document.documentElement;
    html.classList.remove('ao-page-leaving');
    html.classList.add('ao-page-enter');
    html.addEventListener('animationend', function handler() {
      html.classList.remove('ao-page-enter');
      html.removeEventListener('animationend', handler);
    });
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
