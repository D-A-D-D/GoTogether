import { ForbiddenException, Logger } from '@nestjs/common';
import { CHAT_MESSAGES_PER_WINDOW, CHAT_TOO_FAST, CHAT_WINDOW_MS, ChatGateway } from './chat.gateway.js';

// The gateway's live broadcast, with a fake socket.io server. The point:
// blocks must hide a message from the blocked person *live*, not just in
// history, and that has to be decided per recipient.

function harness(
  options: { hidden?: string[]; roomUserIds?: Array<string | undefined>; createError?: Error; restricted?: string[] } = {},
) {
  const message = { id: 'm1', senderId: 'sender', content: 'hi', sender: { id: 'sender', name: 'Sam' } };
  const sockets = (options.roomUserIds ?? ['sender', 'friend', 'blocked-one']).map((userId) => ({
    data: { userId },
    emit: vi.fn(),
    disconnect: vi.fn(),
  }));
  const inRoom = vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue(sockets) });
  const chatService = {
    createMessage: options.createError
      ? vi.fn().mockRejectedValue(options.createError)
      : vi.fn().mockResolvedValue(message),
  };
  const blocks = { blockedWith: vi.fn().mockResolvedValue(new Set(options.hidden ?? [])) };
  const accounts = {
    get: vi.fn(async (id: string) => ({
      accountStatus: (options.restricted ?? []).includes(id) ? 'SUSPENDED' : 'ACTIVE',
      role: 'USER',
    })),
  };
  const gateway = new ChatGateway({} as never, {} as never, chatService as never, blocks as never, accounts as never);
  (gateway as unknown as { server: unknown }).server = { in: inRoom };
  const senderSocket = { data: { userId: 'sender' }, disconnect: vi.fn() };
  const send = () => gateway.onSendMessage(senderSocket as never, { tripId: 'trip-1', content: 'hi' } as never);
  return { send, sockets, inRoom, blocks, message, chatService, gateway, senderSocket, accounts };
}

describe('ChatGateway.onSendMessage — live broadcast', () => {
  it('sends the message to everyone in the room when nobody is blocked', async () => {
    const { send, sockets, message } = harness();
    await send();
    for (const socket of sockets) expect(socket.emit).toHaveBeenCalledWith('message', message);
  });

  it('does not send it to someone blocked with the sender', async () => {
    const { send, sockets, message } = harness({ hidden: ['blocked-one'] });
    await send();
    const [sender, friend, blocked] = sockets;
    expect(sender.emit).toHaveBeenCalledWith('message', message);
    expect(friend.emit).toHaveBeenCalledWith('message', message);
    expect(blocked.emit).not.toHaveBeenCalled();
  });

  it("always sends the sender their own message back, even if they somehow appear in the blocked set", async () => {
    const { send, sockets, message } = harness({ hidden: ['sender'] });
    await send();
    expect(sockets[0].emit).toHaveBeenCalledWith('message', message);
  });

  it('skips a socket with no authenticated user rather than leaking to it', async () => {
    const { send, sockets } = harness({ roomUserIds: ['sender', undefined] });
    await send();
    expect(sockets[1].emit).not.toHaveBeenCalled();
  });

  it('broadcasts only within the trip\'s own room', async () => {
    const { send, inRoom } = harness();
    await send();
    expect(inRoom).toHaveBeenCalledWith('trip:trip-1');
  });

  it("looks up the blocks of the message's sender", async () => {
    const { send, blocks } = harness();
    await send();
    expect(blocks.blockedWith).toHaveBeenCalledWith('sender');
  });

  it('acknowledges the sender with the message, whoever was blocked', async () => {
    const { send, message } = harness({ hidden: ['blocked-one'] });
    expect(await send()).toEqual({ ok: true, message });
  });

  it('acknowledges a failure instead of throwing, and broadcasts nothing', async () => {
    const { send, sockets } = harness({ createError: new ForbiddenException('Only approved trip members can access this chat') });
    expect(await send()).toEqual({ ok: false, error: 'Only approved trip members can access this chat' });
    for (const socket of sockets) expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('ChatGateway — suspended and closed accounts', () => {
  it('stops delivering to someone suspended since they connected, and cuts their connection', async () => {
    const { send, sockets, message } = harness({ restricted: ['blocked-one'] });
    await send();
    const [sender, friend, suspended] = sockets;
    expect(sender.emit).toHaveBeenCalledWith('message', message);
    expect(friend.emit).toHaveBeenCalledWith('message', message);
    expect(suspended.emit).not.toHaveBeenCalled();
    expect(suspended.disconnect).toHaveBeenCalledWith(true);
  });

  it('does not disconnect people in good standing', async () => {
    const { send, sockets } = harness();
    await send();
    for (const socket of sockets) expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('refuses a message from someone suspended after they connected, and disconnects them', async () => {
    const { send, senderSocket, chatService, sockets } = harness({ restricted: ['sender'] });
    expect(await send()).toEqual({ ok: false, error: 'This account is not available' });
    expect(senderSocket.disconnect).toHaveBeenCalledWith(true);
    expect(chatService.createMessage).not.toHaveBeenCalled();
    for (const socket of sockets) expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('ChatGateway — connection middleware', () => {
  function connecting(
    accountStatus: string | null,
    options: { token?: string | null; verifyError?: Error; accountGate?: Promise<void> } = {},
  ) {
    const jwt = {
      verifyAsync: options.verifyError
        ? vi.fn().mockRejectedValue(options.verifyError)
        : vi.fn().mockResolvedValue({ sub: 'user-1' }),
    };
    const config = { getOrThrow: vi.fn().mockReturnValue('secret') };
    const accounts = {
      get: vi.fn(async () => {
        await options.accountGate;
        return accountStatus === null ? null : { accountStatus, role: 'USER' };
      }),
    };
    const gateway = new ChatGateway(jwt as never, config as never, {} as never, {} as never, accounts as never);
    let middleware!: (socket: unknown, next: (error?: Error) => void) => void;
    gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);
    const auth = options.token === null ? {} : { token: options.token ?? 'a-token' };
    const socket = { handshake: { auth, headers: {} }, data: {} as Record<string, unknown> };
    // Resolves with whatever the middleware passed to next().
    const connect = () =>
      new Promise<Error | undefined>((resolve) => middleware(socket, (error) => resolve(error)));
    return { gateway, socket, connect, jwt };
  }

  it('lets an active account connect, with its user id already set', async () => {
    const { socket, connect } = connecting('ACTIVE');
    expect(await connect()).toBeUndefined();
    expect(socket.data.userId).toBe('user-1');
  });

  it('does not let the connection through until the account check has finished', async () => {
    let finishLookup!: () => void;
    const { socket, connect } = connecting('ACTIVE', { accountGate: new Promise((r) => (finishLookup = r)) });
    const next = vi.fn();
    const settled = connect().then((error) => next(error));
    await new Promise((r) => setTimeout(r, 10));
    // Still waiting on the account lookup: the client must not have been told it is connected.
    expect(next).not.toHaveBeenCalled();
    expect(socket.data.userId).toBeUndefined();
    finishLookup();
    await settled;
    expect(next).toHaveBeenCalledWith(undefined);
    expect(socket.data.userId).toBe('user-1');
  });

  it.each(['SUSPENDED', 'BANNED'])('refuses a %s account, even with a valid token', async (status) => {
    const { socket, connect } = connecting(status);
    expect(await connect()).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
  });

  it('refuses an account that no longer exists', async () => {
    const { connect } = connecting(null);
    expect(await connect()).toEqual(new Error('Unauthorized'));
  });

  it('refuses a connection with no token, without looking anything up', async () => {
    const { connect, jwt } = connecting('ACTIVE', { token: null });
    expect(await connect()).toEqual(new Error('Unauthorized'));
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('refuses a token that does not verify', async () => {
    const { socket, connect } = connecting('ACTIVE', { verifyError: new Error('jwt expired') });
    expect(await connect()).toEqual(new Error('Unauthorized'));
    expect(socket.data.userId).toBeUndefined();
  });
});

describe('ChatGateway — message rate limit, pinned', () => {
  it('allows 15 messages per person every 10 seconds', () => {
    // Literals on purpose: a product decision, not something to move together with the test.
    expect(CHAT_MESSAGES_PER_WINDOW).toBe(15);
    expect(CHAT_WINDOW_MS).toBe(10_000);
  });
});

describe('ChatGateway — message rate limit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets a person send up to the limit in a window, then refuses the next without saving or broadcasting it', async () => {
    const { send, chatService, sockets } = harness();
    for (let i = 0; i < CHAT_MESSAGES_PER_WINDOW; i++) expect((await send()).ok).toBe(true);
    const emitsBefore = sockets[1].emit.mock.calls.length;
    expect(await send()).toEqual({ ok: false, error: CHAT_TOO_FAST });
    expect(chatService.createMessage).toHaveBeenCalledTimes(CHAT_MESSAGES_PER_WINDOW);
    expect(sockets[1].emit.mock.calls.length).toBe(emitsBefore);
  });

  it('lets them send again once the window has passed', async () => {
    const { send } = harness();
    for (let i = 0; i < CHAT_MESSAGES_PER_WINDOW; i++) await send();
    expect((await send()).ok).toBe(false);
    vi.advanceTimersByTime(CHAT_WINDOW_MS + 1);
    expect((await send()).ok).toBe(true);
  });

  it('limits each person separately — one flooding does not silence the room', async () => {
    const { send, gateway } = harness();
    for (let i = 0; i < CHAT_MESSAGES_PER_WINDOW; i++) await send();
    expect((await send()).ok).toBe(false);
    const someoneElse = { data: { userId: 'friend' }, disconnect: vi.fn() };
    const result = await gateway.onSendMessage(someoneElse as never, { tripId: 'trip-1', content: 'hi' } as never);
    expect(result.ok).toBe(true);
  });

  it('counts across trips: the allowance is per person, not per room', async () => {
    const { gateway, senderSocket } = harness();
    for (let i = 0; i < CHAT_MESSAGES_PER_WINDOW; i++) {
      await gateway.onSendMessage(senderSocket as never, { tripId: `trip-${i % 3}`, content: 'x' } as never);
    }
    const refused = await gateway.onSendMessage(senderSocket as never, { tripId: 'trip-99', content: 'x' } as never);
    expect(refused).toEqual({ ok: false, error: CHAT_TOO_FAST });
  });

  it('checks the account first: a suspended person is cut off, not just told to slow down', async () => {
    const { send, senderSocket } = harness({ restricted: ['sender'] });
    expect(await send()).toEqual({ ok: false, error: 'This account is not available' });
    expect(senderSocket.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('ChatGateway — what clients are told when something goes wrong', () => {
  // The kind of text a database error carries: a path, a query, a host name.
  const INTERNAL = "Invalid `this.prisma.tripMembership.findUnique()` invocation in D:/app/chat.service.ts:24:57 - Can't reach database server at `ep-secret-host.neon.tech:5432`";

  function joining(assertCanAccess: () => Promise<void>) {
    const gateway = new ChatGateway({} as never, {} as never, { assertCanAccess } as never, {} as never, {} as never);
    const socket = { data: { userId: 'u1' }, join: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn() };
    return { join: () => gateway.onJoinRoom(socket as never, { tripId: 't1' } as never), socket };
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not pass an unexpected error on sending to the client - it is logged, and the client gets something generic', async () => {
    const { send } = harness({ createError: new Error(INTERNAL) });
    const result = await send();
    expect(result).toEqual({ ok: false, error: 'Could not send that message - please try again' });
    expect(JSON.stringify(result)).not.toMatch(/prisma|neon|chat\.service|database server/i);
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining("Can't reach database server"), expect.any(String));
  });

  it('does the same when joining a room fails unexpectedly', async () => {
    const { join, socket } = joining(async () => {
      throw new Error(INTERNAL);
    });
    const result = await join();
    expect(result).toEqual({ ok: false, error: 'Could not join the chat right now - please try again' });
    expect(JSON.stringify(result)).not.toMatch(/prisma|neon|database server/i);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('still tells someone plainly when they are refused: those messages are written to be read', async () => {
    const { join } = joining(async () => {
      throw new ForbiddenException('Only approved trip members can access this chat');
    });
    expect(await join()).toEqual({ ok: false, error: 'Only approved trip members can access this chat' });
  });

  it('does not log a deliberate refusal as an error', async () => {
    const { join } = joining(async () => {
      throw new ForbiddenException('Only approved trip members can access this chat');
    });
    await join();
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('copes with something that is not even an Error being thrown', async () => {
    const { join } = joining(async () => {
      throw 'a bare string';
    });
    expect(await join()).toEqual({ ok: false, error: 'Could not join the chat right now - please try again' });
  });
});
