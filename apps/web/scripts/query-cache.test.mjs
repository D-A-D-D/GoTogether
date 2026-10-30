// Tests for src/lib/query-cache.ts. Run with `npm run test --workspace apps/web`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryCache } from '../src/lib/query-cache.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe('QueryCache.fetch', () => {
  it('stores what the fetcher returns, and says it has been fetched', async () => {
    const cache = new QueryCache(() => 1000);
    assert.equal(cache.get('a').data, undefined);
    await cache.fetch('a', async () => 'hello');
    const entry = cache.get('a');
    assert.equal(entry.data, 'hello');
    assert.equal(entry.updatedAt, 1000);
    assert.equal(entry.fetching, false);
    assert.equal(entry.error, null);
  });

  it('joins a request already under way instead of repeating it', async () => {
    const cache = new QueryCache();
    const d = deferred();
    let calls = 0;
    const fetcher = () => (calls++, d.promise);
    const first = cache.fetch('a', fetcher);
    const second = cache.fetch('a', fetcher);
    d.resolve(42);
    assert.deepEqual(await Promise.all([first, second]), [42, 42]);
    assert.equal(calls, 1);
  });

  it('can be fetched again once the first request is done', async () => {
    const cache = new QueryCache();
    let calls = 0;
    await cache.fetch('a', async () => ++calls);
    await cache.fetch('a', async () => ++calls);
    assert.equal(cache.get('a').data, 2);
  });

  it('marks the entry as fetching while the request runs', async () => {
    const cache = new QueryCache();
    const d = deferred();
    const p = cache.fetch('a', () => d.promise);
    assert.equal(cache.get('a').fetching, true);
    d.resolve(1);
    await p;
    assert.equal(cache.get('a').fetching, false);
  });

  it('keeps the earlier data when a refresh fails, and records the error', async () => {
    const cache = new QueryCache();
    await cache.fetch('a', async () => 'old');
    await assert.rejects(cache.fetch('a', async () => Promise.reject(new Error('boom'))), /boom/);
    const entry = cache.get('a');
    assert.equal(entry.data, 'old');
    assert.equal(entry.error.message, 'boom');
    assert.equal(entry.fetching, false);
  });

  it('wraps a thrown non-error so the entry always holds an Error', async () => {
    const cache = new QueryCache();
    await assert.rejects(cache.fetch('a', () => Promise.reject('plain string')));
    assert.ok(cache.get('a').error instanceof Error);
  });

  it('clears an old error after a successful fetch', async () => {
    const cache = new QueryCache();
    await assert.rejects(cache.fetch('a', () => Promise.reject(new Error('x'))));
    await cache.fetch('a', async () => 'fine');
    assert.equal(cache.get('a').error, null);
  });
});

describe('QueryCache freshness', () => {
  it('is fresh for the stale window and stale after it', async () => {
    let t = 0;
    const cache = new QueryCache(() => t);
    t = 100;
    await cache.fetch('a', async () => 1);
    t = 129;
    assert.equal(cache.isFresh('a', 30), true);
    t = 130;
    assert.equal(cache.isFresh('a', 30), false);
  });

  it('is never fresh for a key that has not been fetched', () => {
    assert.equal(new QueryCache().isFresh('nope', 1_000_000), false);
  });

  it('invalidate keeps the data to show but makes it stale', async () => {
    const cache = new QueryCache(() => 5);
    await cache.fetch('trip:1', async () => 'x');
    cache.invalidate('trip:');
    assert.equal(cache.get('trip:1').data, 'x');
    assert.equal(cache.isFresh('trip:1', 1_000_000), false);
  });

  it('invalidate only touches keys with the prefix', async () => {
    const cache = new QueryCache(() => 5);
    await cache.fetch('trip:1', async () => 'x');
    await cache.fetch('mine', async () => 'y');
    cache.invalidate('trip:');
    assert.equal(cache.isFresh('mine', 1_000_000), true);
  });

  it('invalidate with no prefix makes everything stale', async () => {
    const cache = new QueryCache(() => 5);
    await cache.fetch('a', async () => 1);
    await cache.fetch('b', async () => 2);
    cache.invalidate();
    assert.equal(cache.isFresh('a', 1_000_000) || cache.isFresh('b', 1_000_000), false);
  });
});

describe('QueryCache.set and clear', () => {
  it('set stores data as if it had been fetched', () => {
    const cache = new QueryCache(() => 77);
    cache.set('a', 'direct');
    assert.equal(cache.get('a').data, 'direct');
    assert.equal(cache.isFresh('a', 10), true);
  });

  it('clear forgets everything', async () => {
    const cache = new QueryCache();
    await cache.fetch('a', async () => 1);
    cache.clear();
    assert.equal(cache.get('a').data, undefined);
  });

  it('an answer that arrives after clear is thrown away, never cached for the next person', async () => {
    const cache = new QueryCache();
    const d = deferred();
    const p = cache.fetch('me', () => d.promise);
    cache.clear(); // signed out while the request was in flight
    d.resolve('the previous person');
    await p;
    assert.equal(cache.get('me').data, undefined);
  });

  it('a request started after clear is not joined to one from before it', async () => {
    const cache = new QueryCache();
    const old = deferred();
    cache.fetch('me', () => old.promise);
    cache.clear();
    await cache.fetch('me', async () => 'new person');
    assert.equal(cache.get('me').data, 'new person');
  });
});

describe('QueryCache.subscribe', () => {
  it('tells subscribers when their key changes, and not for other keys', async () => {
    const cache = new QueryCache();
    let a = 0;
    let b = 0;
    cache.subscribe('a', () => a++);
    cache.subscribe('b', () => b++);
    await cache.fetch('a', async () => 1);
    assert.ok(a >= 2, 'start and finish');
    assert.equal(b, 0);
  });

  it('stops telling a subscriber that has left', async () => {
    const cache = new QueryCache();
    let n = 0;
    const off = cache.subscribe('a', () => n++);
    off();
    await cache.fetch('a', async () => 1);
    assert.equal(n, 0);
  });

  it('returns the same entry object until something changes, as React store hooks require', async () => {
    const cache = new QueryCache();
    await cache.fetch('a', async () => 1);
    assert.equal(cache.get('a'), cache.get('a'));
    assert.equal(cache.get('missing'), cache.get('missing'));
  });

  it('tells every subscriber on clear', () => {
    const cache = new QueryCache();
    let n = 0;
    cache.subscribe('a', () => n++);
    cache.subscribe('b', () => n++);
    cache.clear();
    assert.equal(n, 2);
  });
});
