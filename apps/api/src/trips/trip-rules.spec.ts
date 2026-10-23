import { hasTripEnded, startOfUtcDay, startsInThePast } from './trip-rules.js';

const at = (iso: string) => new Date(iso);

describe('startOfUtcDay', () => {
  it('drops the time of day', () => {
    expect(startOfUtcDay(at('2026-10-23T15:30:45.123Z')).toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });
});

describe('startsInThePast', () => {
  const now = at('2026-10-23T15:30:00Z');

  it('allows a trip starting today', () => {
    expect(startsInThePast(at('2026-10-23'), now)).toBe(false);
  });

  it('allows a start with a time of day earlier today', () => {
    expect(startsInThePast(at('2026-10-23T02:00:00Z'), now)).toBe(false);
  });

  it('allows a later date', () => {
    expect(startsInThePast(at('2026-10-24'), now)).toBe(false);
    expect(startsInThePast(at('2027-12-01'), now)).toBe(false);
  });

  it('rejects yesterday', () => {
    expect(startsInThePast(at('2026-10-22'), now)).toBe(true);
  });

  it('rejects the very last instant of yesterday', () => {
    expect(startsInThePast(at('2026-10-22T23:59:59.999Z'), now)).toBe(true);
  });

  it('judges "today" by the UTC day, however late in it we are', () => {
    expect(startsInThePast(at('2026-10-23'), at('2026-10-23T23:59:59.999Z'))).toBe(false);
    expect(startsInThePast(at('2026-10-23'), at('2026-10-24T00:00:00.000Z'))).toBe(true);
  });
});

describe('hasTripEnded', () => {
  const endDate = at('2026-10-10');

  it('is not over at the start of the last day', () => {
    expect(hasTripEnded(endDate, at('2026-10-10T00:00:00.000Z'))).toBe(false);
  });

  it('is not over at the end of the last day, one millisecond early', () => {
    expect(hasTripEnded(endDate, at('2026-10-10T23:59:59.999Z'))).toBe(false);
  });

  it('is over the moment the last day finishes', () => {
    expect(hasTripEnded(endDate, at('2026-10-11T00:00:00.000Z'))).toBe(true);
  });

  it('is over well afterwards', () => {
    expect(hasTripEnded(endDate, at('2027-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('is not over before the trip even starts ending', () => {
    expect(hasTripEnded(endDate, at('2026-10-01T00:00:00.000Z'))).toBe(false);
  });

  it('treats an end date carrying a time of day as that whole day', () => {
    const withTime = at('2026-10-10T15:00:00Z');
    expect(hasTripEnded(withTime, at('2026-10-10T20:00:00Z'))).toBe(false);
    expect(hasTripEnded(withTime, at('2026-10-11T00:00:00Z'))).toBe(true);
  });
});
