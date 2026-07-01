/* instant-nav.js — makes link navigation feel instant.

   This does NOT intercept clicks or fake a page swap — links still do a
   normal full-page browser navigation. Instead, the moment the user shows
   intent to follow a link (finger/mouse down, or hover on desktop), we
   fetch() that destination page in the background. The response gets
   stored by sw.js (every same-origin GET passes through its fetch handler
   and is cached), so by the time the actual navigation happens a few
   hundred ms later, sw.js's stale-while-revalidate logic finds it already
   cached and serves it immediately instead of waiting on the network.

   Combined with the skeleton placeholders already baked into each page's
   HTML (the .skel shimmer elements), this is what makes navigation feel
   instant: the browser paints the new page's skeleton right away, then real
   data streams in and replaces it as Firebase/Socket.io calls resolve. */
(function () {
  // Respect data-saver mode / very slow connections: prefetching would
  // waste the user's data budget without a visible speed benefit.
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return;

  var prefetched = Object.create(null);

  function prefetch(url) {
    if (prefetched[url]) return;
    prefetched[url] = true;
    fetch(url, { credentials: 'same-origin' }).catch(function () {});
  }

  function destinationOf(target) {
    var a = target.closest && target.closest('a[href]');
    if (!a) return null;
    if (a.target && a.target !== '' && a.target !== '_self') return null;
    if (a.hasAttribute('download')) return null;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(javascript:|mailto:|tel:)/i.test(href)) return null;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    if (url.href.split('#')[0] === location.href.split('#')[0]) return null;
    return url.href;
  }

  function onIntent(e) {
    var url = destinationOf(e.target);
    if (url) prefetch(url);
  }

  // Desktop: warm the cache on hover, well before the click.
  document.addEventListener('pointerover', onIntent, { passive: true });
  // Mobile: touchstart fires as soon as the finger lands, before the tap
  // completes and before the click/navigation — a real head start.
  document.addEventListener('touchstart', onIntent, { passive: true });
  // Fallback for any pointer type where the above didn't already catch it.
  document.addEventListener('pointerdown', onIntent, { passive: true });
})();
