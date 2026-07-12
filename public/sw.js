/* ArgueOut Service Worker */
const CACHE = 'argueout-v10';
const OFFLINE_URL = '/offline.html';

// -- Push notifications (Firebase Cloud Messaging) ------------------------
// Merged into this same SW file (rather than a separate firebase-messaging-sw.js)
// because only one service worker can control the root scope at a time —
// registering a second one at the same scope would silently take over from
// the caching worker above instead of running alongside it.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyBFhRtNAEIg_iXwNEHCe9-ppPTQWTcn6hs',
  authDomain:        'argueout.firebaseapp.com',
  projectId:         'argueout',
  storageBucket:     'argueout.firebasestorage.app',
  messagingSenderId: '666299079183',
  appId:             '1:666299079183:web:0af715ed65d25c9290e17a'
});

const messaging = firebase.messaging();

// Fires when a push arrives while no ArgueOut tab has focus (backgrounded or closed).
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'ArgueOut';
  const body  = payload.notification?.body  || '';
  self.registration.showNotification(title, {
    body,
    icon: '/favicon.ico',
    data: payload.data || {}
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.link || '/lobby';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

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

  // Navigation requests (page loads): stale-while-revalidate.
  // Serve cached HTML immediately if available so the app opens instantly
  // even when the Render.com free-tier server is in a cold-start (30-60s).
  // The network fetch runs in the background to refresh the cache.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request)
            .then(res => {
              if (res.ok) cache.put(e.request, res.clone());
              return res;
            })
            .catch(() => cached || caches.match(OFFLINE_URL));
          // Serve stale cache immediately; refresh silently in background.
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // All other GET requests (JS, CSS, images): network-first with cache fallback.
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
