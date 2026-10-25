import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/index.js';
import { ExpensesService } from './expenses.service.js';

// The database is mocked: these cover the rules around logging, changing and
// settling expenses and who gets told, not the queries themselves (those are
// exercised against the real database by hand — see docs/ROADMAP.md).

const user = (id: string) => ({ id, name: `User ${id}`, trustScore: 50 });

type SplitRow = { id: string; userId: string; amount: number; settled: boolean };

function expenseRow(
  over: Partial<{ paidById: string; createdById: string | null; description: string; amount: number; tripId: string; splits: SplitRow[] }> = {},
) {
  const splits = over.splits ?? [
    { id: 's-alice', userId: 'alice', amount: 50, settled: false },
    { id: 's-bob', userId: 'bob', amount: 50, settled: false },
  ];
  return {
    id: 'e1',
    tripId: over.tripId ?? 't1',
    paidById: over.paidById ?? 'alice',
    createdById: over.createdById === undefined ? 'alice' : over.createdById,
    description: over.description ?? 'Dinner',
    amount: over.amount ?? 100,
    category: null,
    createdAt: new Date('2026-10-20T10:00:00Z'),
    paidBy: user(over.paidById ?? 'alice'),
    splits: splits.map((s) => ({ ...s, expenseId: 'e1', settledAt: null, user: user(s.userId) })),
  };
}

const p2025 = () => new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' });

function harness(
  options: {
    members?: string[];
    memberStatus?: string | null;
    expense?: ReturnType<typeof expenseRow> | null;
    updateError?: Error;
    deleteError?: Error;
    notifyError?: Error;
  } = {},
) {
  const members = options.members ?? ['alice', 'bob', 'carol'];
  const existing = options.expense === undefined ? expenseRow() : options.expense;
  const memberStatus = options.memberStatus === undefined ? 'APPROVED' : options.memberStatus;

  const create = vi.fn(async ({ data }: { data: Record<string, any> }) =>
    expenseRow({
      paidById: data.paidById,
      createdById: data.createdById,
      description: data.description,
      amount: data.amount,
      splits: data.splits.create.map((s: any, i: number) => ({ id: `c${i}`, userId: s.userId, amount: s.amount, settled: false })),
    }),
  );
  const update = vi.fn(async ({ data }: { data: Record<string, any> }) => {
    if (options.updateError) throw options.updateError;
    return expenseRow({
      paidById: data.paidById,
      description: data.description,
      amount: data.amount,
      splits: data.splits.create.map((s: any, i: number) => ({ id: `n${i}`, userId: s.userId, amount: s.amount, settled: false })),
    });
  });
  const del = vi.fn(async () => {
    if (options.deleteError) throw options.deleteError;
    return {};
  });
  const splitUpdate = vi.fn().mockResolvedValue({ id: 's-bob', settled: true });
  const prisma = {
    tripMembership: {
      findUnique: vi.fn().mockResolvedValue(memberStatus === null ? null : { status: memberStatus }),
      findMany: vi.fn().mockResolvedValue(members.map((userId) => ({ userId }))),
    },
    expense: {
      create,
      update,
      delete: del,
      findUnique: vi.fn().mockResolvedValue(existing),
      findMany: vi.fn().mockResolvedValue(existing ? [existing] : []),
    },
    expenseSplit: { findUnique: vi.fn(), update: splitUpdate },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Priya' }),
      findMany: vi.fn().mockResolvedValue([user('bob'), user('carol')]),
    },
  };
  const notifyUser = options.notifyError ? vi.fn().mockRejectedValue(options.notifyError) : vi.fn().mockResolvedValue(undefined);
  const service = new ExpensesService(prisma as never, { notifyUser } as never);
  const told = () => notifyUser.mock.calls.map((c) => c[0] as string).sort();
  const toldAbout = (id: string) => notifyUser.mock.calls.find((c) => c[0] === id)?.[1] as { title: string; body: string; url: string };
  return { service, prisma, create, update, del, notifyUser, told, toldAbout, splitUpdate };
}

const dto = (over: Record<string, unknown> = {}) => ({ description: 'Dinner', amount: 100, ...over }) as never;

describe('ExpensesService.create', () => {
  it('records who logged it and defaults the payer to them', async () => {
    const { service, create } = harness();
    await service.create('t1', 'alice', dto());
    expect(create.mock.calls[0][0].data).toMatchObject({ tripId: 't1', paidById: 'alice', createdById: 'alice' });
  });

  it('records the logger separately when someone else paid', async () => {
    const { service, create } = harness();
    await service.create('t1', 'alice', dto({ paidById: 'bob' }));
    expect(create.mock.calls[0][0].data).toMatchObject({ paidById: 'bob', createdById: 'alice' });
  });

  it('splits across every approved member by default, remainder to the first few', async () => {
    const { service, create } = harness();
    await service.create('t1', 'alice', dto({ amount: 100 }));
    expect(create.mock.calls[0][0].data.splits.create).toEqual([
      { userId: 'alice', amount: 34 },
      { userId: 'bob', amount: 33 },
      { userId: 'carol', amount: 33 },
    ]);
  });

  it('splits across only the people named', async () => {
    const { service, create } = harness();
    await service.create('t1', 'alice', dto({ amount: 90, splitUserIds: ['alice', 'bob'] }));
    expect(create.mock.calls[0][0].data.splits.create).toEqual([
      { userId: 'alice', amount: 45 },
      { userId: 'bob', amount: 45 },
    ]);
  });

  it('refuses someone who is not an approved member before doing anything else', async () => {
    const { service, create } = harness({ memberStatus: 'REQUESTED' });
    await expect(service.create('t1', 'alice', dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a payer who is not on the trip', async () => {
    const { service, create } = harness();
    await expect(service.create('t1', 'alice', dto({ paidById: 'stranger' }))).rejects.toThrow(/paidById must be an approved member/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses custom splits that do not add up', async () => {
    const { service } = harness();
    const splits = [{ userId: 'alice', amount: 60 }, { userId: 'bob', amount: 30 }];
    await expect(service.create('t1', 'alice', dto({ splits }))).rejects.toThrow(/splits must sum to amount/);
  });

  it('refuses custom splits that list someone twice', async () => {
    const { service } = harness();
    const splits = [{ userId: 'alice', amount: 50 }, { userId: 'alice', amount: 50 }];
    await expect(service.create('t1', 'alice', dto({ splits }))).rejects.toThrow(/same userId twice/);
  });

  it('refuses a share for someone who is not on the trip', async () => {
    const { service } = harness();
    await expect(service.create('t1', 'alice', dto({ splitUserIds: ['alice', 'stranger'] }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tells everyone involved except the person who logged it, with their share', async () => {
    const { service, told, toldAbout } = harness();
    await service.create('t1', 'alice', dto({ amount: 90, splitUserIds: ['alice', 'bob', 'carol'] }));
    expect(told()).toEqual(['bob', 'carol']);
    expect(toldAbout('bob')).toEqual({
      title: 'Expense added',
      body: 'Priya added "Dinner" (90) — your share is 30',
      url: '/trips/t1/expenses',
    });
  });

  it("tells the payer without a 'your share' line — they are owed, not owing", async () => {
    const { service, toldAbout } = harness();
    await service.create('t1', 'alice', dto({ paidById: 'bob', amount: 90, splitUserIds: ['alice', 'bob', 'carol'] }));
    expect(toldAbout('bob').body).not.toMatch(/your share/);
    expect(toldAbout('carol').body).toMatch(/your share is 30/);
  });

  it('does not fail the save when telling people fails', async () => {
    const { service } = harness({ notifyError: new Error('push service down') });
    await expect(service.create('t1', 'alice', dto())).resolves.toMatchObject({ id: 'e1' });
  });
});

describe('ExpensesService.list — whether the viewer can still change each expense', () => {
  const canChange = async (userId: string, row: ReturnType<typeof expenseRow>) => {
    const { service } = harness({ expense: row });
    return (await service.list('t1', userId))[0].canChange;
  };

  it('is true for the person who logged it and for the person who paid', async () => {
    const row = expenseRow({ paidById: 'bob', createdById: 'alice' });
    expect(await canChange('alice', row)).toBe(true);
    expect(await canChange('bob', row)).toBe(true);
  });

  it('is false for anyone else', async () => {
    expect(await canChange('carol', expenseRow({ paidById: 'bob', createdById: 'alice' }))).toBe(false);
  });

  it('asks for the people on each expense in a fixed order, so they do not shuffle after an edit or a settle', async () => {
    const { service, prisma } = harness();
    await service.list('t1', 'alice');
    expect(prisma.expense.findMany.mock.calls[0][0].include.splits.orderBy).toEqual({ id: 'asc' });
  });

  it('is false for everyone once a share is settled', async () => {
    const row = expenseRow({
      splits: [
        { id: 's1', userId: 'alice', amount: 50, settled: false },
        { id: 's2', userId: 'bob', amount: 50, settled: true },
      ],
    });
    expect(await canChange('alice', row)).toBe(false);
  });
});

describe('ExpensesService.update', () => {
  it('replaces the description, amount, payer and shares', async () => {
    const { service, update } = harness();
    await service.update('t1', 'e1', 'alice', dto({ description: 'Dinner + drinks', amount: 120, paidById: 'alice', splitUserIds: ['alice', 'bob'] }));
    expect(update.mock.calls[0][0].data).toMatchObject({
      description: 'Dinner + drinks',
      amount: 120,
      paidById: 'alice',
      splits: { deleteMany: {}, create: [{ userId: 'alice', amount: 60 }, { userId: 'bob', amount: 60 }] },
    });
  });

  it('guards the write itself, so a share marked paid in the meantime still blocks it', async () => {
    const { service, update } = harness();
    await service.update('t1', 'e1', 'alice', dto());
    expect(update.mock.calls[0][0].where).toEqual({ id: 'e1', splits: { none: { settled: true } } });
  });

  it('reports a share settled between the check and the write as a conflict', async () => {
    const { service } = harness({ updateError: p2025() });
    await expect(service.update('t1', 'e1', 'alice', dto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets any other database error through untouched', async () => {
    const boom = new Error('connection reset');
    const { service } = harness({ updateError: boom });
    await expect(service.update('t1', 'e1', 'alice', dto())).rejects.toBe(boom);
  });

  it('clears the category when the replacement leaves it out', async () => {
    const { service, update } = harness();
    await service.update('t1', 'e1', 'alice', dto());
    expect(update.mock.calls[0][0].data.category).toBeNull();
  });

  it('keeps the current payer when none is named', async () => {
    const { service, update } = harness({ expense: expenseRow({ paidById: 'bob', createdById: 'alice' }) });
    await service.update('t1', 'e1', 'alice', dto());
    expect(update.mock.calls[0][0].data.paidById).toBe('bob');
  });

  it('keeps the current people when none are named — it does not widen to the whole trip', async () => {
    const { service, update } = harness(); // alice and bob share it; carol is also on the trip
    await service.update('t1', 'e1', 'alice', dto({ amount: 80 }));
    expect(update.mock.calls[0][0].data.splits.create).toEqual([
      { userId: 'alice', amount: 40 },
      { userId: 'bob', amount: 40 },
    ]);
  });

  it('lets someone who has since left the trip stay on an expense they were already part of', async () => {
    const { service, update } = harness({ members: ['alice', 'carol'] }); // bob left
    await service.update('t1', 'e1', 'alice', dto({ amount: 80, splitUserIds: ['alice', 'bob'] }));
    expect(update.mock.calls[0][0].data.splits.create.map((s: Split) => s.userId)).toEqual(['alice', 'bob']);
  });

  it('still refuses to add someone who is not on the trip and was not already part of it', async () => {
    const { service, update } = harness({ members: ['alice', 'carol'] });
    await expect(service.update('t1', 'e1', 'alice', dto({ splitUserIds: ['alice', 'stranger'] }))).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('applies the same split rules as creating one', async () => {
    const { service } = harness();
    const splits = [{ userId: 'alice', amount: 10 }, { userId: 'bob', amount: 10 }];
    await expect(service.update('t1', 'e1', 'alice', dto({ amount: 100, splits }))).rejects.toThrow(/splits must sum/);
  });

  it('lets the payer change it even though someone else logged it, and the logger even though someone else paid', async () => {
    const row = expenseRow({ paidById: 'bob', createdById: 'alice' });
    await expect(harness({ expense: row }).service.update('t1', 'e1', 'bob', dto())).resolves.toBeDefined();
    await expect(harness({ expense: row }).service.update('t1', 'e1', 'alice', dto())).resolves.toBeDefined();
  });

  it('refuses someone who neither logged nor paid it', async () => {
    const { service, update } = harness();
    await expect(service.update('t1', 'e1', 'carol', dto())).rejects.toEqual(
      new ForbiddenException('Only the person who logged or paid for an expense can change it'),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses once a share has been marked paid', async () => {
    const settled = expenseRow({
      splits: [
        { id: 's1', userId: 'alice', amount: 50, settled: false },
        { id: 's2', userId: 'bob', amount: 50, settled: true },
      ],
    });
    const { service, update } = harness({ expense: settled });
    await expect(service.update('t1', 'e1', 'alice', dto())).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('answers "not found" for an expense that does not exist or belongs to another trip', async () => {
    await expect(harness({ expense: null }).service.update('t1', 'e1', 'alice', dto())).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness({ expense: expenseRow({ tripId: 'other-trip' }) }).service.update('t1', 'e1', 'alice', dto())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses someone who is not an approved member before looking at the expense', async () => {
    const { service, prisma } = harness({ memberStatus: null });
    await expect(service.update('t1', 'e1', 'alice', dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.expense.findUnique).not.toHaveBeenCalled();
  });

  it('tells everyone who was or is involved, except the editor — including someone dropped from it', async () => {
    const { service, told, toldAbout } = harness(); // alice paid; alice + bob shared it
    await service.update('t1', 'e1', 'alice', dto({ amount: 90, splitUserIds: ['alice', 'carol'] }));
    expect(told()).toEqual(['bob', 'carol']);
    expect(toldAbout('bob').body).toBe('Priya changed "Dinner" (90) — you are no longer part of it');
    expect(toldAbout('carol').body).toBe('Priya changed "Dinner" (90) — your share is now 45');
    expect(toldAbout('carol').title).toBe('Expense changed');
  });
});

describe('ExpensesService.remove', () => {
  it('deletes it, guarded so a share marked paid in the meantime still blocks it', async () => {
    const { service, del } = harness();
    await service.remove('t1', 'e1', 'alice');
    expect(del).toHaveBeenCalledWith({ where: { id: 'e1', splits: { none: { settled: true } } } });
  });

  it('reports a share settled between the check and the delete as a conflict', async () => {
    const { service } = harness({ deleteError: p2025() });
    await expect(service.remove('t1', 'e1', 'alice')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses someone who neither logged nor paid it', async () => {
    const { service, del } = harness();
    await expect(service.remove('t1', 'e1', 'carol')).rejects.toBeInstanceOf(ForbiddenException);
    expect(del).not.toHaveBeenCalled();
  });

  it('refuses once a share has been marked paid', async () => {
    const settled = expenseRow({ splits: [{ id: 's1', userId: 'alice', amount: 50, settled: false }, { id: 's2', userId: 'bob', amount: 50, settled: true }] });
    const { service, del } = harness({ expense: settled });
    await expect(service.remove('t1', 'e1', 'alice')).rejects.toBeInstanceOf(ConflictException);
    expect(del).not.toHaveBeenCalled();
  });

  it('answers "not found" for an expense on another trip', async () => {
    const { service } = harness({ expense: expenseRow({ tripId: 'other-trip' }) });
    await expect(service.remove('t1', 'e1', 'alice')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tells everyone involved except the person who removed it', async () => {
    const { service, told, toldAbout } = harness();
    await service.remove('t1', 'e1', 'alice');
    expect(told()).toEqual(['bob']);
    expect(toldAbout('bob')).toEqual({ title: 'Expense removed', body: 'Priya removed "Dinner" (100)', url: '/trips/t1/expenses' });
  });

  it('tells nobody if the delete failed', async () => {
    const { service, notifyUser } = harness({ deleteError: p2025() });
    await expect(service.remove('t1', 'e1', 'alice')).rejects.toBeInstanceOf(ConflictException);
    expect(notifyUser).not.toHaveBeenCalled();
  });
});

describe('ExpensesService.settleSplit', () => {
  function settling(over: { splitUserId?: string; paidById?: string; settled?: boolean; tripId?: string } = {}) {
    const h = harness();
    const split = {
      id: 's-bob',
      expenseId: 'e1',
      userId: over.splitUserId ?? 'bob',
      amount: 50,
      settled: over.settled ?? false,
      expense: { id: 'e1', tripId: over.tripId ?? 't1', paidById: over.paidById ?? 'alice', description: 'Dinner' },
    };
    h.prisma.expenseSplit.findUnique.mockResolvedValue(split);
    return h;
  }

  it('lets the debtor mark it paid, and tells the payer', async () => {
    const { service, splitUpdate, told, toldAbout } = settling();
    await service.settleSplit('t1', 'e1', 's-bob', 'bob');
    expect(splitUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ settled: true }) }));
    expect(told()).toEqual(['alice']);
    expect(toldAbout('alice')).toEqual({
      title: 'Share marked as paid',
      body: 'Priya marked their share (50) of "Dinner" as paid',
      url: '/trips/t1/expenses',
    });
  });

  it('lets the payer mark it paid, and tells the debtor', async () => {
    const { service, told, toldAbout } = settling();
    await service.settleSplit('t1', 'e1', 's-bob', 'alice');
    expect(told()).toEqual(['bob']);
    expect(toldAbout('bob').body).toBe('Priya marked your share (50) of "Dinner" as paid');
  });

  it('refuses a third person', async () => {
    const { service, splitUpdate } = settling();
    await expect(service.settleSplit('t1', 'e1', 's-bob', 'carol')).rejects.toBeInstanceOf(ForbiddenException);
    expect(splitUpdate).not.toHaveBeenCalled();
  });

  it("refuses to settle the payer's own share — it is owed to no one, and would lock the expense for nothing", async () => {
    const { service, splitUpdate } = settling({ splitUserId: 'alice', paidById: 'alice' });
    await expect(service.settleSplit('t1', 'e1', 's-bob', 'alice')).rejects.toBeInstanceOf(BadRequestException);
    expect(splitUpdate).not.toHaveBeenCalled();
  });

  it('refuses a split that is already settled', async () => {
    const { service } = settling({ settled: true });
    await expect(service.settleSplit('t1', 'e1', 's-bob', 'bob')).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers "not found" for a split on another trip', async () => {
    const { service } = settling({ tripId: 'other-trip' });
    await expect(service.settleSplit('t1', 'e1', 's-bob', 'bob')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ExpensesService.balances', () => {
  const scenario = () => {
    const h = harness();
    h.prisma.expense.findMany.mockResolvedValue([
      // alice paid 90 for all three: bob and carol each owe her 30; her own share is not a debt
      { paidById: 'alice', splits: [{ userId: 'alice', amount: 30, settled: false }, { userId: 'bob', amount: 30, settled: false }, { userId: 'carol', amount: 30, settled: false }] },
      // bob paid 40 for him and alice: alice owes bob 20
      { paidById: 'bob', splits: [{ userId: 'bob', amount: 20, settled: false }, { userId: 'alice', amount: 20, settled: false }] },
      // carol's share of a third was already settled
      { paidById: 'alice', splits: [{ userId: 'alice', amount: 10, settled: false }, { userId: 'carol', amount: 10, settled: true }] },
    ]);
    return h;
  };

  it("nets each pair from the caller's side and ignores settled shares and the payer's own", async () => {
    const { service } = scenario();
    const result = await service.balances('t1', 'alice');
    const byId = Object.fromEntries(result.balances.map((b) => [b.counterpart!.id, b.netAmount]));
    expect(byId).toEqual({ bob: 10, carol: 30 }); // bob owes 30 but alice owes bob 20
    expect(result.totalOwedToYou).toBe(40);
    expect(result.totalYouOwe).toBe(0);
  });

  it('shows the other side of the same debts', async () => {
    const { service } = scenario();
    const result = await service.balances('t1', 'bob');
    expect(result.balances.map((b) => b.netAmount)).toEqual([-10]);
    expect(result.totalYouOwe).toBe(10);
  });
});

type Split = { userId: string; amount: number };
