// Tests for src/lib/travel-history.ts. Run with `npm run test --workspace apps/web`.
// (It imports format via an alias, so it is exercised through the same tiny loader as the chat layout test.)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const dir = new URL('../src/lib/', import.meta.url);
const source = stripTypeScriptTypes(readFileSync(new URL('travel-history.ts', dir), 'utf8')).replace(
  "from '@/lib/format'",
  `from '${new URL('format.ts', dir).href}'`,
);
const { travelHistory, wasOn } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const NOW = Date.UTC(2027, 5, 15, 12, 0);
const trip = (id, destination, start, end, status = 'OPEN') => ({
  id,
  title: `Trip ${id}`,
  destination,
  startDate: new Date(Date.UTC(...start)).toISOString(),
  endDate: new Date(Date.UTC(...end)).toISOString(),
  status,
});
const member = (id, t, role = 'MEMBER', status = 'APPROVED') => ({ id, role, status, trip: t });

const goa = trip('goa', 'Goa', [2027, 0, 10], [2027, 0, 14]);
const coorg = trip('coorg', 'Coorg', [2027, 2, 1], [2027, 2, 3]);
const future = trip('future', 'Hampi', [2027, 8, 1], [2027, 8, 5]);

describe('wasOn', () => {
  it('counts a finished trip that someone hosted or was approved on', () => {
    assert.equal(wasOn(member('1', goa, 'HOST'), NOW), true);
    assert.equal(wasOn(member('2', goa, 'MEMBER', 'APPROVED'), NOW), true);
  });

  it('does not count a trip that has not ended', () => {
    assert.equal(wasOn(member('1', future, 'HOST'), NOW), false);
  });

  it('counts a trip marked completed even if its end date is still ahead', () => {
    assert.equal(wasOn(member('1', { ...future, status: 'COMPLETED' }), NOW), true);
  });

  it('never counts a cancelled trip', () => {
    assert.equal(wasOn(member('1', { ...goa, status: 'CANCELLED' }, 'HOST'), NOW), false);
    assert.equal(wasOn(member('2', { ...goa, status: 'CANCELLED' }), NOW), false);
  });

  it('does not count a request that was never approved, or someone who was turned away or removed', () => {
    for (const status of ['REQUESTED', 'REJECTED', 'REMOVED']) assert.equal(wasOn(member('1', goa, 'MEMBER', status), NOW), false, status);
  });

  it('does not count someone who left, since the record cannot say when', () => {
    assert.equal(wasOn(member('1', goa, 'MEMBER', 'LEFT'), NOW), false);
  });

  it('is not over until the whole of its last day has passed', () => {
    const endsToday = trip('today', 'Pune', [2027, 5, 13], [2027, 5, 15]);
    assert.equal(wasOn(member('1', endsToday), Date.UTC(2027, 5, 15, 0, 0)), false);
    assert.equal(wasOn(member('1', endsToday), Date.UTC(2027, 5, 15, 23, 59)), false);
    assert.equal(wasOn(member('1', endsToday), Date.UTC(2027, 5, 16, 0, 0)), true);
  });
});

describe('travelHistory', () => {
  it('lists the finished trips, most recent first', () => {
    const { past } = travelHistory([member('a', goa), member('b', coorg), member('c', future)], NOW);
    assert.deepEqual(past.map((m) => m.id), ['b', 'a']);
  });

  it('adds up trips, different places and days away', () => {
    const { totals } = travelHistory([member('a', goa), member('b', coorg)], NOW);
    assert.deepEqual(totals, { trips: 2, places: 2, days: 5 + 3 });
  });

  it('counts a place once however it is typed or how often it was visited', () => {
    const again = trip('goa2', '  goa ', [2027, 3, 1], [2027, 3, 2]);
    const { totals } = travelHistory([member('a', goa), member('b', again)], NOW);
    assert.equal(totals.trips, 2);
    assert.equal(totals.places, 1);
  });

  it('is all zeros for someone with nothing finished yet', () => {
    assert.deepEqual(travelHistory([], NOW), { past: [], totals: { trips: 0, places: 0, days: 0 } });
    assert.deepEqual(travelHistory([member('a', future)], NOW).totals, { trips: 0, places: 0, days: 0 });
  });
});
