import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ModerationService } from './moderation.service.js';

// The database is mocked: these cover the rules around what a moderator may do.
// That the queries behave that way against the real database is checked by
// hand (docs/ROADMAP.md).

const admin = { userId: 'admin-1', email: 'admin@example.com', role: 'ADMIN' as const };

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    reporterId: 'reporter-1',
    reportedId: 'target-1',
    status: 'OPEN',
    ...overrides,
  };
}

function harness(options: {
  report?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  transactionError?: Error;
} = {}) {
  const calls: string[] = [];
  const note = (name: string) => (...args: unknown[]) => {
    calls.push(name);
    return args;
  };

  const userUpdate = vi.fn().mockImplementation(({ data }) => ({ op: 'user.update', id: 'target-1', accountStatus: data.accountStatus }));
  const actionCreate = vi.fn().mockReturnValue({ op: 'moderationAction.create' });
  const tokenUpdateMany = vi.fn().mockReturnValue({ op: 'refreshToken.updateMany' });
  const reportUpdate = vi.fn().mockImplementation(({ data }) => ({ op: 'report.update', ...data }));
  const transaction = vi.fn(async (ops: unknown[]) => {
    calls.push('transaction');
    if (options.transactionError) throw options.transactionError;
    return ops;
  });
  const invalidate = vi.fn(note('invalidate'));

  const prisma = {
    report: {
      findUnique: vi.fn().mockResolvedValue(options.report === undefined ? report() : options.report),
      update: reportUpdate,
    },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options.target === undefined ? { id: 'target-1', role: 'USER', accountStatus: 'ACTIVE' } : options.target,
        ),
      update: userUpdate,
    },
    moderationAction: { create: actionCreate },
    refreshToken: { updateMany: tokenUpdateMany },
    $transaction: transaction,
  };
  const service = new ModerationService(prisma as never, { invalidate } as never);
  return { service, calls, userUpdate, actionCreate, tokenUpdateMany, reportUpdate, transaction, invalidate, prisma };
}

describe('ModerationService.setAccountStatus — what a moderator may not do', () => {
  it("can't change their own status", async () => {
    const { service, transaction } = harness();
    await expect(service.setAccountStatus(admin, 'admin-1', { status: 'SUSPENDED', reason: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses an unknown account', async () => {
    const { service } = harness({ target: null });
    await expect(service.setAccountStatus(admin, 'ghost', { status: 'SUSPENDED', reason: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("can't restrict another admin — they have to be demoted first", async () => {
    const { service, transaction } = harness({ target: { id: 'target-1', role: 'ADMIN', accountStatus: 'ACTIVE' } });
    await expect(service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses a reason that's only whitespace", async () => {
    const { service, transaction } = harness();
    await expect(service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses a no-op, so the audit trail only holds real changes', async () => {
    const { service, transaction } = harness({ target: { id: 'target-1', role: 'USER', accountStatus: 'SUSPENDED' } });
    await expect(service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'again' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('ModerationService.setAccountStatus — when it goes ahead', () => {
  it('records who changed what, from which status to which, and why', async () => {
    const { service, actionCreate } = harness();
    await service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: '  Repeated harassment  ' });
    expect(actionCreate).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        targetId: 'target-1',
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        reason: 'Repeated harassment',
        reportId: undefined,
      },
    });
  });

  it('changes the status and the audit row together in one transaction', async () => {
    const { service, transaction, userUpdate } = harness();
    await service.setAccountStatus(admin, 'target-1', { status: 'BANNED', reason: 'r' });
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'target-1' }, data: { accountStatus: 'BANNED' } }));
    const ops = transaction.mock.calls[0][0] as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(['user.update', 'moderationAction.create', 'refreshToken.updateMany']);
  });

  it.each(['SUSPENDED', 'BANNED'] as const)('revokes every live session when restricting (%s)', async (status) => {
    const { service, tokenUpdateMany } = harness();
    await service.setAccountStatus(admin, 'target-1', { status, reason: 'r' });
    expect(tokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'target-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does not touch sessions when reinstating', async () => {
    const { service, tokenUpdateMany, actionCreate } = harness({
      target: { id: 'target-1', role: 'USER', accountStatus: 'SUSPENDED' },
    });
    await service.setAccountStatus(admin, 'target-1', { status: 'ACTIVE', reason: 'Appeal upheld' });
    expect(tokenUpdateMany).not.toHaveBeenCalled();
    expect(actionCreate.mock.calls[0][0].data).toMatchObject({ fromStatus: 'SUSPENDED', toStatus: 'ACTIVE' });
  });

  it('clears the cached status only after the transaction commits', async () => {
    const { service, calls, invalidate } = harness();
    await service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r' });
    expect(invalidate).toHaveBeenCalledWith('target-1');
    expect(calls.indexOf('transaction')).toBeLessThan(calls.indexOf('invalidate'));
  });

  it('leaves the cache alone if the transaction fails — nothing changed', async () => {
    const { service, invalidate } = harness({ transactionError: new Error('db went away') });
    await expect(service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r' })).rejects.toThrow(
      'db went away',
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('returns the new status', async () => {
    const { service } = harness();
    expect(await service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r' })).toMatchObject({
      accountStatus: 'SUSPENDED',
    });
  });
});

describe('ModerationService.setAccountStatus — closing a report as it goes', () => {
  it('closes the report as ACTIONED, with the reason as its resolution and the moderator as reviewer', async () => {
    const { service, reportUpdate, transaction } = harness();
    await service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'Clear harassment', reportId: 'report-1' });
    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: 'report-1' },
      data: {
        status: 'ACTIONED',
        reviewedById: 'admin-1',
        reviewedAt: expect.any(Date),
        resolution: 'Clear harassment',
      },
    });
    expect((transaction.mock.calls[0][0] as Array<{ op: string }>).map((o) => o.op)).toContain('report.update');
  });

  it('links the audit row to the report', async () => {
    const { service, actionCreate } = harness();
    await service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r', reportId: 'report-1' });
    expect(actionCreate.mock.calls[0][0].data.reportId).toBe('report-1');
  });

  it("refuses a report that isn't about this account", async () => {
    const { service, transaction } = harness({ report: report({ reportedId: 'someone-else' }) });
    await expect(
      service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r', reportId: 'report-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses a report that does not exist', async () => {
    const { service } = harness({ report: null });
    await expect(
      service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r', reportId: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("won't act on a report the moderator filed themselves", async () => {
    const { service, transaction } = harness({ report: report({ reporterId: 'admin-1' }) });
    await expect(
      service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r', reportId: 'report-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['ACTIONED', 'DISMISSED'])('refuses a report that is already %s', async (status) => {
    const { service } = harness({ report: report({ status }) });
    await expect(
      service.setAccountStatus(admin, 'target-1', { status: 'SUSPENDED', reason: 'r', reportId: 'report-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ModerationService.reviewReport', () => {
  it('refuses an unknown report', async () => {
    const { service } = harness({ report: null });
    await expect(service.reviewReport(admin, 'nope', { status: 'REVIEWING' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a moderator who filed the report', async () => {
    const { service, prisma } = harness({ report: report({ reporterId: 'admin-1' }) });
    await expect(service.reviewReport(admin, 'report-1', { status: 'REVIEWING' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it('refuses a moderator the report is about', async () => {
    const { service } = harness({ report: report({ reportedId: 'admin-1' }) });
    await expect(service.reviewReport(admin, 'report-1', { status: 'DISMISSED', resolution: 'n' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each(['ACTIONED', 'DISMISSED'])('cannot reopen or change a report that is already %s', async (status) => {
    const { service, prisma } = harness({ report: report({ status }) });
    await expect(service.reviewReport(admin, 'report-1', { status: 'REVIEWING' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it('refuses to start reviewing something already under review', async () => {
    const { service } = harness({ report: report({ status: 'REVIEWING' }) });
    await expect(service.reviewReport(admin, 'report-1', { status: 'REVIEWING' })).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['ACTIONED', 'DISMISSED'] as const)('requires a note to close a report as %s', async (status) => {
    const { service, prisma } = harness();
    for (const resolution of [undefined, '', '   ']) {
      await expect(service.reviewReport(admin, 'report-1', { status, resolution })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it('starts a review without needing a note, and records who and when', async () => {
    const { service, prisma } = harness();
    await service.reviewReport(admin, 'report-1', { status: 'REVIEWING' });
    expect(prisma.report.update.mock.calls[0][0].data).toEqual({
      status: 'REVIEWING',
      reviewedById: 'admin-1',
      reviewedAt: expect.any(Date),
    });
  });

  it('closes a report with the trimmed note', async () => {
    const { service, prisma } = harness({ report: report({ status: 'REVIEWING' }) });
    await service.reviewReport(admin, 'report-1', { status: 'DISMISSED', resolution: '  No evidence of a problem  ' });
    expect(prisma.report.update.mock.calls[0][0].data).toMatchObject({
      status: 'DISMISSED',
      resolution: 'No evidence of a problem',
      reviewedById: 'admin-1',
    });
  });
});

describe('ModerationService.listReports', () => {
  function listing(options: { reports?: unknown[]; open?: unknown[]; blocks?: unknown[]; trips?: unknown[] } = {}) {
    const reports = options.reports ?? [];
    const reportFindMany = vi
      .fn()
      .mockResolvedValueOnce(reports) // the queue itself
      .mockResolvedValueOnce(options.open ?? []); // open reports against the reported people
    const tripFindMany = vi.fn().mockResolvedValue(options.trips ?? []);
    const groupBy = vi.fn().mockResolvedValue(options.blocks ?? []);
    const service = new ModerationService(
      { report: { findMany: reportFindMany }, block: { groupBy }, trip: { findMany: tripFindMany } } as never,
      {} as never,
    );
    return { service, reportFindMany, tripFindMany, groupBy };
  }

  const row = (id: string, reportedId: string, tripId: string | null = null) => ({
    id,
    reason: 'HARASSMENT',
    details: null,
    status: 'OPEN',
    createdAt: new Date('2026-10-01'),
    tripId,
    resolution: null,
    reviewedAt: null,
    reviewedBy: null,
    reporter: { id: `reporter-of-${id}`, name: 'R', trustScore: 50 },
    reported: { id: reportedId, name: 'T', trustScore: 50, accountStatus: 'ACTIVE' },
  });

  it('defaults to the open queue — OPEN and REVIEWING — oldest first', async () => {
    const { service, reportFindMany } = listing();
    await service.listReports();
    const args = reportFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: { in: ['OPEN', 'REVIEWING'] } });
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('can show a single status instead, for history', async () => {
    const { service, reportFindMany } = listing();
    await service.listReports('DISMISSED');
    expect(reportFindMany.mock.calls[0][0].where).toEqual({ status: 'DISMISSED' });
  });

  it('does no extra lookups for an empty queue', async () => {
    const { service, reportFindMany, groupBy, tripFindMany } = listing();
    expect(await service.listReports()).toEqual([]);
    expect(reportFindMany).toHaveBeenCalledTimes(1);
    expect(groupBy).not.toHaveBeenCalled();
    expect(tripFindMany).not.toHaveBeenCalled();
  });

  it('shows how many open reports someone has, from how many different people, and how many blocked them', async () => {
    const { service } = listing({
      reports: [row('r1', 'target-1')],
      open: [
        { reportedId: 'target-1', reporterId: 'a' },
        { reportedId: 'target-1', reporterId: 'a' }, // the same person twice
        { reportedId: 'target-1', reporterId: 'b' },
      ],
      blocks: [{ blockedId: 'target-1', _count: { _all: 4 } }],
    });
    const [first] = await service.listReports();
    expect(first.context).toEqual({ openReportsAgainstThem: 3, distinctReportersAgainstThem: 2, blockedByCount: 4 });
  });

  it('reads zero context for someone with no other reports or blocks', async () => {
    const { service } = listing({ reports: [row('r1', 'target-1')] });
    expect((await service.listReports())[0].context).toEqual({
      openReportsAgainstThem: 0,
      distinctReportersAgainstThem: 0,
      blockedByCount: 0,
    });
  });

  it('attaches the trip title, or null when there is none or it has been deleted', async () => {
    const { service } = listing({
      reports: [row('r1', 't1', 'trip-1'), row('r2', 't2', 'gone'), row('r3', 't3', null)],
      trips: [{ id: 'trip-1', title: 'Spiti Trek' }],
    });
    expect((await service.listReports()).map((r) => r.tripTitle)).toEqual(['Spiti Trek', null, null]);
  });

  it('looks up each reported person once, however many reports they have', async () => {
    const { service, groupBy } = listing({ reports: [row('r1', 'same'), row('r2', 'same'), row('r3', 'other')] });
    await service.listReports();
    expect(groupBy.mock.calls[0][0].where.blockedId.in.sort()).toEqual(['other', 'same']);
  });
});

describe('ModerationService.listRestricted', () => {
  it('lists accounts that are not active, with the latest decision on each', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'u1',
        name: 'Una',
        trustScore: 40,
        accountStatus: 'SUSPENDED',
        moderationsReceived: [{ reason: 'Harassment', createdAt: new Date('2026-10-02'), actor: { id: 'a', name: 'Adi' } }],
      },
      { id: 'u2', name: 'Uma', trustScore: 50, accountStatus: 'BANNED', moderationsReceived: [] },
    ]);
    const service = new ModerationService({ user: { findMany } } as never, {} as never);
    const result = await service.listRestricted();
    expect(findMany.mock.calls[0][0].where).toEqual({ accountStatus: { not: 'ACTIVE' } });
    expect(result[0].lastDecision).toEqual({ reason: 'Harassment', createdAt: new Date('2026-10-02'), actor: { id: 'a', name: 'Adi' } });
    expect(result[1].lastDecision).toBeNull();
    expect(result[0]).not.toHaveProperty('moderationsReceived');
  });
});
