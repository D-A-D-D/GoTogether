/**
 * Counts events per key over a sliding window, in memory. Used where a limit
 * has to be per person rather than per IP address: failed sign-ins per account,
 * chat messages per user. Single-process by design - with more than one API
 * instance each would count separately (docs/IDEAS.md, "Abuse protection").
 *
 * The clock is injectable so tests don't have to wait.
 */
export class RateWindow {
  private readonly events = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    /** A cap on distinct keys, so a flood of one-off keys can't grow memory without bound. */
    private readonly maxKeys = 10_000,
  ) {}

  /** The timestamps still inside the window, oldest first. */
  private live(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.events.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length === 0) this.events.delete(key);
    else this.events.set(key, recent);
    return recent;
  }

  count(key: string): number {
    return this.live(key).length;
  }

  /** True once the key has used up its allowance for the current window. */
  isFull(key: string): boolean {
    return this.count(key) >= this.limit;
  }

  record(key: string): void {
    const recent = this.live(key);
    recent.push(this.now());
    this.events.set(key, recent);
    if (this.events.size > this.maxKeys) this.prune();
  }

  /** Milliseconds until the key has room again; 0 if it already does. */
  retryAfterMs(key: string): number {
    const recent = this.live(key);
    if (recent.length < this.limit) return 0;
    // Room appears when the event that is `limit` places from the newest leaves the window.
    return Math.max(0, recent[recent.length - this.limit] + this.windowMs - this.now());
  }

  clear(key: string): void {
    this.events.delete(key);
  }

  /** Drops keys with nothing left in the window; if that isn't enough, the oldest keys. */
  private prune(): void {
    for (const key of this.events.keys()) this.live(key);
    for (const key of this.events.keys()) {
      if (this.events.size <= this.maxKeys) break;
      this.events.delete(key);
    }
  }
}
