'use client';

import { useEffect } from 'react';

// Production only. A cache-first worker in dev serves stale chunks across
// rebuilds and server restarts — it caused three separate confusing
// failures while testing — and there's nothing to gain from offline support
// while developing. In dev this also tears down any worker (and its caches)
// that an earlier session registered, so stale state heals itself.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
      void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)));
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  }, []);

  return null;
}
