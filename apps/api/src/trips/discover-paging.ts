// Ordering and paging for the discovery feed. Pure, so the guarantee that
// matters — walking the pages visits every trip exactly once — is unit-testable.
//
// Discovery re-fetches and re-scores candidates on every request, and the
// database returns them in no particular order. Sorting by score alone leaves
// ties (common: many trips share the same tags and dates) in whatever order
// the database happened to return them, which can differ between two requests
// — so a trip could be shown twice, or skipped, as someone pages through. A
// total order removes that.

interface Rankable {
  matchScore: number;
  startDate: Date;
  id: string;
}

/** Best match first; ties go to the sooner trip, then by id so the order is total and never reshuffles. */
export function compareDiscovered(a: Rankable, b: Rankable): number {
  return (
    b.matchScore - a.matchScore ||
    a.startDate.getTime() - b.startDate.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function pageOf<T>(items: readonly T[], offset: number, limit: number): T[] {
  return items.slice(offset, offset + limit);
}
