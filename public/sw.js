// SparkFlix service worker
// - App shell is pre-cached so the UI opens offline.
// - Same-origin requests are network-first (you always get the latest build when online)
//   with the cache as the offline fallback.
// - Third-party requests (VidSpark embeds, poster images) are left to the browser.
const CACHE_NAME = 'sparkflix-v9';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/ux.css',
  '/party.css',
  '/football.css',
  '/app.js',
  '/party-client.js',
  '/personal.js',
  '/welcome.js',
  '/football-client.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

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
  // Watch Party uses a never-ending event stream: never intercept or cache it
  if (url.pathname.startsWith('/api/party/')) return;
  if (request.headers.get('accept') === 'text/event-stream') return;

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
