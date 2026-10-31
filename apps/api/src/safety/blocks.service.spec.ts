import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlocksService } from './blocks.service.js';

// The database is mocked: these cover what a block does and to whom. That the
// queries really behave that way is checked against the real database by hand
// (docs/ROADMAP.md).

function harness(options: { targetExists?: boolean; blocks?: Array<{ blockerId: string; blockedId: string }>; count?: number } = {}) {
  const upsert = vi.fn().mockReturnValue('upsert-op');
  const deleteMany = vi.fn().mockReturnValue('deleteMany-op');
  const threadDeleteMany = vi.fn().mockReturnValue('thread-op');
  const blockDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const transaction = vi.fn().mockResolvedValue([]);
  const blockFindMany = vi.fn().mockResolvedValue(options.blocks ?? []);
  const count = vi.fn().mockResolvedValue(options.count ?? 0);
  const service = new BlocksService({
    user: { findUnique: vi.fn().mockResolvedValue(options.targetExists === false ? null : { id: 'target' }) },
    block: { upsert, findMany: blockFindMany, count, deleteMany: blockDeleteMany },
    tripMembership: { deleteMany },
    directThread: { deleteMany: threadDeleteMany },
    $transaction: transaction,
  } as never);
  return { service, upsert, deleteMany, threadDeleteMany, blockDeleteMany, transaction, blockFindMany, count };
}

describe('BlocksService.blockedWith', () => {
  it('is symmetric: includes people I blocked and people who blocked me', async () => {
    const { service } = harness({
      blocks: [
        { blockerId: 'me', blockedId: 'blocked-by-me' },
        { blockerId: 'blocked-me', blockedId: 'me' },
      ],
    });
    expect([...(await service.blockedWith('me'))].sort()).toEqual(['blocked-by-me', 'blocked-me']);
  });

  it('is empty when there are no blocks', async () => {
    const { service } = harness();
    expect((await service.blockedWith('me')).size).toBe(0);
  });

  it('looks in both directions', async () => {
    const { service, blockFindMany } = harness();
    await service.blockedWith('me');
    expect(blockFindMany.mock.calls[0][0].where).toEqual({ OR: [{ blockerId: 'me' }, { blockedId: 'me' }] });
  });
});

describe('BlocksService.areBlocked', () => {
  it('is true when a block exists in either direction', async () => {
    const { service, count } = harness({ count: 1 });
    expect(await service.areBlocked('a', 'b')).toBe(true);
    expect(count.mock.calls[0][0].where).toEqual({
      OR: [
        { blockerId: 'a', blockedId: 'b' },
        { blockerId: 'b', blockedId: 'a' },
      ],
    });
  });

  it('is false when there is none', async () => {
    const { service } = harness({ count: 0 });
    expect(await service.areBlocked('a', 'b')).toBe(false);
  });
});

describe('BlocksService.block', () => {
  it("can't block yourself", async () => {
    const { service, transaction } = harness();
    await expect(service.block('me', 'me')).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses a user who does not exist', async () => {
    const { service, transaction } = harness({ targetExists: false });
    await expect(service.block('me', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('records the block idempotently, so blocking twice is harmless', async () => {
    const { service, upsert } = harness();
    await service.block('me', 'target');
    expect(upsert).toHaveBeenCalledWith({
      where: { blockerId_blockedId: { blockerId: 'me', blockedId: 'target' } },
      create: { blockerId: 'me', blockedId: 'target' },
      update: {},
    });
  });

  it('withdraws pending requests between the two, in whichever direction, and only pending ones', async () => {
    const { service, deleteMany } = harness();
    await service.block('me', 'target');
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        status: 'REQUESTED',
        OR: [
          { userId: 'target', trip: { hostId: 'me' } },
          { userId: 'me', trip: { hostId: 'target' } },
        ],
      },
    });
  });

  it('does both in one transaction, so a block never exists half-applied', async () => {
    const { service, transaction } = harness();
    await service.block('me', 'target');
    expect(transaction).toHaveBeenCalledWith(['upsert-op', 'deleteMany-op', 'thread-op']);
  });

  it('deletes the private chat between the two, whichever of them asked, so no history survives a block', async () => {
    const { service, threadDeleteMany } = harness();
    await service.block('me', 'target');
    expect(threadDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userLowId: 'me', userHighId: 'target' },
          { userLowId: 'target', userHighId: 'me' },
        ],
      },
    });
  });
});

describe('BlocksService.unblock', () => {
  it("removes only the caller's own block", async () => {
    const { service, blockDeleteMany } = harness();
    await service.unblock('me', 'target');
    expect(blockDeleteMany).toHaveBeenCalledWith({ where: { blockerId: 'me', blockedId: 'target' } });
  });
});

describe('BlocksService.listMine', () => {
  it('lists the people the caller blocked, and never who blocked them', async () => {
    const when = new Date('2026-10-01T00:00:00Z');
    const { service, blockFindMany } = harness({
      blocks: [{ createdAt: when, blocked: { id: 'u1', name: 'Una' } }] as never,
    });
    expect(await service.listMine('me')).toEqual([{ user: { id: 'u1', name: 'Una' }, createdAt: when }]);
    expect(blockFindMany.mock.calls[0][0].where).toEqual({ blockerId: 'me' });
  });
});
