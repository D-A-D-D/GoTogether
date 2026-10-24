import { ChatGateway } from './chat.gateway.js';

// The gateway's live broadcast, with a fake socket.io server. The point:
// blocks must hide a message from the blocked person *live*, not just in
// history, and that has to be decided per recipient.

function harness(options: { hidden?: string[]; roomUserIds?: Array<string | undefined>; createError?: Error } = {}) {
  const message = { id: 'm1', senderId: 'sender', content: 'hi', sender: { id: 'sender', name: 'Sam' } };
  const sockets = (options.roomUserIds ?? ['sender', 'friend', 'blocked-one']).map((userId) => ({
    data: { userId },
    emit: vi.fn(),
  }));
  const inRoom = vi.fn().mockReturnValue({ fetchSockets: vi.fn().mockResolvedValue(sockets) });
  const chatService = {
    createMessage: options.createError
      ? vi.fn().mockRejectedValue(options.createError)
      : vi.fn().mockResolvedValue(message),
  };
  const blocks = { blockedWith: vi.fn().mockResolvedValue(new Set(options.hidden ?? [])) };
  const gateway = new ChatGateway({} as never, {} as never, chatService as never, blocks as never);
  (gateway as unknown as { server: unknown }).server = { in: inRoom };
  const send = () =>
    gateway.onSendMessage({ data: { userId: 'sender' } } as never, { tripId: 'trip-1', content: 'hi' } as never);
  return { send, sockets, inRoom, blocks, message };
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
