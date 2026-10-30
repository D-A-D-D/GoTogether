// A small "stale-while-revalidate" cache, with no React in it so it can be tested.
//
// The point is how navigation feels. A screen that was shown a moment ago should appear at once
// when you come back to it (or press Back), with a quiet refresh underneath, rather than blank
// and spinning while the same request runs again. And a request already under way is joined, not
// repeated: two components asking for the same thing cost one round trip.

export interface Entry<T = unknown> {
  data: T | undefined;
  error: Error | null;
  /** When `data` last arrived; 0 if never. */
  updatedAt: number;
  /** A request for this key is running. */
  fetching: boolean;
}

const EMPTY: Entry = Object.freeze({ data: undefined, error: null, updatedAt: 0, fetching: false });

export class QueryCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  private listeners = new Map<string, Set<() => void>>();
  /** Bumped by clear(), so an answer that arrives after a sign-out is thrown away, not cached. */
  private epoch = 0;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The current entry for a key. The same object is returned until it changes, as React's store hooks need. */
  get<T>(key: string): Entry<T> {
    return (this.entries.get(key) as Entry<T> | undefined) ?? (EMPTY as Entry<T>);
  }

  isFresh(key: string, staleMs: number): boolean {
    const entry = this.entries.get(key);
    return !!entry && entry.updatedAt > 0 && this.now() - entry.updatedAt < staleMs;
  }

  private put<T>(key: string, patch: Partial<Entry<T>>): void {
    this.entries.set(key, { ...this.get<T>(key), ...patch });
    this.listeners.get(key)?.forEach((notify) => notify());
  }

  /**
   * Fetches a key, joining a request already under way. Earlier data stays in place while it runs,
   * and stays if it fails (with the error recorded alongside): showing old data beats showing nothing.
   */
  fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;

    const epoch = this.epoch;
    this.put<T>(key, { fetching: true });
    const promise = fetcher().then(
      (data) => {
        if (epoch === this.epoch) this.put<T>(key, { data, error: null, updatedAt: this.now(), fetching: false });
        return data;
      },
      (error: unknown) => {
        if (epoch === this.epoch) {
          this.put<T>(key, { error: error instanceof Error ? error : new Error(String(error)), fetching: false });
        }
        throw error;
      },
    );
    this.inflight.set(key, promise);
    const done = () => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    };
    promise.then(done, done);
    return promise;
  }

  /** Replaces the cached data directly - for an update the caller already knows the result of. */
  set<T>(key: string, data: T): void {
    this.put<T>(key, { data, error: null, updatedAt: this.now() });
  }

  /**
   * Marks everything whose key starts with `prefix` as out of date, so it is fetched again next time
   * it is wanted, without wiping what is on screen meanwhile. Call after a change that makes it wrong.
   */
  invalidate(prefix = ''): void {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix) && entry.updatedAt !== 0) {
        this.put(key, { updatedAt: 0 });
      }
    }
  }

  /** Forgets everything. For sign-out and for a different person signing in: one person's data must never show for another's. */
  clear(): void {
    this.epoch++;
    this.entries.clear();
    this.inflight.clear();
    for (const listeners of this.listeners.values()) listeners.forEach((notify) => notify());
  }

  subscribe(key: string, notify: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(notify);
    return () => {
      set.delete(notify);
      if (set.size === 0) this.listeners.delete(key);
    };
  }
}
