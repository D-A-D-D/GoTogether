'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { QueryCache, type Entry } from '@/lib/query-cache';

/** One cache for the whole app. Cleared on sign-in and sign-out (see auth-context). */
export const queryCache = new QueryCache();

const NOTHING: Entry = Object.freeze({ data: undefined, error: null, updatedAt: 0, fetching: false });
const noop = () => undefined;

interface Options {
  /** How long cached data counts as fresh, in ms: within it, coming back to a screen makes no request. */
  staleMs?: number;
  /** Set false to wait (for instance until someone is signed in). */
  enabled?: boolean;
}

export interface QueryResult<T> {
  /** What is known: the last answer, even if a newer one is on its way. */
  data: T | undefined;
  error: Error | null;
  /** Nothing to show yet - show a skeleton. False as soon as there is any data, even old. */
  isLoading: boolean;
  /** Old data is on screen while a fresh answer loads. */
  isRefreshing: boolean;
  refetch: () => Promise<void>;
}

/**
 * Data for a screen, remembered across navigation: shown at once if it was seen recently, refreshed
 * quietly if it is getting old, and refreshed again when the person returns to the tab.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, options: Options = {}): QueryResult<T> {
  const { staleMs = 30_000, enabled = true } = options;
  const active = enabled && key !== null;

  const subscribe = useCallback((notify: () => void) => (key ? queryCache.subscribe(key, notify) : noop), [key]);
  const getSnapshot = useCallback(() => (key ? queryCache.get<T>(key) : (NOTHING as Entry<T>)), [key]);
  const entry = useSyncExternalStore(subscribe, getSnapshot, () => NOTHING as Entry<T>);

  // The latest fetcher, without making it a dependency: pages pass a new closure on every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(
    (force: boolean) => {
      if (!key || !enabled) return Promise.resolve();
      if (!force && queryCache.isFresh(key, staleMs)) return Promise.resolve();
      return queryCache.fetch(key, () => fetcherRef.current()).then(noop, noop);
    },
    [key, enabled, staleMs],
  );

  useEffect(() => {
    if (active) void load(false);
  }, [active, load]);

  // Coming back to the tab after a while: bring the screen up to date.
  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [active, load]);

  const refetch = useCallback(() => load(true), [load]);

  return {
    data: entry.data,
    error: entry.error,
    isLoading: active && entry.data === undefined && entry.error === null,
    isRefreshing: entry.fetching && entry.data !== undefined,
    refetch,
  };
}

/**
 * Starts loading something before it is asked for - when a finger or the pointer reaches a link - so
 * that by the time the screen opens, its data is already there or nearly. Never throws.
 */
export function prefetchQuery<T>(key: string, fetcher: () => Promise<T>, staleMs = 30_000): void {
  if (queryCache.isFresh(key, staleMs)) return;
  void queryCache.fetch(key, fetcher).then(noop, noop);
}

/** Marks cached data out of date after a change that made it wrong; it is refetched when next shown. */
export function invalidateQueries(...prefixes: string[]): void {
  for (const prefix of prefixes) queryCache.invalidate(prefix);
}
