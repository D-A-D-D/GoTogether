import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DIRECT_LIMITS, DirectService } from './direct.service.js';

const NOW = new Date('2027-03-10T12:00:00Z');
const person = (id: string, accountStatus = 'ACTIVE') => ({ id, name: `Name ${id}`, avatarUpdatedAt: null, accountStatus });

/** A thread between 'a' and 'b' (the sorted pair), asked by `requesterId`. */
const threadOf = (status: string, requesterId = 'a', extra: Record<string, unknown> = {}) => ({
  id: 't1',
  userLowId: 'a',
  userHighId: 'b',
  userLow: person('a'),
  userHigh: person('b'),
  requesterId,
  status,
  requestedAt: new Date(NOW.getTime() - 3600_000),
  respondedAt: null,
  lastMessageAt: NOW,
  lowReadAt: null,
  highReadAt: null,
  ...extra,
});

function harness(options: { thread?: Record<string, unknown> | null; sameTrip?: boolean; blocked?: boolean; hidden?: string[]; target?: Record<string, unknown> | null; sent?: number } = {}) {
  const thread = options.thread === undefined ? null : options.thread;
  const notifyUser = vi.fn().mockResolvedValue(undefined);
  const upsert = vi.fn().mockResolvedValue({ id: 't1' });
  const messageCreate = vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'm1', createdAt: NOW, ...args.data }));
  const threadUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    user: {
      findUnique: vi.fn().mockImplementation(async (args: { where: { id: string } }) =>
        options.target !== undefined ? options.target : { ...person(args.where.id), name: `Name ${args.where.id}` },
      ),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Asha' }),
    },
    tripMembership: { findFirst: vi.fn().mockResolvedValue(options.sameTrip === false ? null : { id: 'm' }) },
    directThread: {
      findUnique: vi.fn().mockResolvedValue(thread),
      findMany: vi.fn().mockResolvedValue(thread ? [{ ...thread, messages: [] }] : []),
      upsert,
      update: threadUpdate,
    },
    directMessage: {
      create: messageCreate,
      count: vi.fn().mockResolvedValue(options.sent ?? 0),
      findMany: vi.fn().mockResolvedValue([{ id: 'm2', senderId: 'a', content: 'hi', createdAt: NOW }, { id: 'm1', senderId: 'b', content: 'hello', createdAt: new Date(NOW.getTime() - 1000) }]),
      findFirst: vi.fn().mockResolvedValue({ createdAt: NOW }),
    },
    $transaction: vi.fn().mockImplementation(async (ops: unknown[]) => Promise.all(ops)),
  };
  const blocks = { areBlocked: vi.fn().mockResolvedValue(options.blocked ?? false), blockedWith: vi.fn().mockResolvedValue(new Set(options.hidden ?? [])) };
  const service = new DirectService(prisma as never, blocks as never, { notifyUser } as never);
  return { service, prisma, upsert, messageCreate, threadUpdate, notifyUser, blocks };
}

describe('DirectService.start - asking someone to talk privately', () => {
  it('creates a waiting request carrying exactly the one message, asked by me', async () => {
    const { service, upsert, messageCreate } = harness();
    await expect(service.start('b', 'a', '  Hi, I am on your trip  ')).resolves.toEqual({ threadId: 't1' });
    expect(upsert.mock.calls[0][0].create).toMatchObject({ userLowId: 'a', userHighId: 'b', requesterId: 'b', status: 'PENDING' });
    expect(messageCreate).toHaveBeenCalledWith({ data: { threadId: 't1', senderId: 'b', content: 'Hi, I am on your trip' } });
  });

  it('marks it read on the asker side only, so the other person sees something waiting', async () => {
    const { service, upsert } = harness();
    await service.start('b', 'a', 'hi');
    const data = upsert.mock.calls[0][0].create;
    expect(data.highReadAt).toBeInstanceOf(Date);
    expect(data.lowReadAt).toBeNull();
  });

  it('tells the other person a request came in, without putting the message in the notification', async () => {
    const { service, notifyUser } = harness();
    await service.start('b', 'a', 'a private secret');
    expect(notifyUser).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'New message request', url: '/messages' }));
    expect(JSON.stringify(notifyUser.mock.calls)).not.toContain('a private secret');
  });

  it('refuses blank text, a message to yourself, and someone who is not there or is blocked - as "not found"', async () => {
    await expect(harness().service.start('b', 'a', '   ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(harness().service.start('b', 'b', 'hi')).rejects.toBeInstanceOf(BadRequestException);
    await expect(harness({ target: null }).service.start('b', 'a', 'hi')).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness({ target: person('a', 'SUSPENDED') }).service.start('b', 'a', 'hi')).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness({ blocked: true }).service.start('b', 'a', 'hi')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is only for people who are on a trip together right now', async () => {
    const { service, upsert } = harness({ sameTrip: false });
    await expect(service.start('b', 'a', 'hi')).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('limits how many people one person can ask in a day', async () => {
    const { service } = harness();
    for (let i = 0; i < DIRECT_LIMITS.requests.limit; i++) await service.start('b', 'a', 'hi');
    await expect(service.start('b', 'a', 'hi')).rejects.toMatchObject({ status: 429 });
  });

  it('does not ask twice while a request is waiting, and says whose move it is', async () => {
    await expect(harness({ thread: threadOf('PENDING', 'b') }).service.start('b', 'a', 'again')).rejects.toThrow(/already sent a request/);
    await expect(harness({ thread: threadOf('PENDING', 'a') }).service.start('b', 'a', 'hi')).rejects.toThrow(/open the request to accept/);
  });

  it('does not let a declined person ask again within a month, and does not reveal why', async () => {
    const declined = threadOf('DECLINED', 'b', { respondedAt: new Date(Date.now() - 24 * 3600_000) });
    await expect(harness({ thread: declined }).service.start('b', 'a', 'please?')).rejects.toThrow(/already sent a request/);
  });

  it('starts over after a removal closed the chat, once they are on a trip together again', async () => {
    const { service, upsert } = harness({ thread: threadOf('CLOSED', 'a') });
    await service.start('b', 'a', 'hello again');
    expect(upsert.mock.calls[0][0].update).toMatchObject({ requesterId: 'b', status: 'PENDING', respondedAt: null });
  });

  it('when the chat is already accepted, just sends the message', async () => {
    const { service, upsert, messageCreate } = harness({ thread: threadOf('ACCEPTED') });
    await expect(service.start('b', 'a', 'hey')).resolves.toEqual({ threadId: 't1' });
    expect(upsert).not.toHaveBeenCalled();
    expect(messageCreate).toHaveBeenCalled();
  });
});

describe('DirectService.send', () => {
  it('allows one message from the asker while the request waits, and no second', async () => {
    await expect(harness({ thread: threadOf('PENDING', 'a'), sent: 0 }).service.send('a', 't1', 'hi')).resolves.toBeDefined();
    await expect(harness({ thread: threadOf('PENDING', 'a'), sent: 1 }).service.send('a', 't1', 'hello?')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('counts only messages since the current request, so a chat that was closed can start again', async () => {
    const { service, prisma } = harness({ thread: threadOf('PENDING', 'a'), sent: 0 });
    await service.send('a', 't1', 'hi');
    const where = prisma.directMessage.count.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(threadOf('PENDING').requestedAt);
  });

  it('does not let the person who was asked reply before accepting', async () => {
    await expect(harness({ thread: threadOf('PENDING', 'a') }).service.send('b', 't1', 'hey')).rejects.toThrow(/Accept their request/);
  });

  it('lets both people talk once accepted, and pushes the other person with a short preview', async () => {
    const { service, notifyUser } = harness({ thread: threadOf('ACCEPTED') });
    await service.send('b', 't1', 'x'.repeat(200));
    const body = notifyUser.mock.calls[0][1].body as string;
    expect(notifyUser.mock.calls[0][0]).toBe('a');
    expect(body.length).toBeLessThanOrEqual(81);
    expect(notifyUser.mock.calls[0][1].url).toBe('/messages/t1');
  });

  it('refuses everything in a closed chat', async () => {
    await expect(harness({ thread: threadOf('CLOSED') }).service.send('a', 't1', 'hi')).rejects.toThrow(/closed/);
  });

  it('is "not found" for someone who is not in the thread, for a blocked pair and for a closed account', async () => {
    await expect(harness({ thread: threadOf('ACCEPTED') }).service.send('stranger', 't1', 'hi')).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness({ thread: threadOf('ACCEPTED'), blocked: true }).service.send('a', 't1', 'hi')).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness({ thread: threadOf('ACCEPTED', 'a', { userHigh: person('b', 'DELETED') }) }).service.send('a', 't1', 'hi')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('limits how fast one person can send across all their chats', async () => {
    const { service } = harness({ thread: threadOf('ACCEPTED') });
    for (let i = 0; i < DIRECT_LIMITS.messages.limit; i++) await service.send('a', 't1', 'hi');
    await expect(service.send('a', 't1', 'hi')).rejects.toMatchObject({ status: 429 });
  });

  it('does not push anything for a message that is the one allowed with a request', async () => {
    const { service, notifyUser } = harness({ thread: threadOf('PENDING', 'a') });
    await service.send('a', 't1', 'hi');
    expect(notifyUser).not.toHaveBeenCalled();
  });
});

describe('DirectService.respond', () => {
  it('lets only the person who was asked answer, and only a waiting request', async () => {
    await expect(harness({ thread: threadOf('PENDING', 'a') }).service.respond('a', 't1', 'ACCEPT')).rejects.toBeInstanceOf(ConflictException);
    await expect(harness({ thread: threadOf('ACCEPTED', 'a') }).service.respond('b', 't1', 'ACCEPT')).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepting opens the chat for both and tells the asker', async () => {
    const { service, threadUpdate, notifyUser } = harness({ thread: threadOf('PENDING', 'a') });
    await expect(service.respond('b', 't1', 'ACCEPT')).resolves.toEqual({ view: 'ACCEPTED' });
    expect(threadUpdate.mock.calls[0][0].data).toMatchObject({ status: 'ACCEPTED' });
    expect(notifyUser).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'Request accepted' }));
  });

  it('declining is silent: nobody is notified, and it disappears for the person who declined', async () => {
    const { service, threadUpdate, notifyUser } = harness({ thread: threadOf('PENDING', 'a') });
    await expect(service.respond('b', 't1', 'DECLINE')).resolves.toEqual({ view: 'HIDDEN' });
    expect(threadUpdate.mock.calls[0][0].data).toMatchObject({ status: 'DECLINED' });
    expect(notifyUser).not.toHaveBeenCalled();
  });
});

describe('DirectService.listThreads', () => {
  it('shows what each person should see, and never a declined request to the person who declined', async () => {
    const asker = await harness({ thread: threadOf('DECLINED', 'a') }).service.listThreads('a');
    expect(asker.map((t) => t.view)).toEqual(['REQUEST_OUT']);
    const decliner = await harness({ thread: threadOf('DECLINED', 'a') }).service.listThreads('b');
    expect(decliner).toEqual([]);
  });

  it('marks a request waiting for you as needing attention, and leaves out blocked people and closed accounts', async () => {
    const waiting = await harness({ thread: threadOf('PENDING', 'a') }).service.listThreads('b');
    expect(waiting[0]).toMatchObject({ view: 'REQUEST_IN', unread: true });
    expect(await harness({ thread: threadOf('ACCEPTED'), hidden: ['a'] }).service.listThreads('b')).toEqual([]);
    expect(await harness({ thread: threadOf('ACCEPTED', 'a', { userLow: person('a', 'DELETED') }) }).service.listThreads('b')).toEqual([]);
  });

  it('counts the chats that need attention', async () => {
    expect(await harness({ thread: threadOf('PENDING', 'a') }).service.attentionCount('b')).toEqual({ count: 1 });
    expect(await harness({ thread: threadOf('PENDING', 'a') }).service.attentionCount('a')).toEqual({ count: 0 });
  });
});

describe('DirectService.messages', () => {
  it('returns the chat oldest first, says whether the person can send, and marks it read on their own side', async () => {
    const { service, threadUpdate } = harness({ thread: threadOf('ACCEPTED') });
    const result = await service.messages('b', 't1');
    expect(result.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.thread).toMatchObject({ view: 'ACCEPTED', canSend: true, other: { id: 'a' } });
    expect(threadUpdate.mock.calls[0][0].data).toHaveProperty('highReadAt');
    expect(threadUpdate.mock.calls[0][0].data).not.toHaveProperty('lowReadAt');
  });

  it('cannot send while a request waits (either side) and is still readable once closed', async () => {
    expect((await harness({ thread: threadOf('PENDING', 'a'), sent: 1 }).service.messages('a', 't1')).thread.canSend).toBe(false);
    expect((await harness({ thread: threadOf('PENDING', 'a') }).service.messages('b', 't1')).thread.canSend).toBe(false);
    expect((await harness({ thread: threadOf('CLOSED') }).service.messages('a', 't1')).thread).toMatchObject({ view: 'CLOSED', canSend: false });
  });

  it('is "not found" for a stranger and for the person who declined', async () => {
    await expect(harness({ thread: threadOf('ACCEPTED') }).service.messages('stranger', 't1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness({ thread: threadOf('DECLINED', 'a') }).service.messages('b', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
