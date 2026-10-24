import { ReviewsService } from './reviews.service.js';

// Only the trust-history listing is covered here: it attaches the title of the
// trip each trust change came from. (The scoring itself is exercised against
// the real database by hand — see docs/ROADMAP.md.)

function harness(events: Array<{ id: string; tripId: string | null }>, trips: Array<{ id: string; title: string }>) {
  const tripFindMany = vi.fn().mockResolvedValue(trips);
  const eventFindMany = vi.fn().mockResolvedValue(events.map((e) => ({ ...e, userId: 'u1', delta: 1, reason: 'r' })));
  const service = new ReviewsService(
    { trustScoreEvent: { findMany: eventFindMany }, trip: { findMany: tripFindMany } } as never,
    {} as never,
  );
  return { service, tripFindMany, eventFindMany };
}

describe('ReviewsService.listMyTrustEvents', () => {
  it("attaches each event's trip title", async () => {
    const { service } = harness(
      [
        { id: 'e2', tripId: 'trip-b' },
        { id: 'e1', tripId: 'trip-a' },
      ],
      [
        { id: 'trip-a', title: 'Spiti Trek' },
        { id: 'trip-b', title: 'Goa Weekend' },
      ],
    );
    const result = await service.listMyTrustEvents('u1');
    expect(result.map((e) => [e.id, e.tripTitle])).toEqual([
      ['e2', 'Goa Weekend'],
      ['e1', 'Spiti Trek'],
    ]);
  });

  it('looks the titles up in one query, for each trip once', async () => {
    const { service, tripFindMany } = harness(
      [
        { id: 'e3', tripId: 'trip-a' },
        { id: 'e2', tripId: 'trip-a' },
        { id: 'e1', tripId: 'trip-b' },
      ],
      [],
    );
    await service.listMyTrustEvents('u1');
    expect(tripFindMany).toHaveBeenCalledTimes(1);
    expect(tripFindMany.mock.calls[0][0].where.id.in.sort()).toEqual(['trip-a', 'trip-b']);
  });

  it('gives a null title when the trip has since been deleted', async () => {
    const { service } = harness([{ id: 'e1', tripId: 'gone' }], []);
    expect((await service.listMyTrustEvents('u1'))[0].tripTitle).toBeNull();
  });

  it('gives a null title, and skips the lookup, for an event with no trip', async () => {
    const { service, tripFindMany } = harness([{ id: 'e1', tripId: null }], []);
    expect((await service.listMyTrustEvents('u1'))[0].tripTitle).toBeNull();
    expect(tripFindMany).not.toHaveBeenCalled();
  });

  it('returns the history newest first, ties broken by id', async () => {
    const { service, eventFindMany } = harness([], []);
    await service.listMyTrustEvents('u1');
    expect(eventFindMany.mock.calls[0][0]).toEqual({
      where: { userId: 'u1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });
});
