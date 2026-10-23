// Tests for src/lib/push-sync-policy.ts: what happens to a device's push
// subscription when someone logs in. Run with `npm run test --workspace apps/web`.
// Imports the TypeScript source directly — Node strips the type annotations.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RESYNC_AFTER_MS, decidePushSync } from '../src/lib/push-sync-policy.ts';

const NOW = 1_800_000_000_000;
const alice = (syncedAt = NOW) => ({ userId: 'alice', syncedAt });

function decide(overrides) {
  return decidePushSync({
    owner: null,
    userId: 'alice',
    hasSubscription: false,
    permission: 'granted',
    now: NOW,
    ...overrides,
  });
}

describe('a different account logs in', () => {
  it("drops the previous owner's subscription and forgets the owner", () => {
    const d = decide({ owner: alice(), userId: 'bob', hasSubscription: true });
    assert.deepEqual(d, { action: 'drop-subscription', clearOwner: true });
  });

  it("forgets the owner even when there's no subscription left to drop", () => {
    const d = decide({ owner: alice(), userId: 'bob', hasSubscription: false });
    assert.deepEqual(d, { action: 'nothing', clearOwner: true });
  });

  it("does not restore the previous owner's opt-in for the new user", () => {
    const d = decide({ owner: alice(), userId: 'bob', hasSubscription: false, permission: 'granted' });
    assert.notEqual(d.action, 'restore-subscription');
  });
});

describe('no owner recorded', () => {
  it('drops a subscription of unknown origin rather than delivering it to this user', () => {
    const d = decide({ owner: null, hasSubscription: true });
    assert.deepEqual(d, { action: 'drop-subscription', clearOwner: false });
  });

  it('does nothing when there is no subscription either', () => {
    assert.deepEqual(decide({ owner: null, hasSubscription: false }), { action: 'nothing', clearOwner: false });
  });
});

describe('the owner logs in again', () => {
  it('leaves a recently saved subscription alone', () => {
    const d = decide({ owner: alice(NOW - 60_000), hasSubscription: true });
    assert.deepEqual(d, { action: 'nothing', clearOwner: false });
  });

  it('re-saves one the server may have forgotten', () => {
    const d = decide({ owner: alice(NOW - RESYNC_AFTER_MS - 1), hasSubscription: true });
    assert.deepEqual(d, { action: 'resave-subscription', clearOwner: false });
  });

  it('treats exactly the resync interval as still fresh', () => {
    const d = decide({ owner: alice(NOW - RESYNC_AFTER_MS), hasSubscription: true });
    assert.equal(d.action, 'nothing');
  });

  it('quietly restores a subscription that logout removed, when permission is still granted', () => {
    const d = decide({ owner: alice(), hasSubscription: false, permission: 'granted' });
    assert.deepEqual(d, { action: 'restore-subscription', clearOwner: false });
  });

  it('does not try to restore once permission has been revoked', () => {
    assert.equal(decide({ owner: alice(), hasSubscription: false, permission: 'denied' }).action, 'nothing');
  });

  it('does not try to restore when permission was never granted', () => {
    assert.equal(decide({ owner: alice(), hasSubscription: false, permission: 'default' }).action, 'nothing');
  });

  it('keeps the owner record in every case', () => {
    for (const hasSubscription of [true, false]) {
      for (const permission of ['granted', 'denied', 'default']) {
        assert.equal(decide({ owner: alice(), hasSubscription, permission }).clearOwner, false);
      }
    }
  });
});
