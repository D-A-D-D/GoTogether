import type { MyTripMembership } from '@/lib/api';
import { tripDays } from '@/lib/format';

const DAY_MS = 86_400_000;

/** The end date is the trip's last day, inclusive (as the API treats it), so the trip is over only once that whole day has passed. */
function isOver(endDateIso: string, now: number): boolean {
  const end = new Date(endDateIso);
  return now >= Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) + DAY_MS;
}

/**
 * A trip belongs in the history once it has ended and the person was really on it (hosting, or approved).
 * Someone who left is not counted: the record does not say whether they left before the trip began or partway through.
 */
export function wasOn(m: Pick<MyTripMembership, 'role' | 'status'> & { trip: Pick<MyTripMembership['trip'], 'status' | 'endDate'> }, now: number): boolean {
  if (m.trip.status === 'CANCELLED') return false;
  const ended = m.trip.status === 'COMPLETED' || isOver(m.trip.endDate, now);
  const took = m.role === 'HOST' || m.status === 'APPROVED';
  return ended && took;
}

export interface HistoryTotals {
  trips: number;
  /** Different destinations, ignoring capital letters and stray spaces. */
  places: number;
  days: number;
}

/** The trips a person has been on, most recent first, and what they add up to. */
export function travelHistory(memberships: MyTripMembership[], now: number): { past: MyTripMembership[]; totals: HistoryTotals } {
  const past = memberships
    .filter((m) => wasOn(m, now))
    .sort((a, b) => new Date(b.trip.endDate).getTime() - new Date(a.trip.endDate).getTime());
  return {
    past,
    totals: {
      trips: past.length,
      places: new Set(past.map((m) => m.trip.destination.trim().toLowerCase())).size,
      days: past.reduce((n, m) => n + tripDays(m.trip.startDate, m.trip.endDate), 0),
    },
  };
}
