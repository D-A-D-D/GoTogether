import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/index.js';
import { TripsService } from './trips.service.js';

// The database is mocked: these cover the rules around creating and
// completing a trip (past dates, headcount), not the queries themselves —
// those are exercised against the real database by hand (docs/ROADMAP.md).

const DAY_MS = 24 * 60 * 60 * 1000;

/** A BlocksService stand-in: nobody is blocked unless a test says so. */
function makeBlocks(options: { hidden?: string[]; blocked?: boolean } = {}) {
  return {
    blockedWith: vi.fn().mockResolvedValue(new Set(options.hidden ?? [])),
    areBlocked: vi.fn().mockResolvedValue(options.blocked ?? false),
  };
}

function makeService(
  prisma: Record<string, unknown>,
  notifications: Record<string, unknown> = {},
  blocks: Record<string, unknown> = makeBlocks(),
) {
  return new TripsService(prisma as never, {} as never, notifications as never, blocks as never);
}

/** A UTC date string like "2026-10-23", `daysFromToday` days from today. */
function utcDate(daysFromToday: number): string {
  return new Date(Date.now() + daysFromToday * DAY_MS).toISOString().slice(0, 10);
}

function createDto(startDate: string, endDate: string) {
  return {
    title: 'Spiti',
    destination: 'Spiti, Himachal',
    startDate,
    endDate,
    budgetMin: 100,
    budgetMax: 200,
    capacity: 4,
  } as never;
}

describe('TripsService.create — start date', () => {
  it('rejects a trip that started yesterday, before touching the database', async () => {
    const transaction = vi.fn();
    const service = makeService({ $transaction: transaction });

    await expect(service.create('host-1', createDto(utcDate(-1), utcDate(1)))).rejects.toThrow(
      /can't start in the past/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a trip entirely in the past', async () => {
    const service = makeService({ $transaction: vi.fn() });
    await expect(service.create('host-1', createDto(utcDate(-30), utcDate(-25)))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lets a trip start today — it gets as far as the database', async () => {
    const service = makeService({ $transaction: vi.fn().mockRejectedValue(new Error('reached the database')) });
    await expect(service.create('host-1', createDto(utcDate(0), utcDate(3)))).rejects.toThrow(
      'reached the database',
    );
  });

  it('lets a future trip through', async () => {
    const service = makeService({ $transaction: vi.fn().mockRejectedValue(new Error('reached the database')) });
    await expect(service.create('host-1', createDto(utcDate(60), utcDate(70)))).rejects.toThrow(
      'reached the database',
    );
  });
});

describe('TripsService.complete — when a trip may be marked complete', () => {
  function tripEndingOn(endDate: string) {
    return { id: 'trip-1', hostId: 'host-1', status: 'OPEN', endDate: new Date(endDate) };
  }

  function serviceFor(trip: ReturnType<typeof tripEndingOn>, approvedCount: number) {
    const count = vi.fn().mockResolvedValue(approvedCount);
    const update = vi.fn().mockResolvedValue({ ...trip, status: 'COMPLETED' });
    const service = makeService({
      trip: { findUnique: vi.fn().mockResolvedValue(trip), update },
      tripMembership: { count },
    });
    return { service, count, update };
  }

  it('refuses while the trip is still on its last day', async () => {
    const { service, update } = serviceFor(tripEndingOn(utcDate(0)), 3);
    await expect(service.complete('trip-1', 'host-1')).rejects.toThrow(/last day is over/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses before the trip has ended at all', async () => {
    const { service } = serviceFor(tripEndingOn(utcDate(10)), 3);
    await expect(service.complete('trip-1', 'host-1')).rejects.toThrow(/last day is over/);
  });

  it('refuses when nobody but the host joined', async () => {
    const { service, update } = serviceFor(tripEndingOn(utcDate(-3)), 1);
    await expect(service.complete('trip-1', 'host-1')).rejects.toThrow(/at least one other approved member/);
    expect(update).not.toHaveBeenCalled();
  });

  it('completes an ended trip with the host and one other approved member', async () => {
    const { service, update } = serviceFor(tripEndingOn(utcDate(-3)), 2);
    await service.complete('trip-1', 'host-1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'trip-1' }, data: { status: 'COMPLETED' } });
  });

  it('counts only approved members', async () => {
    const { service, count } = serviceFor(tripEndingOn(utcDate(-3)), 2);
    await service.complete('trip-1', 'host-1');
    expect(count).toHaveBeenCalledWith({ where: { tripId: 'trip-1', status: 'APPROVED' } });
  });

  it('checks the date before the headcount, so a not-yet-ended trip gets the date message', async () => {
    const { service, count } = serviceFor(tripEndingOn(utcDate(5)), 1);
    await expect(service.complete('trip-1', 'host-1')).rejects.toThrow(/last day is over/);
    expect(count).not.toHaveBeenCalled();
  });
});

describe('TripsService.update — editing an open trip', () => {
  function harness(
    tripOverrides: Record<string, unknown> = {},
    options: { approvedCount?: number; memberIds?: string[]; updateError?: Error } = {},
  ) {
    const trip = {
      id: 'trip-1',
      hostId: 'host-1',
      status: 'OPEN',
      title: 'Spiti',
      destination: 'Spiti',
      startDate: new Date(utcDate(30)),
      endDate: new Date(utcDate(35)),
      budgetMin: 100,
      budgetMax: 200,
      capacity: 4,
      ...tripOverrides,
    };
    const update = options.updateError
      ? vi.fn().mockRejectedValue(options.updateError)
      : vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...trip,
          ...data,
          includeTags: [],
          excludeTags: [],
          host: {},
        }));
    const findMany = vi.fn().mockResolvedValue((options.memberIds ?? []).map((userId) => ({ userId })));
    const count = vi.fn().mockResolvedValue(options.approvedCount ?? 1);
    const tagCount = vi.fn().mockResolvedValue(1);
    const notifyUsers = vi.fn().mockResolvedValue(undefined);
    const service = makeService(
      {
        trip: { findUnique: vi.fn().mockResolvedValue(trip), update },
        tripMembership: { count, findMany },
        tag: { count: tagCount, findMany: vi.fn() },
      },
      { notifyUsers },
    );
    return { service, update, findMany, notifyUsers };
  }

  /** What was written, i.e. the `data` the service handed to prisma.trip.update. */
  const written = (update: ReturnType<typeof vi.fn>) => update.mock.calls[0][0].data;

  it('is host-only', async () => {
    const { service } = harness({ hostId: 'someone-else' });
    await expect(service.update('trip-1', 'host-1', { title: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['COMPLETED', 'CANCELLED'])('refuses a %s trip', async (status) => {
    const { service, update } = harness({ status });
    await expect(service.update('trip-1', 'host-1', { title: 'x' })).rejects.toThrow(/can't be edited/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to move the start into the past', async () => {
    const { service, update } = harness();
    await expect(service.update('trip-1', 'host-1', { startDate: utcDate(-1) })).rejects.toThrow(
      /can't start in the past/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to move the end into the past', async () => {
    const { service } = harness({ startDate: new Date(utcDate(-5)), endDate: new Date(utcDate(5)) });
    await expect(service.update('trip-1', 'host-1', { endDate: utcDate(-1) })).rejects.toThrow(
      /can't end in the past/,
    );
  });

  it('refuses an end date before the stored start date', async () => {
    const { service } = harness(); // starts in 30 days
    await expect(service.update('trip-1', 'host-1', { endDate: utcDate(10) })).rejects.toThrow(
      /endDate must not be before startDate/,
    );
  });

  it('refuses a budget max below the stored budget min', async () => {
    const { service } = harness();
    await expect(service.update('trip-1', 'host-1', { budgetMax: 50 })).rejects.toThrow(/budgetMax/);
  });

  it('lets a trip that has already started have its description fixed, dates untouched', async () => {
    const { service, update } = harness({ startDate: new Date(utcDate(-5)), endDate: new Date(utcDate(5)) });
    await service.update('trip-1', 'host-1', { description: 'Updated plan' });
    expect(written(update)).toEqual({ description: 'Updated plan' });
  });

  it('does not treat re-sending the same dates as an edit, even on a trip underway', async () => {
    const { service, update } = harness({ startDate: new Date(utcDate(-5)), endDate: new Date(utcDate(5)) });
    await service.update('trip-1', 'host-1', { startDate: utcDate(-5), endDate: utcDate(5), title: 'New title' });
    expect(written(update)).toEqual({ title: 'New title' });
  });

  it('does not treat a different time on the same UTC day as a change', async () => {
    const { service, update } = harness({ startDate: new Date(`${utcDate(30)}T08:00:00Z`) });
    await service.update('trip-1', 'host-1', { startDate: utcDate(30), title: 'x' });
    expect(written(update)).toEqual({ title: 'x' });
  });

  it('writes a genuine date change', async () => {
    const { service, update } = harness();
    await service.update('trip-1', 'host-1', { startDate: utcDate(40), endDate: utcDate(45) });
    expect(written(update).startDate).toEqual(new Date(utcDate(40)));
    expect(written(update).endDate).toEqual(new Date(utcDate(45)));
  });

  it('refuses a capacity below the people already approved', async () => {
    const { service, update } = harness({}, { approvedCount: 3 });
    await expect(service.update('trip-1', 'host-1', { capacity: 2 })).rejects.toThrow(
      /lower than the 3 people already approved/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('marks an open trip FULL when the new capacity equals the approved count', async () => {
    const { service, update } = harness({ status: 'OPEN' }, { approvedCount: 3 });
    await service.update('trip-1', 'host-1', { capacity: 3 });
    expect(written(update)).toEqual({ capacity: 3, status: 'FULL' });
  });

  it('reopens a FULL trip when capacity is raised', async () => {
    const { service, update } = harness({ status: 'FULL', capacity: 3 }, { approvedCount: 3 });
    await service.update('trip-1', 'host-1', { capacity: 5 });
    expect(written(update)).toEqual({ capacity: 5, status: 'OPEN' });
  });

  it('clears the description and trip type when sent as empty strings', async () => {
    const { service, update } = harness();
    await service.update('trip-1', 'host-1', { description: '', tripType: '' });
    expect(written(update)).toEqual({ description: null, tripType: null });
  });

  it('replaces a tag list only when one is sent', async () => {
    const { service, update } = harness();
    await service.update('trip-1', 'host-1', { includeTagIds: ['tag-1'] });
    expect(written(update)).toEqual({ includeTags: { set: [{ id: 'tag-1' }] } });
  });

  it("reports an approved member's clashing trip as a 409 rather than a server error", async () => {
    const overlap = new Prisma.PrismaClientUnknownRequestError('violates exclusion constraint "trip_membership_no_overlap"', {
      clientVersion: 'test',
    });
    const { service } = harness({}, { updateError: overlap });
    await expect(service.update('trip-1', 'host-1', { startDate: utcDate(40), endDate: utcDate(45) })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lets any other database error through untouched', async () => {
    const { service } = harness({}, { updateError: new Error('connection lost') });
    await expect(service.update('trip-1', 'host-1', { title: 'x' })).rejects.toThrow('connection lost');
  });

  it('tells the approved members (not the host) about changes they would plan around', async () => {
    const { service, findMany, notifyUsers } = harness({}, { memberIds: ['m1', 'm2'] });
    await service.update('trip-1', 'host-1', { destination: 'Leh', budgetMax: 300 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tripId: 'trip-1', status: 'APPROVED', userId: { not: 'host-1' } } }),
    );
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notifyUsers.mock.calls[0];
    expect(recipients).toEqual(['m1', 'm2']);
    expect(payload.body).toContain('destination and budget');
    expect(payload.url).toBe('/trips/trip-1');
  });

  it('says "dates" when the dates move', async () => {
    const { service, notifyUsers } = harness({}, { memberIds: ['m1'] });
    await service.update('trip-1', 'host-1', { startDate: utcDate(40), endDate: utcDate(45) });
    expect(notifyUsers.mock.calls[0][1].body).toContain('dates changed');
  });

  it('stays quiet about edits members would not plan around', async () => {
    const { service, notifyUsers } = harness({}, { memberIds: ['m1'] });
    await service.update('trip-1', 'host-1', { title: 'Better title', description: 'More detail', capacity: 6 });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it('does not count re-sent identical values as changes', async () => {
    const { service, notifyUsers } = harness({}, { memberIds: ['m1'] });
    await service.update('trip-1', 'host-1', {
      destination: 'Spiti',
      budgetMin: 100,
      budgetMax: 200,
      startDate: utcDate(30),
      endDate: utcDate(35),
    });
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe('TripsService.cancel — cancelling an open trip', () => {
  function harness(
    tripOverrides: Record<string, unknown> = {},
    options: { memberIds?: string[]; requesterIds?: string[]; rawError?: Error } = {},
  ) {
    const trip = { id: 'trip-1', hostId: 'host-1', status: 'OPEN', title: 'Spiti', ...tripOverrides };
    const update = vi.fn().mockResolvedValue({ ...trip, status: 'CANCELLED' });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockImplementation(async ({ where }: { where: { status: string } }) =>
      (where.status === 'APPROVED' ? (options.memberIds ?? []) : (options.requesterIds ?? [])).map((userId) => ({ userId })),
    );
    const executeRaw = options.rawError ? vi.fn().mockRejectedValue(options.rawError) : vi.fn().mockResolvedValue(1);
    const tx = {
      trip: { update },
      tripMembership: { findMany, updateMany },
      $executeRaw: executeRaw,
    };
    const notifyUsers = vi.fn().mockResolvedValue(undefined);
    const service = makeService(
      {
        trip: { findUnique: vi.fn().mockResolvedValue(trip) },
        $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      },
      { notifyUsers },
    );
    return { service, update, updateMany, findMany, executeRaw, notifyUsers };
  }

  it('is host-only', async () => {
    const { service } = harness({ hostId: 'someone-else' });
    await expect(service.cancel('trip-1', 'host-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a trip that is already cancelled', async () => {
    const { service } = harness({ status: 'CANCELLED' });
    await expect(service.cancel('trip-1', 'host-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a completed trip', async () => {
    const { service, update } = harness({ status: 'COMPLETED' });
    await expect(service.cancel('trip-1', 'host-1')).rejects.toThrow(/can't be cancelled/);
    expect(update).not.toHaveBeenCalled();
  });

  it('cancels a FULL trip too', async () => {
    const { service, update } = harness({ status: 'FULL' });
    await service.cancel('trip-1', 'host-1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'trip-1' }, data: { status: 'CANCELLED' } });
  });

  it('marks the trip cancelled and declines the pending requests', async () => {
    const { service, update, updateMany } = harness();
    await service.cancel('trip-1', 'host-1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'trip-1' }, data: { status: 'CANCELLED' } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { tripId: 'trip-1', status: 'REQUESTED' },
      data: { status: 'REJECTED', respondedAt: expect.any(Date) },
    });
  });

  it("releases every member's date hold, so the overlap constraint stops blocking them", async () => {
    const { service, executeRaw } = harness();
    await service.cancel('trip-1', 'host-1');
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join('?')).toContain('SET period = NULL');
    expect(strings.join('?')).toContain('"tripId" = ?');
    expect(values).toEqual(['trip-1']);
  });

  it('tells approved members (never the host) and the people whose requests were closed', async () => {
    const { service, findMany, notifyUsers } = harness({}, { memberIds: ['m1', 'm2'], requesterIds: ['r1'] });
    await service.cancel('trip-1', 'host-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tripId: 'trip-1', status: 'APPROVED', userId: { not: 'host-1' } } }),
    );
    expect(notifyUsers).toHaveBeenCalledTimes(2);
    expect(notifyUsers.mock.calls[0][0]).toEqual(['m1', 'm2']);
    expect(notifyUsers.mock.calls[0][1].title).toBe('Trip cancelled');
    expect(notifyUsers.mock.calls[1][0]).toEqual(['r1']);
    expect(notifyUsers.mock.calls[1][1].title).toBe('Request closed');
  });

  it('notifies nobody if the cancellation itself fails', async () => {
    const { service, notifyUsers } = harness({}, { memberIds: ['m1'], rawError: new Error('db went away') });
    await expect(service.cancel('trip-1', 'host-1')).rejects.toThrow('db went away');
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe('TripsService.respondToRequest — approving only while the trip is taking people', () => {
  function harness(tripStatus: string) {
    const trip = { id: 'trip-1', hostId: 'host-1', status: tripStatus, title: 'Spiti', capacity: 4 };
    const membership = { id: 'm-1', tripId: 'trip-1', userId: 'guest-1', status: 'REQUESTED' };
    const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...membership, ...data }));
    const notifyUser = vi.fn().mockResolvedValue(undefined);
    const service = makeService(
      {
        trip: { findUnique: vi.fn().mockResolvedValue(trip), update: vi.fn() },
        tripMembership: {
          findUnique: vi.fn().mockResolvedValue(membership),
          count: vi.fn().mockResolvedValue(1),
          update,
        },
      },
      { notifyUser },
    );
    return { service, update, notifyUser };
  }

  it.each(['COMPLETED', 'CANCELLED'])('refuses to approve a request on a %s trip', async (status) => {
    const { service, update } = harness(status);
    await expect(service.respondToRequest('trip-1', 'm-1', 'host-1', 'APPROVED')).rejects.toThrow(
      /can't take new members/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'CANCELLED'])('still lets a host decline a leftover request on a %s trip', async (status) => {
    const { service, update } = harness(status);
    await service.respondToRequest('trip-1', 'm-1', 'host-1', 'REJECTED');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
  });

  it('still approves on an open trip', async () => {
    const { service, update } = harness('OPEN');
    await service.respondToRequest('trip-1', 'm-1', 'host-1', 'APPROVED');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
  });
});

describe('TripsService — honouring blocks', () => {
  const trip = {
    id: 'trip-1',
    hostId: 'host-1',
    status: 'OPEN',
    title: 'Spiti',
    capacity: 4,
    includeTags: [],
    excludeTags: [],
    host: { id: 'host-1' },
  };

  function viewing(options: { blocked?: boolean; myMembership?: Record<string, unknown> | null } = {}) {
    const blocks = makeBlocks({ blocked: options.blocked });
    const service = makeService(
      {
        trip: { findUnique: vi.fn().mockResolvedValue(trip) },
        tripMembership: {
          count: vi.fn().mockResolvedValue(1),
          findUnique: vi.fn().mockResolvedValue(options.myMembership ?? null),
        },
      },
      {},
      blocks,
    );
    return { service, blocks };
  }

  it('hides a trip from someone blocked with its host, as if it did not exist', async () => {
    const { service, blocks } = viewing({ blocked: true });
    await expect(service.findById('trip-1', 'viewer')).rejects.toBeInstanceOf(NotFoundException);
    expect(blocks.areBlocked).toHaveBeenCalledWith('viewer', 'host-1');
  });

  it('still shows the trip to someone who is already on it — blocking removes nobody from a trip', async () => {
    const { service } = viewing({ blocked: true, myMembership: { status: 'APPROVED', role: 'MEMBER' } });
    await expect(service.findById('trip-1', 'viewer')).resolves.toBeDefined();
  });

  it("never hides a host's own trip from them", async () => {
    const { service, blocks } = viewing({ blocked: true });
    await expect(service.findById('trip-1', 'host-1')).resolves.toBeDefined();
    expect(blocks.areBlocked).not.toHaveBeenCalled();
  });

  it('shows the trip when there is no block', async () => {
    const { service } = viewing({ blocked: false });
    await expect(service.findById('trip-1', 'viewer')).resolves.toMatchObject({ id: 'trip-1' });
  });

  it('refuses a join request to a blocked host with the same "not found" as viewing — a block is not discoverable', async () => {
    const create = vi.fn();
    const blocks = makeBlocks({ blocked: true });
    const service = makeService(
      {
        // Even a trip that is not open answers "not found", not "not open for requests".
        trip: { findUnique: vi.fn().mockResolvedValue({ ...trip, status: 'COMPLETED' }) },
        tripMembership: { create },
      },
      {},
      blocks,
    );
    await expect(service.requestToJoin('trip-1', 'viewer')).rejects.toBeInstanceOf(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  function roster(hidden: string[]) {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = makeService(
      { tripMembership: { findUnique: vi.fn().mockResolvedValue({ status: 'APPROVED' }), findMany } },
      {},
      makeBlocks({ hidden }),
    );
    return { service, findMany };
  }

  it("leaves blocked people off a member's travellers list", async () => {
    const { service, findMany } = roster(['blocked-1', 'blocked-2']);
    await service.listMembers('trip-1', 'viewer');
    expect(findMany.mock.calls[0][0].where).toEqual({
      tripId: 'trip-1',
      status: 'APPROVED',
      userId: { notIn: ['blocked-1', 'blocked-2'] },
    });
  });

  it('lists everyone when nobody is blocked', async () => {
    const { service, findMany } = roster([]);
    await service.listMembers('trip-1', 'viewer');
    expect(findMany.mock.calls[0][0].where).toEqual({ tripId: 'trip-1', status: 'APPROVED' });
  });

  it("drops a blocked host's trips from discovery", async () => {
    const tripFindMany = vi.fn().mockResolvedValue([]);
    const service = makeService(
      {
        user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'viewer', preferenceTags: [] }) },
        tripMembership: { findMany: vi.fn().mockResolvedValue([]) },
        trip: { findMany: tripFindMany },
      },
      {},
      makeBlocks({ hidden: ['blocked-host'] }),
    );
    await service.discover('viewer', {} as never);
    const notIn = tripFindMany.mock.calls[0][0].where.hostId.notIn as string[];
    expect(notIn).toContain('blocked-host');
    expect(notIn).toContain('viewer');
  });
});
