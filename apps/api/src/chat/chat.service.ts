import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MembershipStatus } from '../generated/prisma/index.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { BlocksService } from '../safety/blocks.service.js';

const SENDER_SELECT = { id: true, name: true } as const;
const MESSAGE_PREVIEW_LENGTH = 80;

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
  async createMessage(tripId: string, senderId: string, content: string) {
    // Three independent lookups, started together: each is a round trip to the database. The
    // sender's name is fetched here, not by asking the insert to include it - an insert that also
    // reads a relation back is several statements, each its own round trip. Who is refused is decided
    // in the same order as before: not a member first, no room second.
    const [membership, room, sender] = await Promise.all([
      this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId: senderId } } }),
      this.prisma.chatRoom.findUnique({ where: { tripId } }),
      this.prisma.user.findUnique({ where: { id: senderId }, select: SENDER_SELECT }),
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
    const message = await this.prisma.message.create({ data: { roomId: room.id, senderId, content } });
    return { ...message, sender };
  }

  /**
   * Push notification of a new message to the other approved members. Best-effort and meant to run
   * after delivery without being waited for; a member who is actively connected already got the
   * message over the socket, and a push to them too is a known, accepted redundancy (no presence
   * tracking yet to suppress it - see docs/IDEAS.md). `hidden` is everyone blocked with the sender.
   */
  async notifyOthers(
    tripId: string,
    message: { senderId: string; content: string; sender: { name: string } },
    hidden: ReadonlySet<string>,
  ): Promise<void> {
    const others = await this.prisma.tripMembership.findMany({
      where: { tripId, status: MembershipStatus.APPROVED, userId: { not: message.senderId } },
      select: { userId: true },
    });
    const preview =
      message.content.length > MESSAGE_PREVIEW_LENGTH ? `${message.content.slice(0, MESSAGE_PREVIEW_LENGTH)}…` : message.content;
    // A message must not reach someone who's blocked with the sender - by push either.
    await this.notifications.notifyUsers(
      others.map((m) => m.userId).filter((id) => !hidden.has(id)),
      { title: message.sender.name, body: preview, url: `/trips/${tripId}/chat` },
    );
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
      include: { sender: { select: SENDER_SELECT } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(before ? { skip: 1, cursor: { id: before } } : {}),
    });

    return messages.reverse();
  }
}
