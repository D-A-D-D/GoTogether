import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AccountService } from './account.service.js';

// The database is mocked: these cover the rules around deleting an account and
// what an export contains, not the queries (those are exercised against the
// real database by hand - see docs/ROADMAP.md).

const passwordHash = bcrypt.hashSync('right-password', 4);

function harness(
  options: {
    user?: { id: string; email: string; passwordHash: string | null; accountStatus: string } | null;
    unfinishedTrips?: number;
  } = {},
) {
  const user =
    options.user === undefined
      ? { id: 'u1', email: 'una@example.com', passwordHash, accountStatus: 'ACTIVE' }
      : options.user;

  // Each model method returns a tagged value so the transaction's contents (and order) can be read back.
  const op = (name: string) => vi.fn((args?: unknown) => ({ op: name, args }));
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user), update: op('user.update') },
    trip: { count: vi.fn().mockResolvedValue(options.unfinishedTrips ?? 0), updateMany: op('trip.updateMany') },
    tripMembership: { updateMany: op('tripMembership.updateMany'), deleteMany: op('tripMembership.deleteMany') },
    pushSubscription: { deleteMany: op('pushSubscription.deleteMany') },
    refreshToken: { deleteMany: op('refreshToken.deleteMany') },
    oAuthAccount: { deleteMany: op('oAuthAccount.deleteMany') },
    block: { deleteMany: op('block.deleteMany') },
    trustScoreEvent: { deleteMany: op('trustScoreEvent.deleteMany') },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const invalidate = vi.fn();
  const service = new AccountService(prisma as never, { invalidate } as never);
  const ran = () => (prisma.$transaction.mock.calls[0]?.[0] as Array<{ op: string; args: any }> | undefined) ?? [];
  return { service, prisma, invalidate, ran };
}

describe('AccountService.deleteAccount — proving it is them', () => {
  it('goes ahead with the right password', async () => {
    const { service, prisma } = harness();
    await expect(service.deleteAccount('u1', { password: 'right-password' })).resolves.toEqual({ deleted: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([[{}], [{ password: 'wrong-password' }], [{ password: '' }], [{ confirmEmail: 'una@example.com' }]])(
    'refuses %j for an account that has a password, and changes nothing',
    async (dto) => {
      const { service, prisma } = harness();
      await expect(service.deleteAccount('u1', dto)).rejects.toEqual(new ForbiddenException('That password is not correct'));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('for an account with no password (signed up with Google), asks for the email instead', async () => {
    const { service, prisma } = harness({ user: { id: 'u1', email: 'una@example.com', passwordHash: null, accountStatus: 'ACTIVE' } });
    await expect(service.deleteAccount('u1', { confirmEmail: ' UNA@Example.com ' })).resolves.toEqual({ deleted: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([[{}], [{ confirmEmail: 'someone-else@example.com' }], [{ password: 'anything' }]])(
    'refuses %j for an account with no password',
    async (dto) => {
      const { service, prisma } = harness({ user: { id: 'u1', email: 'una@example.com', passwordHash: null, accountStatus: 'ACTIVE' } });
      await expect(service.deleteAccount('u1', dto)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['SUSPENDED', 'BANNED', 'DELETED'])('does nothing for an account that is %s, or one that no longer exists', async (status) => {
    const restricted = harness({ user: { id: 'u1', email: 'una@example.com', passwordHash, accountStatus: status } });
    await expect(restricted.service.deleteAccount('u1', { password: 'right-password' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(restricted.prisma.$transaction).not.toHaveBeenCalled();

    const missing = harness({ user: null });
    await expect(missing.service.deleteAccount('u1', { password: 'right-password' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AccountService.deleteAccount — hosting', () => {
  it('is refused while the person hosts a trip that has not finished, with a message that says what to do', async () => {
    const { service, prisma } = harness({ unfinishedTrips: 2 });
    await expect(service.deleteAccount('u1', { password: 'right-password' })).rejects.toEqual(
      new ConflictException('You still host 2 trips that have not finished. Cancel or complete them first, then delete your account.'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('looks only at trips that have not finished', async () => {
    const { service, prisma } = harness();
    await service.deleteAccount('u1', { password: 'right-password' });
    const where = prisma.trip.count.mock.calls[0][0].where;
    expect(where.hostId).toBe('u1');
    expect([...where.status.in].sort()).toEqual(['DRAFT', 'FULL', 'ONGOING', 'OPEN']);
  });

  it('checks the password before saying anything about their trips', async () => {
    const { service, prisma } = harness({ unfinishedTrips: 1 });
    await expect(service.deleteAccount('u1', { password: 'wrong-password' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.trip.count).not.toHaveBeenCalled();
  });
});

describe('AccountService.deleteAccount — what it does', () => {
  const run = async () => {
    const h = harness();
    await h.service.deleteAccount('u1', { password: 'right-password' });
    return h;
  };
  const find = (ran: Array<{ op: string; args: any }>, name: string) => ran.find((o) => o.op === name)!;

  it('does everything in one transaction, or nothing', async () => {
    const { prisma, ran } = await run();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ran().map((o) => o.op)).toEqual([
      'trip.updateMany',
      'tripMembership.updateMany',
      'tripMembership.deleteMany',
      'pushSubscription.deleteMany',
      'refreshToken.deleteMany',
      'oAuthAccount.deleteMany',
      'block.deleteMany',
      'trustScoreEvent.deleteMany',
      'user.update',
    ]);
  });

  it('reopens a full trip they were on, before giving up their place', async () => {
    const { ran } = await run();
    const ops = ran().map((o) => o.op);
    expect(ops.indexOf('trip.updateMany')).toBeLessThan(ops.indexOf('tripMembership.updateMany'));
    const reopen = find(ran(), 'trip.updateMany').args;
    expect(reopen.where).toMatchObject({ status: 'FULL', memberships: { some: { userId: 'u1', role: 'MEMBER', status: 'APPROVED' } } });
    expect(reopen.data).toEqual({ status: 'OPEN' });
  });

  it('gives up their place on trips still open or under way, never on finished ones, and never as host', async () => {
    const { ran } = await run();
    const { where, data } = find(ran(), 'tripMembership.updateMany').args;
    expect(where).toMatchObject({ userId: 'u1', role: 'MEMBER', status: 'APPROVED' });
    expect([...where.trip.status.in].sort()).toEqual(['FULL', 'ONGOING', 'OPEN']);
    expect(data.status).toBe('LEFT');
    expect(data.leftAt).toBeInstanceOf(Date);
  });

  it('withdraws their pending requests', async () => {
    const { ran } = await run();
    expect(find(ran(), 'tripMembership.deleteMany').args.where).toEqual({ userId: 'u1', status: 'REQUESTED' });
  });

  it('removes their sessions, device notifications, Google link, blocks in both directions and trust history', async () => {
    const { ran } = await run();
    expect(find(ran(), 'pushSubscription.deleteMany').args.where).toEqual({ userId: 'u1' });
    expect(find(ran(), 'refreshToken.deleteMany').args.where).toEqual({ userId: 'u1' });
    expect(find(ran(), 'oAuthAccount.deleteMany').args.where).toEqual({ userId: 'u1' });
    expect(find(ran(), 'trustScoreEvent.deleteMany').args.where).toEqual({ userId: 'u1' });
    expect(find(ran(), 'block.deleteMany').args.where).toEqual({ OR: [{ blockerId: 'u1' }, { blockedId: 'u1' }] });
  });

  it('anonymises the account row, clears their interests, and keeps the row', async () => {
    const { ran, prisma } = await run();
    const update = find(ran(), 'user.update').args;
    expect(update.where).toEqual({ id: 'u1' });
    expect(update.data).toMatchObject({
      name: 'Deleted user',
      email: 'deleted-u1@deleted.invalid',
      passwordHash: null,
      accountStatus: 'DELETED',
      bio: null,
      homeLat: null,
      preferenceTags: { set: [] },
    });
    expect(update.data.deletedAt).toBeInstanceOf(Date);
    // Messages, expenses and reviews in other people's trips point at this row, so it must survive.
    expect((prisma as any).user.delete).toBeUndefined();
  });

  it('takes effect at once on this instance, not when the cache expires', async () => {
    const { invalidate } = await run();
    expect(invalidate).toHaveBeenCalledWith('u1');
  });

  it('does not touch the cache if the transaction failed', async () => {
    const { service, prisma, invalidate } = harness();
    prisma.$transaction.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.deleteAccount('u1', { password: 'right-password' })).rejects.toThrow('connection lost');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('AccountService.exportData', () => {
  function exporting(overrides: Record<string, unknown> = {}) {
    // One mock per model, so each test reads its own query back.
    const empty = () => vi.fn().mockResolvedValue([]);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(
          overrides.user === undefined
            ? { id: 'u1', email: 'una@example.com', name: 'Una', bio: 'hi', homeCity: 'Pune', homeRegion: 'MH', trustScore: 52, verificationTier: 'EMAIL', createdAt: new Date('2026-09-01'), preferenceTags: [{ name: 'Foodie', category: 'STYLE' }] }
            : overrides.user,
        ),
      },
      trip: { findMany: empty() },
      tripMembership: { findMany: empty() },
      message: { findMany: vi.fn().mockResolvedValue((overrides.messages as unknown[]) ?? []) },
      expense: { findMany: vi.fn().mockResolvedValue((overrides.expenses as unknown[]) ?? []) },
      review: { findMany: vi.fn().mockImplementation(async (args: any) => (args.where.reviewerId ? (overrides.given as unknown[]) ?? [] : (overrides.received as unknown[]) ?? [])) },
      trustScoreEvent: { findMany: empty() },
      report: { findMany: empty() },
      block: { findMany: empty() },
      pushSubscription: { count: vi.fn().mockResolvedValue(2) },
    };
    return { service: new AccountService(prisma as never, {} as never), prisma };
  }

  it('answers "not found" for an account that does not exist', async () => {
    const { service } = exporting({ user: null });
    await expect(service.exportData('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never selects the password hash, the private geocode, or the role', async () => {
    const { service, prisma } = exporting();
    await service.exportData('u1');
    const select = prisma.user.findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('passwordHash');
    expect(select).not.toHaveProperty('homeLat');
    expect(select).not.toHaveProperty('homeLng');
    expect(select).not.toHaveProperty('role');
    expect(select.homeCity).toBe(true);
  });

  it('includes reviews about them only once revealed — the blind window holds for exports too', async () => {
    const { service, prisma } = exporting();
    await service.exportData('u1');
    const receivedCall = prisma.review.findMany.mock.calls.map((c) => c[0]).find((a: any) => a.where.revieweeId);
    expect(receivedCall.where).toEqual({ revieweeId: 'u1', processedAt: { not: null } });
  });

  it('includes every review they wrote, revealed or not — it is their own writing', async () => {
    const { service, prisma } = exporting();
    await service.exportData('u1');
    const givenCall = prisma.review.findMany.mock.calls.map((c) => c[0]).find((a: any) => a.where.reviewerId);
    expect(givenCall.where).toEqual({ reviewerId: 'u1' });
  });

  it('shows only their own share of an expense, never the other people\'s', async () => {
    const { service, prisma } = exporting({
      expenses: [
        { id: 'e1', tripId: 't1', description: 'Dinner', amount: 90, category: null, createdAt: new Date(), paidById: 'u2', createdById: 'u1', paidBy: { name: 'Raj' }, splits: [{ amount: 30, settled: false, settledAt: null }] },
      ],
    });
    const result = await service.exportData('u1');
    expect(prisma.expense.findMany.mock.calls[0][0].include.splits.where).toEqual({ userId: 'u1' });
    expect(result.expenses[0]).toMatchObject({ description: 'Dinner', amount: 90, paidBy: 'Raj', youPaid: false, youLogged: true, yourShare: { amount: 30, settled: false } });
  });

  it('reports a person has no share in an expense they only paid for', async () => {
    const { service } = exporting({
      expenses: [{ id: 'e1', tripId: 't1', description: 'Taxi', amount: 60, category: null, createdAt: new Date(), paidById: 'u1', createdById: 'u1', paidBy: { name: 'Una' }, splits: [] }],
    });
    const result = await service.exportData('u1');
    expect(result.expenses[0]).toMatchObject({ youPaid: true, yourShare: null });
  });

  it('lists only the messages they sent, with the trip they were in', async () => {
    const { service, prisma } = exporting({ messages: [{ content: 'hello', createdAt: new Date('2026-10-01'), room: { tripId: 't1' } }] });
    const result = await service.exportData('u1');
    expect(prisma.message.findMany.mock.calls[0][0].where).toEqual({ senderId: 'u1' });
    expect(result.messages).toEqual([{ tripId: 't1', content: 'hello', sentAt: new Date('2026-10-01') }]);
  });

  it('only reports they filed — never ones about them', async () => {
    const { service, prisma } = exporting();
    await service.exportData('u1');
    expect(prisma.report.findMany.mock.calls[0][0].where).toEqual({ reporterId: 'u1' });
  });

  it('only blocks they made', async () => {
    const { service, prisma } = exporting();
    await service.exportData('u1');
    expect(prisma.block.findMany.mock.calls[0][0].where).toEqual({ blockerId: 'u1' });
  });

  it('has the shape a person would expect, and explains what it leaves out', async () => {
    const { service } = exporting();
    const result = await service.exportData('u1');
    expect(Object.keys(result).sort()).toEqual(
      [
        'account', 'devicesReceivingNotifications', 'exportedAt', 'expenses', 'hostedTrips', 'memberships', 'messages',
        'notes', 'peopleYouBlocked', 'reportsYouFiled', 'reviewsAboutYou', 'reviewsYouWrote', 'trustScoreHistory',
      ].sort(),
    );
    expect(result.account).toMatchObject({ email: 'una@example.com', name: 'Una', preferenceTags: [{ name: 'Foodie', category: 'STYLE' }] });
    expect(result.devicesReceivingNotifications).toBe(2);
    expect(result.notes.join(' ')).toMatch(/blind|revealed/i);
  });
});
