// Date and headcount rules around creating and completing a trip. Pure
// functions so the boundaries are unit-testable without a database.
//
// Why these exist: reviews move trust scores, and reviews open when a trip
// is marked COMPLETED. If a trip could be created already in the past and
// completed in a click, someone could farm trust with friends and no actual
// trip. These rules close that off at the two ends: a trip can't start in
// the past, and can't be completed until its last day is over and someone
// other than the host actually joined. They don't stop two people who
// really do collude across many real trips — that's Phase 3's collusion
// detection (docs/ROADMAP.md) — only the no-trip-at-all version.
//
// Dates are UTC. `@IsDateString()` input like "2027-12-01" becomes UTC
// midnight, so "today" and "the end of the last day" are both UTC days.
// That's exact for the launch market (India, UTC+5:30, is ahead of UTC);
// for a user west of UTC it can make "today" lag by a few hours.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The host plus at least one other approved traveller — reviews are between travellers. */
export const MIN_APPROVED_MEMBERS_TO_COMPLETE = 2;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A trip may start today, but not before today. */
export function startsInThePast(startDate: Date, now: Date): boolean {
  return startDate.getTime() < startOfUtcDay(now).getTime();
}

/** True when two dates fall on the same UTC day — the granularity the app cares about. */
export function isSameUtcDay(a: Date, b: Date): boolean {
  return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

/**
 * `endDate` is the trip's last day, inclusive ("Dec 1 – Dec 10" includes the
 * 10th), so the trip hasn't ended until that whole day has passed. Comparing
 * against the start of the end date would let a host complete a trip while
 * it was still on its final day.
 */
export function hasTripEnded(endDate: Date, now: Date): boolean {
  return now.getTime() >= startOfUtcDay(endDate).getTime() + DAY_MS;
}
