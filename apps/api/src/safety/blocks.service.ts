import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MembershipStatus } from '../generated/prisma/index.js';

/**
 * Blocking (BLUEPRINT §08): "symmetric and total". A block makes two people
 * invisible to each other — discovery, joining or viewing each other's trips,
 * the travellers list, chat history and live chat — and neither is told.
 * Symmetric means it doesn't matter who blocked whom; every check here looks
 * in both directions.
 *
 * Deliberately NOT affected: reviews. A block shouldn't be a way to prevent a
 * bad experience being reviewed (or to dodge the review), so trust scoring
 * ignores it.
 */
@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everyone with a block against `userId`, in either direction. */
  async blockedWith(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)));
  }

  async areBlocked(a: string, b: string): Promise<boolean> {
    const count = await this.prisma.block.count({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    });
    return count > 0;
  }

  /**
   * Idempotent. Also withdraws any pending join request between the two,
   * silently, in whichever direction: someone who has just blocked a person
   * shouldn't then have to approve or decline their request, and a request to
   * someone you've blocked makes no sense. (Approved memberships are left
   * alone — leaving or removing someone from a trip is a separate, explicit act.)
   */
  async block(blockerId: string, targetId: string): Promise<void> {
    if (blockerId === targetId) throw new BadRequestException("You can't block yourself");
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');

    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId: targetId } },
        create: { blockerId, blockedId: targetId },
        update: {},
      }),
      this.prisma.tripMembership.deleteMany({
        where: {
          status: MembershipStatus.REQUESTED,
          OR: [
            { userId: targetId, trip: { hostId: blockerId } },
            { userId: blockerId, trip: { hostId: targetId } },
          ],
        },
      }),
    ]);
  }

  /** Removes only the caller's own block. If the other person has also blocked them, the hide stays. */
  async unblock(blockerId: string, targetId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId: targetId } });
  }

  /** The people the caller has blocked — never who has blocked *them*. */
  async listMine(blockerId: string) {
    const rows = await this.prisma.block.findMany({
      where: { blockerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true, blocked: { select: { id: true, name: true } } },
    });
    return rows.map((row) => ({ user: row.blocked, createdAt: row.createdAt }));
  }
}
