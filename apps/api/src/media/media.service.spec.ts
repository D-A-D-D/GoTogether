import { BadRequestException, ForbiddenException, HttpException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { MEDIA_LIMITS, MediaService } from './media.service.js';

// Minimal real files, so the sniffer's decision is the one under test, not a mock of it.
const u16be = (n: number) => Buffer.from([(n >> 8) & 255, n & 255]);
const jpeg = (w = 100, h = 100, extra = 0) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0]),
    u16be(17),
    Buffer.from([8]),
    u16be(h),
    u16be(w),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xd9]),
    Buffer.alloc(extra),
  ]);
const webm = (extra = 100) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(extra)]);
const html = Buffer.from('<!doctype html><script>alert(1)</script>');

function build(
  options: {
    membership?: string | null;
    blocked?: boolean;
    avatarUser?: Record<string, unknown> | null;
    media?: Record<string, unknown> | null;
    previousAvatar?: string | null;
  } = {},
) {
  const mediaCreate = vi.fn().mockResolvedValue({ id: 'new-media', kind: 'CHAT_IMAGE', mime: 'image/jpeg', size: 10, width: 100, height: 100, durationMs: null });
  const mediaDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const userUpdate = vi.fn().mockResolvedValue({});
  const order: string[] = [];
  mediaCreate.mockImplementation(async () => (order.push('create'), { id: 'new-media', kind: 'CHAT_IMAGE', mime: 'image/jpeg', size: 10, width: 100, height: 100, durationMs: null }));
  userUpdate.mockImplementation(async () => (order.push('point'), {}));
  mediaDeleteMany.mockImplementation(async () => (order.push('delete-old'), { count: 1 }));
  const prisma = {
    user: {
      findUnique: vi.fn(async (args: { select: Record<string, unknown> }) =>
        'avatar' in args.select ? (options.avatarUser === undefined ? null : options.avatarUser) : { avatarMediaId: options.previousAvatar ?? null },
      ),
      update: userUpdate,
    },
    media: { create: mediaCreate, deleteMany: mediaDeleteMany, findUnique: vi.fn().mockResolvedValue(options.media ?? null) },
    tripMembership: { findUnique: vi.fn().mockResolvedValue(options.membership === null ? null : { status: options.membership ?? 'APPROVED' }) },
  };
  const blocks = { areBlocked: vi.fn().mockResolvedValue(options.blocked ?? false) };
  const service = new MediaService(prisma as never, blocks as never);
  return { service, prisma, blocks, order, mediaCreate, mediaDeleteMany, userUpdate };
}

describe('MediaService.setAvatar', () => {
  it('stores a real picture, and records what it is from the bytes', async () => {
    const { service, mediaCreate } = build();
    await service.setAvatar('u1', jpeg(300, 200));
    const data = mediaCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ ownerId: 'u1', kind: 'AVATAR', mime: 'image/jpeg', width: 300, height: 200 });
    expect(data.size).toBe(jpeg(300, 200).length);
  });

  it('points the account at the new picture before removing the old one', async () => {
    const { service, order } = build({ previousAvatar: 'old-media' });
    await service.setAvatar('u1', jpeg());
    expect(order).toEqual(['create', 'point', 'delete-old']);
  });

  it('only ever removes a picture that belongs to this person', async () => {
    const { service, mediaDeleteMany } = build({ previousAvatar: 'old-media' });
    await service.setAvatar('u1', jpeg());
    expect(mediaDeleteMany).toHaveBeenCalledWith({ where: { id: 'old-media', ownerId: 'u1' } });
  });

  it('refuses things that are not pictures we accept, and stores nothing', async () => {
    for (const bad of [html, webm(), Buffer.from('GIF89a' + 'x'.repeat(40)), Buffer.alloc(0), Buffer.from('<svg onload=alert(1)>')]) {
      const { service, mediaCreate } = build();
      await expect(service.setAvatar('u1', bad)).rejects.toBeInstanceOf(BadRequestException);
      expect(mediaCreate).not.toHaveBeenCalled();
    }
  });

  it('refuses a picture that is too large in bytes or in pixels', async () => {
    const { service, mediaCreate } = build();
    await expect(service.setAvatar('u1', jpeg(100, 100, MEDIA_LIMITS.avatarMaxBytes))).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.setAvatar('u1', jpeg(MEDIA_LIMITS.avatarMaxPixels + 1, 100))).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.setAvatar('u1', jpeg(100, MEDIA_LIMITS.avatarMaxPixels + 1))).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(mediaCreate).not.toHaveBeenCalled();
    await expect(service.setAvatar('u1', jpeg(MEDIA_LIMITS.avatarMaxPixels, MEDIA_LIMITS.avatarMaxPixels))).resolves.toBeDefined();
  });

  it('limits how often one person can change it, and each person separately', async () => {
    const { service } = build();
    for (let i = 0; i < MEDIA_LIMITS.avatarChanges.limit; i++) await service.setAvatar('u1', jpeg());
    await expect(service.setAvatar('u1', jpeg())).rejects.toMatchObject({ status: 429 });
    await expect(service.setAvatar('someone-else', jpeg())).resolves.toBeDefined();
  });

  it('does not count a refused upload against the allowance', async () => {
    const { service } = build();
    for (let i = 0; i < MEDIA_LIMITS.avatarChanges.limit + 3; i++) await service.setAvatar('u1', html).catch(() => undefined);
    await expect(service.setAvatar('u1', jpeg())).resolves.toBeDefined();
  });
});

describe('MediaService.removeAvatar', () => {
  it('clears the reference and deletes the file', async () => {
    const { service, userUpdate, mediaDeleteMany } = build({ previousAvatar: 'old-media' });
    await service.removeAvatar('u1');
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { avatarMediaId: null, avatarUpdatedAt: null } });
    expect(mediaDeleteMany).toHaveBeenCalledWith({ where: { id: 'old-media', ownerId: 'u1' } });
  });

  it('is fine when there was no picture', async () => {
    const { service, mediaDeleteMany } = build({ previousAvatar: null });
    await expect(service.removeAvatar('u1')).resolves.toBeUndefined();
    expect(mediaDeleteMany).not.toHaveBeenCalled();
  });
});

describe('MediaService.getAvatar', () => {
  const picture = { accountStatus: 'ACTIVE', avatar: { mime: 'image/jpeg', data: new Uint8Array([1, 2, 3]) } };

  it('gives another signed-in person the picture', async () => {
    const { service } = build({ avatarUser: picture });
    const served = await service.getAvatar('viewer', 'owner');
    expect(served.mime).toBe('image/jpeg');
    expect([...served.data]).toEqual([1, 2, 3]);
  });

  it('says "not found" when there is no picture, with no hint either way', async () => {
    await expect(build({ avatarUser: { accountStatus: 'ACTIVE', avatar: null } }).service.getAvatar('v', 'o')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ avatarUser: null }).service.getAvatar('v', 'o')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a picture from someone blocked with its owner, in the same words', async () => {
    await expect(build({ avatarUser: picture, blocked: true }).service.getAvatar('v', 'o')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides the picture of a suspended or closed account from other people', async () => {
    for (const accountStatus of ['SUSPENDED', 'BANNED', 'DELETED']) {
      await expect(build({ avatarUser: { ...picture, accountStatus } }).service.getAvatar('v', 'o')).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('always lets someone see their own, and does not ask about blocks for it', async () => {
    const { service, blocks } = build({ avatarUser: { ...picture, accountStatus: 'SUSPENDED' }, blocked: true });
    await expect(service.getAvatar('me', 'me')).resolves.toBeDefined();
    expect(blocks.areBlocked).not.toHaveBeenCalled();
  });
});

describe('MediaService.storeChatMedia', () => {
  it('stores a picture for a trip member, as a chat picture', async () => {
    const { service, mediaCreate } = build();
    await service.storeChatMedia('u1', 'trip-1', jpeg(800, 600));
    expect(mediaCreate.mock.calls[0][0].data).toMatchObject({ ownerId: 'u1', tripId: 'trip-1', kind: 'CHAT_IMAGE', mime: 'image/jpeg', width: 800, height: 600, durationMs: null });
  });

  it('stores a voice note as one, with the length clamped rather than trusted', async () => {
    const { service, mediaCreate } = build();
    await service.storeChatMedia('u1', 'trip-1', webm(), 12_345);
    expect(mediaCreate.mock.calls[0][0].data).toMatchObject({ kind: 'CHAT_VOICE', mime: 'audio/webm', durationMs: 12_345, width: null });
    await service.storeChatMedia('u1', 'trip-1', webm(), 999_999_999);
    expect(mediaCreate.mock.calls[1][0].data.durationMs).toBe(MEDIA_LIMITS.voiceMaxDurationMs);
    await service.storeChatMedia('u1', 'trip-1', webm(), -50);
    expect(mediaCreate.mock.calls[2][0].data.durationMs).toBe(0);
    await service.storeChatMedia('u1', 'trip-1', webm(), Number.NaN);
    expect(mediaCreate.mock.calls[3][0].data.durationMs).toBe(0);
  });

  it('only for approved members of that trip', async () => {
    for (const membership of [null, 'REQUESTED', 'LEFT', 'REMOVED', 'REJECTED']) {
      const { service, mediaCreate } = build({ membership });
      await expect(service.storeChatMedia('u1', 'trip-1', jpeg())).rejects.toBeInstanceOf(ForbiddenException);
      expect(mediaCreate).not.toHaveBeenCalled();
    }
  });

  it('refuses anything that is not a supported picture or recording', async () => {
    for (const bad of [html, Buffer.from('GIF89a' + 'x'.repeat(40)), Buffer.alloc(0), Buffer.from('MZ' + 'x'.repeat(40))]) {
      const { service, mediaCreate } = build();
      await expect(service.storeChatMedia('u1', 'trip-1', bad)).rejects.toBeInstanceOf(BadRequestException);
      expect(mediaCreate).not.toHaveBeenCalled();
    }
  });

  it('refuses a picture that is too big in bytes or pixels, and a recording that is too big', async () => {
    const { service } = build();
    await expect(service.storeChatMedia('u1', 'trip-1', jpeg(100, 100, MEDIA_LIMITS.imageMaxBytes))).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.storeChatMedia('u1', 'trip-1', jpeg(MEDIA_LIMITS.imageMaxPixels + 1, 10))).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.storeChatMedia('u1', 'trip-1', jpeg(10, MEDIA_LIMITS.imageMaxPixels + 1))).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.storeChatMedia('u1', 'trip-1', webm(MEDIA_LIMITS.voiceMaxBytes + 10))).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('limits uploads per person, counting only the ones that were accepted', async () => {
    const { service } = build();
    for (let i = 0; i < MEDIA_LIMITS.chatUploads.limit; i++) await service.storeChatMedia('u1', 'trip-1', jpeg());
    await expect(service.storeChatMedia('u1', 'trip-1', jpeg())).rejects.toBeInstanceOf(HttpException);
    await expect(service.storeChatMedia('u2', 'trip-1', jpeg())).resolves.toBeDefined();
  });

  it('never returns the file bytes in what it reports back', async () => {
    const { service, mediaCreate } = build();
    await service.storeChatMedia('u1', 'trip-1', jpeg());
    expect(mediaCreate.mock.calls[0][0].select).toEqual({ id: true, kind: true, mime: true, size: true, width: true, height: true, durationMs: true });
  });
});

describe('MediaService.getChatMedia', () => {
  const sent = (over: Record<string, unknown> = {}) => ({
    ownerId: 'sender',
    kind: 'CHAT_IMAGE',
    mime: 'image/jpeg',
    data: new Uint8Array([9, 9]),
    tripId: 'trip-1',
    message: { senderId: 'sender', room: { tripId: 'trip-1' } },
    ...over,
  });

  it('gives it to an approved member of the trip', async () => {
    const { service } = build({ media: sent() });
    const served = await service.getChatMedia('member', 'm1');
    expect(served.mime).toBe('image/jpeg');
  });

  it('always gives it to the person who sent it', async () => {
    const { service, prisma } = build({ media: sent(), membership: null });
    await expect(service.getChatMedia('sender', 'm1')).resolves.toBeDefined();
    expect(prisma.tripMembership.findUnique).not.toHaveBeenCalled();
  });

  it('says "not found" to anyone not on the trip - not "forbidden"', async () => {
    for (const membership of [null, 'REQUESTED', 'LEFT', 'REMOVED']) {
      await expect(build({ media: sent(), membership }).service.getChatMedia('outsider', 'm1')).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('says "not found" to someone blocked with the sender, even if they are on the trip', async () => {
    await expect(build({ media: sent(), blocked: true }).service.getChatMedia('member', 'm1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks membership of the trip the message is actually in, not the one the upload was made for', async () => {
    const { service, prisma } = build({ media: sent({ tripId: 'trip-OTHER' }) });
    await service.getChatMedia('member', 'm1');
    expect(prisma.tripMembership.findUnique.mock.calls[0][0].where).toEqual({ tripId_userId: { tripId: 'trip-1', userId: 'member' } });
  });

  it('keeps a file nobody has sent yet to the person who uploaded it', async () => {
    const unsent = sent({ message: null });
    await expect(build({ media: unsent }).service.getChatMedia('sender', 'm1')).resolves.toBeDefined();
    await expect(build({ media: unsent }).service.getChatMedia('member', 'm1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never serves a profile picture by this route - those have their own rules', async () => {
    await expect(build({ media: sent({ kind: 'AVATAR' }) }).service.getChatMedia('sender', 'm1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says "not found" for a file that does not exist', async () => {
    await expect(build({ media: null }).service.getChatMedia('member', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
