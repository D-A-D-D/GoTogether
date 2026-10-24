import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatService } from './chat.service.js';

// The database is mocked: these cover how history is paged — the ordering,
// and which cursors are accepted. That paging really tiles a conversation is
// checked against the real database by hand (docs/ROADMAP.md).

function harness(options: { approved?: boolean; cursorExists?: boolean } = {}) {
  const findMany = vi.fn().mockResolvedValue([
    { id: 'm3', content: 'newest', sender: { id: 'u', name: 'U' } },
    { id: 'm2', content: 'middle', sender: { id: 'u', name: 'U' } },
    { id: 'm1', content: 'oldest', sender: { id: 'u', name: 'U' } },
  ]);
  const findFirst = vi.fn().mockResolvedValue(options.cursorExists === false ? null : { id: 'm2' });
  const service = new ChatService(
    {
      tripMembership: {
        findUnique: vi.fn().mockResolvedValue({ status: options.approved === false ? 'REQUESTED' : 'APPROVED' }),
      },
      chatRoom: { findUnique: vi.fn().mockResolvedValue({ id: 'room-1' }) },
      message: { findMany, findFirst },
    } as never,
    {} as never,
  );
  return { service, findMany, findFirst };
}

describe('ChatService.listMessages', () => {
  it('is for approved members only', async () => {
    const { service, findMany } = harness({ approved: false });
    await expect(service.listMessages('trip-1', 'user-1', undefined, 50)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns a page oldest-first', async () => {
    const { service } = harness();
    const page = await service.listMessages('trip-1', 'user-1', undefined, 50);
    expect(page.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('orders by time and then by id, so messages sharing a timestamp have a defined order', async () => {
    const { service, findMany } = harness();
    await service.listMessages('trip-1', 'user-1', undefined, 50);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('asks for the latest page with no cursor and no cursor lookup', async () => {
    const { service, findMany, findFirst } = harness();
    await service.listMessages('trip-1', 'user-1', undefined, 30);
    const args = findMany.mock.calls[0][0];
    expect(args.take).toBe(30);
    expect(args.cursor).toBeUndefined();
    expect(args.skip).toBeUndefined();
    expect(args.where).toEqual({ roomId: 'room-1' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('pages back from the cursor message, skipping the cursor itself', async () => {
    const { service, findMany } = harness();
    await service.listMessages('trip-1', 'user-1', 'm2', 50);
    const args = findMany.mock.calls[0][0];
    expect(args.cursor).toEqual({ id: 'm2' });
    expect(args.skip).toBe(1);
  });

  it("only accepts a cursor that is a message in this trip's room", async () => {
    const { service, findFirst } = harness();
    await service.listMessages('trip-1', 'user-1', 'm2', 50);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'm2', roomId: 'room-1' }, select: { id: true } });
  });

  it('rejects a cursor that is not in the room, rather than erroring or using it as a marker', async () => {
    const { service, findMany } = harness({ cursorExists: false });
    await expect(service.listMessages('trip-1', 'user-1', 'someone-elses-message', 50)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});
