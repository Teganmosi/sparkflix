// SparkFlix service worker
// - App shell is pre-cached so the UI opens offline.
// - Same-origin requests are network-first (you always get the latest build when online)
//   with the cache as the offline fallback.
// - Third-party requests (VidSpark embeds, poster images) are left to the browser.
const CACHE_NAME = 'sparkflix-v4';
const APP_SHELL = ['/', '/index.html', '/styles.css', '/ux.css', '/app.js', '/manifest.json', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/live/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Offline navigation to any route → serve the app shell
        if (request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      })
  );
});
