import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountStatus, MediaKind, MembershipStatus } from '../generated/prisma/index.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { BlocksService } from '../safety/blocks.service.js';
import { messageProblem, notificationBody, storedContent, type MessageKindName } from './message-rules.js';

/** avatarUpdatedAt is what a client puts in the picture's address; without a picture it is null. */
const SENDER_SELECT = { id: true, name: true, avatarUpdatedAt: true } as const;
/** What a client needs to show a picture or voice note - never the bytes, which have their own route. */
const MEDIA_SELECT = { id: true, mime: true, size: true, width: true, height: true, durationMs: true } as const;

const KIND_FOR_FILE = { IMAGE: MediaKind.CHAT_IMAGE, VOICE: MediaKind.CHAT_VOICE } as const;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly blocks: BlocksService,
  ) {}

  /**
   * A trip's chat room is only open to its APPROVED members (host
   * included — the host's own membership is approved at trip creation).
   * Requested/rejected/left/removed users, and everyone else, are refused.
   */
  async assertCanAccess(tripId: string, userId: string): Promise<void> {
    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId } },
    });
    if (!membership || membership.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException('Only approved trip members can access this chat');
    }
  }

  private async getRoomId(tripId: string): Promise<string> {
    const room = await this.prisma.chatRoom.findUnique({ where: { tripId } });
    if (!room) {
      throw new NotFoundException('This trip has no chat room yet');
    }
    return room.id;
  }

  /**
   * Saves a message. Only that - telling people about it (push notifications) is notifyOthers(), which the
   * caller runs after the message has been delivered, so a slow or failing push can never hold up a chat.
   */
  async createMessage(
    tripId: string,
    senderId: string,
    content: string,
    extras: { kind?: MessageKindName; mediaId?: string } = {},
  ) {
    const kind: MessageKindName = extras.kind ?? 'TEXT';
    const problem = messageProblem(kind, content, extras.mediaId);
    if (problem) throw new BadRequestException(problem);

    // Independent lookups, started together: each is a round trip to the database. The sender's name is
    // fetched here, not by asking the insert to include it - an insert that also reads a relation back is
    // several statements, each its own round trip. Who is refused is decided in the same order as
    // before: not a member first, no room second.
    const [membership, room, sender, file] = await Promise.all([
      this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId: senderId } } }),
      this.prisma.chatRoom.findUnique({ where: { tripId } }),
      this.prisma.user.findUnique({ where: { id: senderId }, select: SENDER_SELECT }),
      extras.mediaId
        ? this.prisma.media.findUnique({
            where: { id: extras.mediaId },
            select: { ...MEDIA_SELECT, ownerId: true, tripId: true, kind: true, message: { select: { id: true } } },
          })
        : Promise.resolve(null),
    ]);
    if (!membership || membership.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException('Only approved trip members can access this chat');
    }
    if (!room) {
      throw new NotFoundException('This trip has no chat room yet');
    }
    if (!sender) {
      throw new ForbiddenException('Only approved trip members can access this chat');
    }

    let media: { id: string; mime: string; size: number; width: number | null; height: number | null; durationMs: number | null } | null = null;
    if (kind !== 'TEXT') {
      // Only your own upload, made for this trip, of the right kind, and not already sent in another message.
      const usable =
        file !== null && file.ownerId === senderId && file.tripId === tripId && file.kind === KIND_FOR_FILE[kind] && file.message === null;
      if (!usable) throw new BadRequestException('That file cannot be sent - please upload it again');
      media = { id: file.id, mime: file.mime, size: file.size, width: file.width, height: file.height, durationMs: file.durationMs };
    }

    const message = await this.prisma.message.create({
      data: { roomId: room.id, senderId, content: storedContent(kind, content), kind, mediaId: media?.id ?? null },
    });
    return { ...message, sender, media };
  }

  /**
   * Push notification of a new message to the other approved members. Best-effort and meant to run
   * after delivery without being waited for; a member who is actively connected already got the
   * message over the socket, and a push to them too is a known, accepted redundancy (no presence
   * tracking yet to suppress it - see docs/IDEAS.md). `hidden` is everyone blocked with the sender.
   */
  async notifyOthers(
    tripId: string,
    message: { senderId: string; content: string; kind?: MessageKindName; sender: { name: string } },
    hidden: ReadonlySet<string>,
  ): Promise<void> {
    const others = await this.prisma.tripMembership.findMany({
      where: { tripId, status: MembershipStatus.APPROVED, userId: { not: message.senderId } },
      select: { userId: true },
    });
    const preview = notificationBody(message.kind ?? 'TEXT', message.content);
    // A message must not reach someone who's blocked with the sender - by push either.
    await this.notifications.notifyUsers(
      others.map((m) => m.userId).filter((id) => !hidden.has(id)),
      { title: message.sender.name, body: preview, url: `/trips/${tripId}/chat` },
    );
  }

  /**
   * Records that someone has now read up to a message. Only ever forward: an older message than they have
   * already read changes nothing. Returns what to tell the room, or null if nothing moved. Whether the
   * person shares read receipts is the caller's business (the gateway checks it before calling this).
   */
  async markRead(tripId: string, userId: string, messageId: string): Promise<{ messageId: string; at: Date } | null> {
    const [membership, message] = await Promise.all([
      this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId } }, select: { status: true } }),
      this.prisma.message.findFirst({ where: { id: messageId, room: { tripId } }, select: { id: true, roomId: true, createdAt: true } }),
    ]);
    if (membership?.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException('Only approved trip members can access this chat');
    }
    if (!message) throw new BadRequestException('Unknown message');

    const created = await this.prisma.chatReadState.createMany({
      data: [{ roomId: message.roomId, userId, lastReadMessageId: message.id, lastReadAt: message.createdAt }],
      skipDuplicates: true,
    });
    const moved = await this.prisma.chatReadState.updateMany({
      where: { roomId: message.roomId, userId, lastReadAt: { lt: message.createdAt } },
      data: { lastReadMessageId: message.id, lastReadAt: message.createdAt },
    });
    return created.count + moved.count > 0 ? { messageId: message.id, at: message.createdAt } : null;
  }

  /**
   * How far each other member has read, for someone who is on the trip. Read receipts are a trade, not a
   * one-way mirror: nothing is shown to someone who has them switched off, and nobody who has them off
   * appears - nor anyone blocked with the requester.
   */
  async listReadStates(tripId: string, requesterId: string) {
    const [membership, me, hidden] = await Promise.all([
      this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId: requesterId } }, select: { status: true } }),
      this.prisma.user.findUnique({ where: { id: requesterId }, select: { readReceipts: true } }),
      this.blocks.blockedWith(requesterId),
    ]);
    if (membership?.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException('Only approved trip members can access this chat');
    }
    if (!me?.readReceipts) return [];
    return this.prisma.chatReadState.findMany({
      where: {
        room: { tripId },
        userId: { not: requesterId, ...(hidden.size > 0 ? { notIn: [...hidden] } : {}) },
        user: { readReceipts: true, accountStatus: AccountStatus.ACTIVE },
      },
      select: { userId: true, lastReadMessageId: true, lastReadAt: true },
    });
  }

  /**
   * Cursor pagination, oldest-first within the returned page. `before` is
   * a message id to page backward from (load-older-messages), omitted for
   * the initial (most recent) page.
   *
   * Two details that matter once people actually page back through history:
   *  - ordering is (createdAt, id), not createdAt alone — messages can share
   *    a timestamp, and without a tie-break the cursor could land inside such
   *    a group and skip or repeat messages;
   *  - the cursor must be a message in *this* room. An unknown id would
   *    otherwise be a server error, and another room's id would act as a
   *    position marker into this one.
   */
  async listMessages(tripId: string, userId: string, before: string | undefined, limit: number) {
    await this.assertCanAccess(tripId, userId);
    const roomId = await this.getRoomId(tripId);

    if (before) {
      const cursor = await this.prisma.message.findFirst({ where: { id: before, roomId }, select: { id: true } });
      if (!cursor) throw new BadRequestException('Unknown message to page from');
    }

    // Messages from anyone blocked with the reader, in either direction, are left out.
    const hidden = await this.blocks.blockedWith(userId);

    const messages = await this.prisma.message.findMany({
      relationLoadStrategy: 'join',
      where: { roomId, ...(hidden.size > 0 ? { senderId: { notIn: [...hidden] } } : {}) },
      include: { sender: { select: SENDER_SELECT }, media: { select: MEDIA_SELECT } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(before ? { skip: 1, cursor: { id: before } } : {}),
    });

    return messages.reverse();
  }
}
