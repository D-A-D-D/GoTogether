// App-shell service worker. Deliberately narrow: it never touches the API.
//
// History worth knowing: the first version cache-first'd *every* GET. The
// API lives on a different origin with paths like /users/me and
// /trips/discover, so its `/api` exemption never matched anything — every
// API read would have been cached forever and served stale. This version
// ignores cross-origin requests outright and only handles three same-origin
// cases, each with the strategy that's actually safe for it.

const CACHE_NAME = 'gotogether-shell-v3';
const SHELL_ASSETS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // The API (and anything else cross-origin) must always hit the network.
  if (url.origin !== self.location.origin) return;

  // Content-hashed build output and icons never change under the same URL,
  // so cache-first can't go stale. (Only true for production builds — dev
  // chunk names aren't unique per change, which is why the worker is only
  // registered in production; see register-service-worker.tsx.)
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Page loads: network first so a deploy shows up immediately; the cached
  // shell is only the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
  }
  // Everything else: untouched.
});
