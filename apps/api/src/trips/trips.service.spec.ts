import { BadRequestException } from '@nestjs/common';
import { TripsService } from './trips.service.js';

// The database is mocked: these cover the rules around creating and
// completing a trip (past dates, headcount), not the queries themselves —
// those are exercised against the real database by hand (docs/ROADMAP.md).

const DAY_MS = 24 * 60 * 60 * 1000;

function makeService(prisma: Record<string, unknown>) {
  return new TripsService(prisma as never, {} as never, {} as never);
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
