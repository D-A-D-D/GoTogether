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

// ---- Push notifications ----
//
// The API sends JSON `{ title, body, url? }` (apps/api notifications.service).
// `url` arrives over the wire, so it is only ever resolved against our own
// origin: a push can open a page in this app, never send someone elsewhere.

function safeTargetUrl(raw) {
  const home = `${self.location.origin}/`;
  try {
    const target = new URL(typeof raw === 'string' ? raw : '/', self.location.origin);
    return target.origin === self.location.origin ? target.href : home;
  } catch {
    return home;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'GoTogether';
  const target = safeTargetUrl(payload.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      icon: '/icons/icon-192.png',
      // One notification per destination (a trip's chat, say) rather than a
      // growing stack: a newer one replaces the last and still alerts.
      tag: target,
      renotify: true,
      data: { url: target },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTargetUrl(event.notification.data && event.notification.data.url);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((w) => w.url.startsWith(self.location.origin));
      if (existing) {
        await existing.focus();
        // navigate() can reject (e.g. a client we don't control) — fall through to a new window.
        try {
          await existing.navigate(target);
          return;
        } catch {
          // fall through
        }
      }
      await self.clients.openWindow(target);
    }),
  );
});
