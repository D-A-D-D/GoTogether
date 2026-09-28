import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MembershipStatus } from '../generated/prisma/index.js';

const SENDER_SELECT = { id: true, name: true } as const;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

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

  async createMessage(tripId: string, senderId: string, content: string) {
    await this.assertCanAccess(tripId, senderId);
    const roomId = await this.getRoomId(tripId);
    return this.prisma.message.create({
      data: { roomId, senderId, content },
      include: { sender: { select: SENDER_SELECT } },
    });
  }

  /**
   * Cursor pagination, oldest-first within the returned page. `before` is
   * a message id to page backward from (load-older-messages), omitted for
   * the initial (most recent) page.
   */
  async listMessages(tripId: string, userId: string, before: string | undefined, limit: number) {
    await this.assertCanAccess(tripId, userId);
    const roomId = await this.getRoomId(tripId);

    const messages = await this.prisma.message.findMany({
      where: { roomId },
      include: { sender: { select: SENDER_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(before ? { skip: 1, cursor: { id: before } } : {}),
    });

    return messages.reverse();
  }
}
