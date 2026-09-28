// Minimal app-shell service worker (Phase 0 — see docs/ROADMAP.md).
// Caches the static shell so the app opens offline; everything else
// (API calls, chat, etc.) is deliberately left to hit the network as
// those pieces get built — this is installability + a shell cache, not
// a full offline strategy yet.

// Bump this whenever a shell asset changes (manifest fields, icons, the
// root page markup) — cache-first means a returning visitor keeps seeing
// whatever was cached under the OLD name until `activate` clears it below;
// a content change with no version bump is invisible to them. Found this
// firsthand while testing manifest changes against an already-registered
// SW in this same session — the server was serving the new file the whole
// time, the browser's Cache Storage just never asked it for a fresh copy.
const CACHE_NAME = 'gotogether-shell-v2';
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
  // Never cache API responses — those need to stay live.
  if (url.pathname.startsWith('/api')) return;

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
});
