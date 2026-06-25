/* ArgueOut Service Worker */
const CACHE = 'argueout-v2';

self.addEventListener('install', () => self.skipWaiting());
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

  // Network-first: always try network, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
