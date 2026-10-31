'use client';

import { useEffect, useRef } from 'react';

/**
 * Runs `tick` every `ms` while the page is visible (and once when it becomes visible again). Private chat uses
 * this instead of a live connection: a few light requests while it is open, nothing at all while it is hidden.
 */
export function usePoll(tick: () => void, ms: number, enabled = true): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    const id = window.setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', run);
    };
  }, [ms, enabled]);
}
