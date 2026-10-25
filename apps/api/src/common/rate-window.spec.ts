import { RateWindow } from './rate-window.js';

function windowAt(limit: number, windowMs: number, maxKeys?: number) {
  let t = 1_000_000;
  const window = new RateWindow(limit, windowMs, () => t, maxKeys);
  return { window, advance: (ms: number) => (t += ms) };
}

describe('RateWindow', () => {
  it('starts empty and not full', () => {
    const { window } = windowAt(3, 1000);
    expect(window.count('a')).toBe(0);
    expect(window.isFull('a')).toBe(false);
    expect(window.retryAfterMs('a')).toBe(0);
  });

  it('fills up at exactly the limit', () => {
    const { window } = windowAt(3, 1000);
    window.record('a');
    window.record('a');
    expect(window.isFull('a')).toBe(false);
    window.record('a');
    expect(window.isFull('a')).toBe(true);
    expect(window.count('a')).toBe(3);
  });

  it('counts each key on its own', () => {
    const { window } = windowAt(2, 1000);
    window.record('a');
    window.record('a');
    expect(window.isFull('a')).toBe(true);
    expect(window.isFull('b')).toBe(false);
  });

  it('forgets events once they leave the window', () => {
    const { window, advance } = windowAt(2, 1000);
    window.record('a');
    window.record('a');
    advance(1001);
    expect(window.count('a')).toBe(0);
    expect(window.isFull('a')).toBe(false);
  });

  it('treats an event exactly one window old as expired: it only counts while younger than the window', () => {
    const { window, advance } = windowAt(1, 1000);
    window.record('a');
    advance(999);
    expect(window.isFull('a')).toBe(true);
    advance(1); // now exactly 1000ms old
    expect(window.isFull('a')).toBe(false);
  });

  it('slides rather than resetting: only the oldest events drop out', () => {
    const { window, advance } = windowAt(2, 1000);
    window.record('a'); // t0
    advance(600);
    window.record('a'); // t0+600
    advance(500); // t0+1100: the first has left, the second has not
    expect(window.count('a')).toBe(1);
    expect(window.isFull('a')).toBe(false);
  });

  it('says how long until there is room: when the event that blocks it leaves the window', () => {
    const { window, advance } = windowAt(2, 1000);
    window.record('a'); // t0
    advance(300);
    window.record('a'); // t0+300 -> full
    advance(100); // now t0+400
    expect(window.retryAfterMs('a')).toBe(600); // the t0 event leaves at t0+1000
  });

  it('counts the retry from the right event once over the limit', () => {
    const { window, advance } = windowAt(2, 1000);
    window.record('a'); // t0
    advance(100);
    window.record('a'); // t0+100
    advance(100);
    window.record('a'); // t0+200: three events, limit two
    // Room for one more appears when only one is left: the t0+100 event leaves at t0+1100.
    expect(window.retryAfterMs('a')).toBe(1100 - 200);
  });

  it('clear forgets a key at once', () => {
    const { window } = windowAt(1, 1000);
    window.record('a');
    window.clear('a');
    expect(window.isFull('a')).toBe(false);
    expect(window.count('a')).toBe(0);
  });

  it('keeps memory bounded: expired keys go first when there are too many', () => {
    const { window, advance } = windowAt(5, 1000, 3);
    window.record('old1');
    window.record('old2');
    advance(2000); // both expired
    window.record('new1');
    window.record('new2');
    window.record('new3'); // 5 keys > 3: the expired two are pruned
    expect(window.count('new1')).toBe(1);
    expect(window.count('new3')).toBe(1);
  });

  it('keeps memory bounded even when nothing has expired, by dropping the oldest keys', () => {
    const { window } = windowAt(5, 1_000_000, 3);
    for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) window.record(key);
    const kept = ['k1', 'k2', 'k3', 'k4', 'k5'].filter((k) => window.count(k) > 0);
    expect(kept.length).toBeLessThanOrEqual(3);
    expect(kept).toContain('k5'); // the newest survives
  });
});
