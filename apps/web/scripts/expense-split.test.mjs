// Tests for src/app/trips/[id]/expenses/expense-split.ts: how a split is divided,
// and how an existing expense becomes the edit form's starting state.
// Run with `npm run test --workspace apps/web`. Imports the TypeScript source
// directly — Node strips the type annotations.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formMembers, splitEqually, stateFromExpense } from '../src/app/trips/[id]/expenses/expense-split.ts';

const user = (id) => ({ id, name: `User ${id}`, trustScore: 50 });
const member = (id) => ({ id: `m-${id}`, userId: id, role: 'MEMBER', user: user(id) });

function expense({ paidById = 'alice', amount = 100, category = null, shares }) {
  return {
    id: 'e1',
    tripId: 't1',
    paidById,
    createdById: 'alice',
    description: 'Dinner',
    amount,
    category,
    createdAt: '2026-10-20T10:00:00.000Z',
    paidBy: user(paidById),
    canChange: true,
    splits: Object.entries(shares).map(([userId, share]) => ({
      id: `s-${userId}`,
      expenseId: 'e1',
      userId,
      amount: share,
      settled: false,
      settledAt: null,
      user: user(userId),
    })),
  };
}

describe('splitEqually', () => {
  it('divides evenly when it can', () => {
    assert.deepEqual(splitEqually(90, 3), [30, 30, 30]);
  });

  it('hands the remainder out one unit at a time to the first people', () => {
    assert.deepEqual(splitEqually(100, 3), [34, 33, 33]);
    assert.deepEqual(splitEqually(101, 3), [34, 34, 33]);
  });

  it('always adds back up to the total', () => {
    for (const [total, count] of [[7, 3], [1000, 7], [5, 5], [13, 2]]) {
      assert.equal(splitEqually(total, count).reduce((a, b) => a + b, 0), total);
    }
  });
});

describe('formMembers', () => {
  it('is just the current members when everyone on the expense is still on the trip', () => {
    const approved = [member('alice'), member('bob')];
    const e = expense({ shares: { alice: 50, bob: 50 } });
    assert.deepEqual(formMembers(e, approved).map((m) => m.userId), ['alice', 'bob']);
  });

  it('adds someone who has since left, marked as having left', () => {
    const approved = [member('alice')];
    const e = expense({ shares: { alice: 50, bob: 50 } });
    const members = formMembers(e, approved);
    assert.deepEqual(members.map((m) => m.userId), ['alice', 'bob']);
    assert.equal(members[1].left, true);
    assert.equal(members[1].user.name, 'User bob');
    assert.equal(members[0].left, undefined);
  });

  it('includes a payer who has left even though they have no share', () => {
    const e = expense({ paidById: 'zed', shares: { alice: 100 } });
    assert.deepEqual(formMembers(e, [member('alice')]).map((m) => m.userId), ['alice', 'zed']);
  });

  it('lists a departed person once, however many ways they appear', () => {
    const e = expense({ paidById: 'bob', shares: { alice: 50, bob: 50 } });
    assert.deepEqual(formMembers(e, [member('alice')]).map((m) => m.userId), ['alice', 'bob']);
  });
});

describe('stateFromExpense', () => {
  const members = [member('alice'), member('bob'), member('carol')];

  it('opens an equal split in equal mode', () => {
    const state = stateFromExpense(expense({ amount: 100, shares: { alice: 34, bob: 33, carol: 33 } }), members);
    assert.equal(state.custom, false);
    assert.deepEqual(state.included, ['alice', 'bob', 'carol']);
    assert.deepEqual(state.customText, {});
  });

  it('opens an uneven split in manual mode with the stored amounts', () => {
    const state = stateFromExpense(expense({ amount: 100, shares: { alice: 20, bob: 80 } }), members);
    assert.equal(state.custom, true);
    assert.deepEqual(state.included, ['alice', 'bob']);
    assert.deepEqual(state.customText, { alice: '20', bob: '80' });
  });

  it('treats a remainder handed to someone other than the first as manual, so nothing is silently re-divided', () => {
    // Equal would be 34/33/33 in this order; this has the extra unit on carol.
    const state = stateFromExpense(expense({ amount: 100, shares: { alice: 33, bob: 33, carol: 34 } }), members);
    assert.equal(state.custom, true);
    assert.deepEqual(state.customText, { alice: '33', bob: '33', carol: '34' });
  });

  it('includes only the people with a share, in the form\'s order', () => {
    const state = stateFromExpense(expense({ amount: 90, shares: { carol: 45, alice: 45 } }), members);
    assert.deepEqual(state.included, ['alice', 'carol']);
    assert.equal(state.custom, false);
  });

  it('carries over the description, amount, category and payer', () => {
    const state = stateFromExpense(expense({ paidById: 'bob', amount: 60, category: 'Food', shares: { alice: 30, bob: 30 } }), members);
    assert.equal(state.description, 'Dinner');
    assert.equal(state.amountText, '60');
    assert.equal(state.category, 'Food');
    assert.equal(state.paidById, 'bob');
  });

  it('leaves the category empty when there is none', () => {
    assert.equal(stateFromExpense(expense({ shares: { alice: 100 } }), members).category, '');
  });

  it('keeps someone who has left on the expense', () => {
    const e = expense({ amount: 100, shares: { alice: 50, bob: 50 } });
    const withLeaver = formMembers(e, [member('alice'), member('carol')]);
    const state = stateFromExpense(e, withLeaver);
    assert.deepEqual(state.included, ['alice', 'bob']);
    assert.equal(state.custom, false);
  });
});
