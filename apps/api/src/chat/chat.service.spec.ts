import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service.js';

// The database is mocked: these cover how history is paged — the ordering,
// and which cursors are accepted. That paging really tiles a conversation is
// checked against the real database by hand (docs/ROADMAP.md).

function harness(options: { approved?: boolean; cursorExists?: boolean; hidden?: string[] } = {}) {
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
    { blockedWith: vi.fn().mockResolvedValue(new Set(options.hidden ?? [])) } as never,
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

describe('ChatService — blocks', () => {
  it('leaves out messages from anyone blocked with the reader', async () => {
    const { service, findMany } = harness({ hidden: ['blocked-1', 'blocked-2'] });
    await service.listMessages('trip-1', 'user-1', undefined, 50);
    expect(findMany.mock.calls[0][0].where).toEqual({
      roomId: 'room-1',
      senderId: { notIn: ['blocked-1', 'blocked-2'] },
    });
  });

  it('adds no sender filter when nobody is blocked', async () => {
    const { service, findMany } = harness();
    await service.listMessages('trip-1', 'user-1', undefined, 50);
    expect(findMany.mock.calls[0][0].where).toEqual({ roomId: 'room-1' });
  });

  it("does not push a message to someone who is blocked with the sender", async () => {
    const notifyUsers = vi.fn().mockResolvedValue(undefined);
    const service = new ChatService(
      { tripMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'friend' }, { userId: 'blocked-one' }]) } } as never,
      { notifyUsers } as never,
      {} as never,
    );
    await service.notifyOthers('trip-1', { senderId: 'sender', content: 'hello', sender: { name: 'Sam' } }, new Set(['blocked-one']));
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers.mock.calls[0][0]).toEqual(['friend']);
  });

  it('notifies other approved members only - never the sender - with the sender as the title', async () => {
    const notifyUsers = vi.fn().mockResolvedValue(undefined);
    const findMany = vi.fn().mockResolvedValue([{ userId: 'a' }]);
    const service = new ChatService({ tripMembership: { findMany } } as never, { notifyUsers } as never, {} as never);
    await service.notifyOthers('trip-9', { senderId: 'sender', content: 'hello', sender: { name: 'Sam' } }, new Set());
    expect(findMany.mock.calls[0][0].where).toEqual({ tripId: 'trip-9', status: 'APPROVED', userId: { not: 'sender' } });
    expect(notifyUsers).toHaveBeenCalledWith(['a'], { title: 'Sam', body: 'hello', url: '/trips/trip-9/chat' });
  });

  it('cuts a long message short in the notification', async () => {
    const notifyUsers = vi.fn().mockResolvedValue(undefined);
    const service = new ChatService({ tripMembership: { findMany: vi.fn().mockResolvedValue([{ userId: 'a' }]) } } as never, { notifyUsers } as never, {} as never);
    await service.notifyOthers('t', { senderId: 's', content: 'x'.repeat(200), sender: { name: 'Sam' } }, new Set());
    expect(notifyUsers.mock.calls[0][1].body).toBe(`${'x'.repeat(80)}…`);
  });
});

describe('ChatService.createMessage', () => {
  function build(options: { status?: string | null; room?: boolean } = {}) {
    const create = vi.fn().mockResolvedValue({ id: 'm1', roomId: 'room-1', senderId: 'sender', content: 'hello', createdAt: new Date() });
    const notifyUsers = vi.fn();
    const service = new ChatService(
      {
        tripMembership: {
          findUnique: vi.fn().mockResolvedValue(options.status === null ? null : { status: options.status ?? 'APPROVED' }),
        },
        chatRoom: { findUnique: vi.fn().mockResolvedValue(options.room === false ? null : { id: 'room-1' }) },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'sender', name: 'Sam' }) },
        message: { create },
      } as never,
      { notifyUsers } as never,
      {} as never,
    );
    return { service, create, notifyUsers };
  }

  it('saves the message in the room of that trip, as the sender', async () => {
    const { service, create } = build();
    await service.createMessage('trip-1', 'sender', 'hello');
    expect(create.mock.calls[0][0].data).toEqual({ roomId: 'room-1', senderId: 'sender', content: 'hello', kind: 'TEXT', mediaId: null });
  });

  it('returns the saved message with its sender, without asking the insert to read it back', async () => {
    const { service, create } = build();
    const message = await service.createMessage('trip-1', 'sender', 'hello');
    expect(message.sender).toEqual({ id: 'sender', name: 'Sam' });
    expect(message.content).toBe('hello');
    expect(create.mock.calls[0][0]).not.toHaveProperty('include');
  });

  it('refuses someone who is not an approved member, and saves nothing', async () => {
    for (const status of [null, 'REQUESTED', 'LEFT', 'REMOVED']) {
      const { service, create } = build({ status });
      await expect(service.createMessage('trip-1', 'sender', 'hi')).rejects.toBeInstanceOf(ForbiddenException);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('says "not a member", not "no room", when both are true - nothing is revealed to an outsider', async () => {
    const { service } = build({ status: null, room: false });
    await expect(service.createMessage('trip-1', 'sender', 'hi')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports a missing chat room for a member', async () => {
    const { service } = build({ room: false });
    await expect(service.createMessage('trip-1', 'sender', 'hi')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sends no notification itself: that is done afterwards, so it cannot hold up the chat', async () => {
    const { service, notifyUsers } = build();
    await service.createMessage('trip-1', 'sender', 'hello');
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe('ChatService.createMessage - pictures and voice notes', () => {
  const file = (over: Record<string, unknown> = {}) => ({
    id: 'media-1',
    mime: 'image/jpeg',
    size: 1000,
    width: 800,
    height: 600,
    durationMs: null,
    ownerId: 'sender',
    tripId: 'trip-1',
    kind: 'CHAT_IMAGE',
    message: null,
    ...over,
  });

  function build(media: Record<string, unknown> | null) {
    const create = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data, createdAt: new Date() }));
    const service = new ChatService(
      {
        tripMembership: { findUnique: vi.fn().mockResolvedValue({ status: 'APPROVED' }) },
        chatRoom: { findUnique: vi.fn().mockResolvedValue({ id: 'room-1' }) },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'sender', name: 'Sam', avatarUpdatedAt: null }) },
        media: { findUnique: vi.fn().mockResolvedValue(media) },
        message: { create },
      } as never,
      {} as never,
      {} as never,
    );
    const mediaFindUnique = (service as unknown as { prisma: { media: { findUnique: ReturnType<typeof vi.fn> } } }).prisma.media.findUnique;
    return { service, create, mediaFindUnique };
  }

  it('sends a picture with a caption, attached to the uploaded file, and tells the client about it', async () => {
    const { service, create } = build(file());
    const message = await service.createMessage('trip-1', 'sender', '  the fort  ', { kind: 'IMAGE', mediaId: 'media-1' });
    expect(create.mock.calls[0][0].data).toEqual({ roomId: 'room-1', senderId: 'sender', content: 'the fort', kind: 'IMAGE', mediaId: 'media-1' });
    expect(message.media).toEqual({ id: 'media-1', mime: 'image/jpeg', size: 1000, width: 800, height: 600, durationMs: null });
    expect(message.sender).toEqual({ id: 'sender', name: 'Sam', avatarUpdatedAt: null });
  });

  it('sends a voice note with no text, whatever text came with it', async () => {
    const { service, create } = build(file({ kind: 'CHAT_VOICE', mime: 'audio/webm', width: null, height: null, durationMs: 4200 }));
    const message = await service.createMessage('trip-1', 'sender', 'ignored', { kind: 'VOICE', mediaId: 'media-1' });
    expect(create.mock.calls[0][0].data).toMatchObject({ content: '', kind: 'VOICE' });
    expect(message.media?.durationMs).toBe(4200);
  });

  it('refuses a file that someone else uploaded', async () => {
    const { service, create } = build(file({ ownerId: 'someone-else' }));
    await expect(service.createMessage('trip-1', 'sender', '', { kind: 'IMAGE', mediaId: 'media-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a file uploaded for a different trip', async () => {
    const { service, create } = build(file({ tripId: 'trip-OTHER' }));
    await expect(service.createMessage('trip-1', 'sender', '', { kind: 'IMAGE', mediaId: 'media-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a picture sent as a voice note and the other way round', async () => {
    await expect(build(file()).service.createMessage('trip-1', 'sender', '', { kind: 'VOICE', mediaId: 'media-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build(file({ kind: 'CHAT_VOICE' })).service.createMessage('trip-1', 'sender', '', { kind: 'IMAGE', mediaId: 'media-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a profile picture, and a file already sent in another message', async () => {
    await expect(build(file({ kind: 'AVATAR' })).service.createMessage('trip-1', 'sender', '', { kind: 'IMAGE', mediaId: 'media-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build(file({ message: { id: 'earlier' } })).service.createMessage('trip-1', 'sender', '', { kind: 'IMAGE', mediaId: 'media-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a file that does not exist', async () => {
    await expect(build(null).service.createMessage('trip-1', 'sender', '', { kind: 'IMAGE', mediaId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a picture or voice note with no file, and text with a file, and empty text', async () => {
    const { service, create } = build(file());
    await expect(service.createMessage('trip-1', 'sender', 'hi', { kind: 'IMAGE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createMessage('trip-1', 'sender', '', { kind: 'VOICE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createMessage('trip-1', 'sender', 'hi', { kind: 'TEXT', mediaId: 'media-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createMessage('trip-1', 'sender', '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not look up a file for an ordinary text message', async () => {
    const { service, mediaFindUnique, create } = build(null);
    await service.createMessage('trip-1', 'sender', 'hello');
    expect(mediaFindUnique).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('ChatService.markRead', () => {
  function build(options: { membership?: string | null; message?: Record<string, unknown> | null; created?: number; moved?: number } = {}) {
    const createMany = vi.fn().mockResolvedValue({ count: options.created ?? 0 });
    const updateMany = vi.fn().mockResolvedValue({ count: options.moved ?? 0 });
    const message = options.message === undefined ? { id: 'm5', roomId: 'room-1', createdAt: new Date('2027-01-01T10:00:00Z') } : options.message;
    const service = new ChatService(
      {
        tripMembership: { findUnique: vi.fn().mockResolvedValue(options.membership === null ? null : { status: options.membership ?? 'APPROVED' }) },
        message: { findFirst: vi.fn().mockResolvedValue(message) },
        chatReadState: { createMany, updateMany },
      } as never,
      {} as never,
      {} as never,
    );
    return { service, createMany, updateMany };
  }

  it('records the first read, and reports it', async () => {
    const { service, createMany } = build({ created: 1 });
    expect(await service.markRead('trip-1', 'u1', 'm5')).toEqual({ messageId: 'm5', at: new Date('2027-01-01T10:00:00Z') });
    expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ roomId: 'room-1', userId: 'u1', lastReadMessageId: 'm5' }] });
  });

  it('moves an earlier read forward, and only forward', async () => {
    const { service, updateMany } = build({ moved: 1 });
    await service.markRead('trip-1', 'u1', 'm5');
    expect(updateMany.mock.calls[0][0].where).toEqual({ roomId: 'room-1', userId: 'u1', lastReadAt: { lt: new Date('2027-01-01T10:00:00Z') } });
  });

  it('says nothing moved when they had already read at least that far', async () => {
    expect(await build({ created: 0, moved: 0 }).service.markRead('trip-1', 'u1', 'm5')).toBeNull();
  });

  it('refuses someone who is not an approved member', async () => {
    for (const membership of [null, 'REQUESTED', 'LEFT', 'REMOVED']) {
      const { service, createMany } = build({ membership });
      await expect(service.markRead('trip-1', 'u1', 'm5')).rejects.toBeInstanceOf(ForbiddenException);
      expect(createMany).not.toHaveBeenCalled();
    }
  });

  it('refuses a message that is not in this trip\'s chat', async () => {
    await expect(build({ message: null }).service.markRead('trip-1', 'u1', 'elsewhere')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only looks for the message within this trip', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ChatService(
      { tripMembership: { findUnique: vi.fn().mockResolvedValue({ status: 'APPROVED' }) }, message: { findFirst } } as never,
      {} as never,
      {} as never,
    );
    await service.markRead('trip-1', 'u1', 'm5').catch(() => undefined);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'm5', room: { tripId: 'trip-1' } });
  });
});

describe('ChatService.listReadStates', () => {
  function build(options: { membership?: string | null; receipts?: boolean; hidden?: string[] } = {}) {
    const findMany = vi.fn().mockResolvedValue([{ userId: 'friend', lastReadMessageId: 'm5', lastReadAt: new Date() }]);
    const service = new ChatService(
      {
        tripMembership: { findUnique: vi.fn().mockResolvedValue(options.membership === null ? null : { status: options.membership ?? 'APPROVED' }) },
        user: { findUnique: vi.fn().mockResolvedValue({ readReceipts: options.receipts ?? true }) },
        chatReadState: { findMany },
      } as never,
      {} as never,
      { blockedWith: vi.fn().mockResolvedValue(new Set(options.hidden ?? [])) } as never,
    );
    return { service, findMany };
  }

  it('shows how far the others have read, to someone on the trip', async () => {
    const { service } = build();
    expect(await service.listReadStates('trip-1', 'me')).toHaveLength(1);
  });

  it('shows nothing at all to someone who has read receipts off: it is a trade', async () => {
    const { service, findMany } = build({ receipts: false });
    expect(await service.listReadStates('trip-1', 'me')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('leaves out themselves, anyone blocked with them, anyone with receipts off, and closed accounts', async () => {
    const { service, findMany } = build({ hidden: ['b1', 'b2'] });
    await service.listReadStates('trip-1', 'me');
    expect(findMany.mock.calls[0][0].where).toEqual({
      room: { tripId: 'trip-1' },
      userId: { not: 'me', notIn: ['b1', 'b2'] },
      user: { readReceipts: true, accountStatus: 'ACTIVE' },
    });
  });

  it('adds no block filter when nobody is blocked', async () => {
    const { service, findMany } = build();
    await service.listReadStates('trip-1', 'me');
    expect(findMany.mock.calls[0][0].where.userId).toEqual({ not: 'me' });
  });

  it('refuses someone who is not an approved member', async () => {
    for (const membership of [null, 'REQUESTED', 'LEFT']) {
      await expect(build({ membership }).service.listReadStates('trip-1', 'me')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
