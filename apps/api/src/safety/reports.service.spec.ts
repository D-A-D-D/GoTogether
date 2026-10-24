import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReportDto } from './dto/create-report.dto.js';
import { REPORT_REASONS } from './report-reasons.js';
import { MAX_REPORTS_PER_DAY, ReportsService } from './reports.service.js';

// The database is mocked: these cover who may report whom, and the guards that
// stop reporting becoming a harassment tool.

function harness(
  options: { reportedExists?: boolean; sharedTrip?: string | null; openReport?: boolean; recent?: number } = {},
) {
  const findFirstMembership = vi
    .fn()
    .mockResolvedValue(options.sharedTrip === null ? null : { tripId: options.sharedTrip ?? 'trip-shared' });
  const create = vi.fn().mockResolvedValue({ id: 'report-1', createdAt: new Date('2026-10-24') });
  const findFirstReport = vi.fn().mockResolvedValue(options.openReport ? { id: 'existing' } : null);
  const count = vi.fn().mockResolvedValue(options.recent ?? 0);
  const service = new ReportsService({
    user: { findUnique: vi.fn().mockResolvedValue(options.reportedExists === false ? null : { id: 'reported' }) },
    tripMembership: { findFirst: findFirstMembership },
    report: { findFirst: findFirstReport, count, create },
  } as never);
  return { service, create, findFirstMembership, findFirstReport, count };
}

const dto = (overrides: Record<string, unknown> = {}) =>
  ({ reportedId: 'reported', reason: 'HARASSMENT', ...overrides }) as never;

describe('ReportsService.create — who may report whom', () => {
  it("can't report yourself", async () => {
    const { service, create } = harness();
    await expect(service.create('reporter', dto({ reportedId: 'reporter' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a user who does not exist', async () => {
    const { service } = harness({ reportedExists: false });
    await expect(service.create('reporter', dto())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("only lets you report someone you've actually been on a trip with", async () => {
    const { service, create } = harness({ sharedTrip: null });
    await expect(service.create('reporter', dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('requires BOTH people to have held an approved membership on the same trip', async () => {
    const { service, findFirstMembership } = harness();
    await service.create('reporter', dto());
    const where = findFirstMembership.mock.calls[0][0].where;
    const everApproved = [{ status: 'APPROVED' }, { leftAt: { not: null } }];
    expect(where.userId).toBe('reported');
    expect(where.OR).toEqual(everApproved);
    expect(where.trip).toEqual({ memberships: { some: { userId: 'reporter', OR: everApproved } } });
  });

  it('when a trip is named, it must be one they share', async () => {
    const { service, findFirstMembership } = harness();
    await service.create('reporter', dto({ tripId: 'trip-9' }));
    expect(findFirstMembership.mock.calls[0][0].where.tripId).toBe('trip-9');
  });

  it('does not constrain the trip when none is named', async () => {
    const { service, findFirstMembership } = harness();
    await service.create('reporter', dto());
    expect(findFirstMembership.mock.calls[0][0].where).not.toHaveProperty('tripId');
  });
});

describe('ReportsService.create — guards', () => {
  it('allows only one open report per person at a time', async () => {
    const { service, create } = harness({ openReport: true });
    await expect(service.create('reporter', dto())).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('counts a report under review as still open', async () => {
    const { service, findFirstReport } = harness();
    await service.create('reporter', dto());
    expect(findFirstReport.mock.calls[0][0].where.status).toEqual({ in: ['OPEN', 'REVIEWING'] });
  });

  it(`stops at ${MAX_REPORTS_PER_DAY} reports in a day, with a 429`, async () => {
    const { service, create } = harness({ recent: MAX_REPORTS_PER_DAY });
    const error = await service.create('reporter', dto()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(create).not.toHaveBeenCalled();
  });

  it('still allows the last report under the limit', async () => {
    const { service } = harness({ recent: MAX_REPORTS_PER_DAY - 1 });
    await expect(service.create('reporter', dto())).resolves.toBeDefined();
  });

  it("counts only the last day's reports, and only the reporter's own", async () => {
    const { service, count } = harness();
    const before = Date.now();
    await service.create('reporter', dto());
    const where = count.mock.calls[0][0].where;
    expect(where.reporterId).toBe('reporter');
    const sinceMs = (where.createdAt.gte as Date).getTime();
    expect(before - sinceMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(before - sinceMs).toBeLessThan(24 * 60 * 60 * 1000 + 5000);
  });

  it('checks for a duplicate before the rate limit, so the more specific message wins', async () => {
    const { service } = harness({ openReport: true, recent: 99 });
    await expect(service.create('reporter', dto())).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ReportsService.create — what is stored and returned', () => {
  it('stores the reason and details, and records a shared trip when none was named', async () => {
    const { service, create } = harness({ sharedTrip: 'trip-shared' });
    await service.create('reporter', dto({ reason: 'SAFETY_CONCERN', details: 'Made me uncomfortable' }));
    expect(create.mock.calls[0][0].data).toEqual({
      reporterId: 'reporter',
      reportedId: 'reported',
      tripId: 'trip-shared',
      reason: 'SAFETY_CONCERN',
      details: 'Made me uncomfortable',
    });
  });

  it('keeps the trip the reporter named', async () => {
    const { service, create } = harness();
    await service.create('reporter', dto({ tripId: 'trip-named' }));
    expect(create.mock.calls[0][0].data.tripId).toBe('trip-named');
  });

  it('gives the reporter an acknowledgement and nothing else', async () => {
    const { service, create } = harness();
    await service.create('reporter', dto());
    expect(create.mock.calls[0][0].select).toEqual({ id: true, createdAt: true });
  });
});

describe('CreateReportDto', () => {
  const check = async (input: Record<string, unknown>) => validate(plainToInstance(CreateReportDto, input));

  it.each(REPORT_REASONS)('accepts the reason %s', async (reason) => {
    expect(await check({ reportedId: 'u1', reason })).toHaveLength(0);
  });

  it('rejects a reason outside the taxonomy', async () => {
    expect((await check({ reportedId: 'u1', reason: 'THEY_ANNOYED_ME' })).map((e) => e.property)).toContain('reason');
  });

  it('rejects a missing reason', async () => {
    expect((await check({ reportedId: 'u1' })).map((e) => e.property)).toContain('reason');
  });

  it('rejects details over 2000 characters, accepts exactly 2000', async () => {
    expect((await check({ reportedId: 'u1', reason: 'OTHER', details: 'x'.repeat(2001) })).map((e) => e.property)).toContain(
      'details',
    );
    expect(await check({ reportedId: 'u1', reason: 'OTHER', details: 'x'.repeat(2000) })).toHaveLength(0);
  });
});
