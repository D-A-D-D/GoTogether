// Tests for src/lib/format.ts. Run with `npm run test --workspace apps/web`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayLabel, formatBudget, formatDateRange, formatMoney, plural, tripDays } from '../src/lib/format.ts';

describe('money', () => {
  it('shows rupees with Indian digit grouping', () => {
    assert.equal(formatMoney(18000), '₹18,000');
    assert.equal(formatMoney(125000), '₹1,25,000');
    assert.equal(formatMoney(0), '₹0');
  });

  it('shows a range, or a single figure when min and max match', () => {
    assert.equal(formatBudget(9000, 14000), '₹9,000 – ₹14,000');
    assert.equal(formatBudget(5000, 5000), '₹5,000');
  });
});

describe('tripDays', () => {
  it('counts the first and the last day', () => {
    assert.equal(tripDays('2027-02-12T00:00:00.000Z', '2027-02-17T00:00:00.000Z'), 6);
    assert.equal(tripDays('2027-02-12T00:00:00.000Z', '2027-02-12T00:00:00.000Z'), 1);
  });

  it('never goes below one day, even for backwards dates', () => {
    assert.equal(tripDays('2027-02-17T00:00:00.000Z', '2027-02-12T00:00:00.000Z'), 1);
  });

  it('is not thrown by a month boundary or a leap day', () => {
    assert.equal(tripDays('2028-02-27T00:00:00.000Z', '2028-03-01T00:00:00.000Z'), 4);
  });
});

describe('formatDateRange', () => {
  it('shortens a range inside one month', () => {
    assert.equal(formatDateRange('2027-02-12T00:00:00.000Z', '2027-02-17T00:00:00.000Z'), '12 – 17 Feb');
  });

  it('spells out both months when they differ', () => {
    assert.equal(formatDateRange('2027-06-28T00:00:00.000Z', '2027-07-03T00:00:00.000Z'), '28 Jun – 3 Jul');
  });

  it('shows a single day once', () => {
    assert.equal(formatDateRange('2027-02-12T00:00:00.000Z', '2027-02-12T00:00:00.000Z'), '12 Feb');
  });

  it('reads a date as the calendar day it was entered as, whatever the viewer\'s timezone', () => {
    assert.equal(formatDateRange('2027-03-01T00:00:00.000Z', '2027-03-02T00:00:00.000Z'), '1 – 2 Mar');
  });
});

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    assert.equal(plural(1, 'seat'), '1 seat');
    assert.equal(plural(0, 'seat'), '0 seats');
    assert.equal(plural(3, 'seat'), '3 seats');
    assert.equal(plural(2, 'person', 'people'), '2 people');
  });
});

describe('dayLabel', () => {
  const now = new Date(2027, 5, 15, 14, 0);
  it('says Today and Yesterday', () => {
    assert.equal(dayLabel(new Date(2027, 5, 15, 1, 0).toISOString(), now), 'Today');
    assert.equal(dayLabel(new Date(2027, 5, 14, 23, 0).toISOString(), now), 'Yesterday');
  });

  it('gives a date otherwise, with the year only when it is not this year', () => {
    assert.equal(dayLabel(new Date(2027, 5, 1, 9, 0).toISOString(), now), '1 Jun');
    assert.equal(dayLabel(new Date(2026, 11, 25, 9, 0).toISOString(), now), '25 Dec 2026');
  });
});
