// Tests for src/lib/chat-layout.ts. Run with `npm run test --workspace apps/web`.
// (chat-layout imports format via an alias, so it is exercised through a tiny loader below -
// built from file URLs, so it behaves the same on Windows and Linux.)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// Load the module with its '@/lib/format' alias pointed at the real file.
const dir = new URL('../src/lib/', import.meta.url);
const source = stripTypeScriptTypes(readFileSync(new URL('chat-layout.ts', dir), 'utf8')).replace(
  "from '@/lib/format'",
  `from '${new URL('format.ts', dir).href}'`,
);
const { layoutChat, placeReaders, CLUSTER_GAP_MS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).toISOString();
const msg = (id, senderId, createdAt) => ({ id, senderId, createdAt });
const NOW = new Date(2027, 5, 15, 18, 0);
const kinds = (items) => items.map((i) => (i.kind === 'day' ? `day:${i.label}` : i.key));

describe('layoutChat', () => {
  it('puts a day divider before the first message', () => {
    const items = layoutChat([msg('a', 'u1', at(2027, 5, 15, 9, 0))], NOW);
    assert.deepEqual(kinds(items), ['day:Today', 'a']);
  });

  it('adds a divider when the day changes, and says Yesterday', () => {
    const items = layoutChat([msg('a', 'u1', at(2027, 5, 14, 23, 50)), msg('b', 'u1', at(2027, 5, 15, 0, 5))], NOW);
    assert.deepEqual(kinds(items), ['day:Yesterday', 'a', 'day:Today', 'b']);
  });

  it('makes one cluster of messages from one person close together', () => {
    const items = layoutChat(
      [msg('a', 'u1', at(2027, 5, 15, 9, 0)), msg('b', 'u1', at(2027, 5, 15, 9, 1)), msg('c', 'u1', at(2027, 5, 15, 9, 2))],
      NOW,
    ).filter((i) => i.kind === 'message');
    assert.deepEqual(items.map((i) => [i.first, i.last]), [[true, false], [false, false], [false, true]]);
  });

  it('starts a new cluster when the sender changes', () => {
    const items = layoutChat([msg('a', 'u1', at(2027, 5, 15, 9, 0)), msg('b', 'u2', at(2027, 5, 15, 9, 1))], NOW).filter((i) => i.kind === 'message');
    assert.deepEqual(items.map((i) => [i.first, i.last]), [[true, true], [true, true]]);
  });

  it('starts a new cluster after a long pause, but not at exactly the limit', () => {
    const base = new Date(2027, 5, 15, 9, 0).getTime();
    const iso = (ms) => new Date(base + ms).toISOString();
    const atLimit = layoutChat([msg('a', 'u1', iso(0)), msg('b', 'u1', iso(CLUSTER_GAP_MS))], NOW).filter((i) => i.kind === 'message');
    assert.equal(atLimit[1].first, false);
    const over = layoutChat([msg('a', 'u1', iso(0)), msg('b', 'u1', iso(CLUSTER_GAP_MS + 1000))], NOW).filter((i) => i.kind === 'message');
    assert.equal(over[1].first, true);
    assert.equal(over[0].last, true);
  });

  it('never joins a cluster across midnight, even a minute apart', () => {
    const items = layoutChat([msg('a', 'u1', at(2027, 5, 14, 23, 59)), msg('b', 'u1', at(2027, 5, 15, 0, 0))], NOW).filter((i) => i.kind === 'message');
    assert.deepEqual(items.map((i) => [i.first, i.last]), [[true, true], [true, true]]);
  });

  it('handles an empty conversation and a single message', () => {
    assert.deepEqual(layoutChat([], NOW), []);
    const [, only] = layoutChat([msg('a', 'u1', at(2027, 5, 15, 9, 0))], NOW);
    assert.deepEqual([only.first, only.last], [true, true]);
  });

  it('keeps every message, in order', () => {
    const input = [msg('a', 'u1', at(2027, 5, 13, 9, 0)), msg('b', 'u2', at(2027, 5, 14, 9, 0)), msg('c', 'u1', at(2027, 5, 15, 9, 0))];
    const ids = layoutChat(input, NOW).filter((i) => i.kind === 'message').map((i) => i.key);
    assert.deepEqual(ids, ['a', 'b', 'c']);
  });
});

describe('placeReaders', () => {
  const m = (id, senderId, minute) => msg(id, senderId, at(2027, 5, 15, 9, minute));
  const thread = [m('a', 'u1', 0), m('b', 'u2', 1), m('c', 'u1', 2), m('d', 'u2', 3)];

  it('puts a reader under the newest message they have read', () => {
    const placed = placeReaders(thread, [{ userId: 'u3', at: at(2027, 5, 15, 9, 2) }]);
    assert.deepEqual([...placed], [['c', ['u3']]]);
  });

  it('puts someone who has read everything under the last message', () => {
    assert.deepEqual([...placeReaders(thread, [{ userId: 'u3', at: at(2027, 5, 15, 9, 3) }])], [['d', ['u3']]]);
  });

  it('is exact at the boundary: a message sent at the very moment counts as read', () => {
    assert.deepEqual([...placeReaders(thread, [{ userId: 'u3', at: at(2027, 5, 15, 9, 1) }])], [['b', ['u3']]]);
  });

  it('does not put someone under a message they wrote themselves, but the newest by someone else', () => {
    // u2 has read up to d (their own): their marker belongs under c, the newest message by anybody else
    assert.deepEqual([...placeReaders(thread, [{ userId: 'u2', at: at(2027, 5, 15, 9, 3) }])], [['c', ['u2']]]);
  });

  it('groups several readers under the same message, in the order given', () => {
    const placed = placeReaders(thread, [
      { userId: 'u3', at: at(2027, 5, 15, 9, 3) },
      { userId: 'u4', at: at(2027, 5, 15, 9, 3) },
    ]);
    assert.deepEqual(placed.get('d'), ['u3', 'u4']);
  });

  it('shows nothing for someone who has read nothing that is loaded', () => {
    assert.equal(placeReaders(thread, [{ userId: 'u3', at: at(2027, 5, 15, 8, 0) }]).size, 0);
  });

  it('ignores a marker with a broken time, and copes with no messages and no readers', () => {
    assert.equal(placeReaders(thread, [{ userId: 'u3', at: 'not a date' }]).size, 0);
    assert.equal(placeReaders([], [{ userId: 'u3', at: at(2027, 5, 15, 9, 3) }]).size, 0);
    assert.equal(placeReaders(thread, []).size, 0);
  });

  it('finds a place from the time alone, so it works when the message they read is older than what is loaded', () => {
    const recent = [m('c', 'u1', 2), m('d', 'u2', 3)];
    assert.deepEqual([...placeReaders(recent, [{ userId: 'u3', at: at(2027, 5, 15, 9, 3) }])], [['d', ['u3']]]);
  });
});
