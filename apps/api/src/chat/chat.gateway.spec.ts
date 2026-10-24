import { ChatGateway } from './chat.gateway.js';

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
    const { send, sockets } = harness({ createError: new Error('Only approved trip members can access this chat') });
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
