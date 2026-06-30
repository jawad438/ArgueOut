/* ArgueOut Service Worker */
const CACHE = 'argueout-v3';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(OFFLINE_URL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never intercept: Socket.io, API endpoints, Firebase, external CDNs
  if (
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/api') ||
    url.hostname !== self.location.hostname
  ) return;

  if (e.request.method !== 'GET') return;

  // Network-first: always try network, fall back to cache, then to the
  // offline page for full-page navigations (so a dead connection shows a
  // proper screen instead of the browser's built-in dino/error page).
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') return caches.match(OFFLINE_URL);
      }))
  );
});
