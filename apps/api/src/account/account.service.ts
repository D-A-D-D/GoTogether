import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AccountStateService } from '../auth/account-state.service.js';
import { AccountStatus, MembershipRole, MembershipStatus, TripStatus } from '../generated/prisma/index.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RELEASABLE_TRIP_STATUSES,
  UNFINISHED_TRIP_STATUSES,
  anonymisedProfile,
  unfinishedTripsMessage,
} from './account-rules.js';
import type { DeleteAccountDto } from './dto/delete-account.dto.js';

/** Export and deletion of a person's own data (BLUEPRINT section 09). */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountStateService,
  ) {}

  /**
   * Everything the app holds about the person, as one document. It is their
   * data, so it leaves out what isn't: password hash and tokens, the precise
   * geocode (BLUEPRINT section 09 - only city/region ever leaves the server),
   * other people's shares of an expense, reports made about them and moderators'
   * notes. Reviews about them appear only once revealed, so the export can't be
   * used to read one early past the blind window.
   */
  async exportData(userId: string) {
    const [user, hostedTrips, memberships, messages, expenses, given, received, events, reports, blocks, devices] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            bio: true,
            homeCity: true,
            homeRegion: true,
            trustScore: true,
            verificationTier: true,
            createdAt: true,
            preferenceTags: { select: { name: true, category: true } },
          },
        }),
        this.prisma.trip.findMany({
          where: { hostId: userId },
          include: { includeTags: { select: { name: true } }, excludeTags: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.tripMembership.findMany({
          where: { userId },
          include: { trip: { select: { id: true, title: true, destination: true, startDate: true, endDate: true, status: true } } },
          orderBy: { requestedAt: 'asc' },
        }),
        this.prisma.message.findMany({
          where: { senderId: userId },
          select: { content: true, createdAt: true, room: { select: { tripId: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.expense.findMany({
          where: { OR: [{ paidById: userId }, { createdById: userId }, { splits: { some: { userId } } }] },
          include: {
            paidBy: { select: { name: true } },
            splits: { where: { userId }, select: { amount: true, settled: true, settledAt: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.review.findMany({
          where: { reviewerId: userId },
          include: { reviewee: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.review.findMany({
          where: { revieweeId: userId, processedAt: { not: null } },
          include: { reviewer: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.trustScoreEvent.findMany({
          where: { userId },
          select: { delta: true, reason: true, resultingScore: true, tripId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.report.findMany({
          where: { reporterId: userId },
          select: { reason: true, details: true, status: true, tripId: true, createdAt: true, reported: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.block.findMany({
          where: { blockerId: userId },
          select: { createdAt: true, blocked: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.pushSubscription.count({ where: { userId } }),
      ]);
    if (!user) throw new NotFoundException('User not found');

    const ratings = (r: { reliability: number; friendliness: number; communication: number; cleanliness: number }) => ({
      reliability: r.reliability,
      friendliness: r.friendliness,
      communication: r.communication,
      cleanliness: r.cleanliness,
    });

    return {
      exportedAt: new Date().toISOString(),
      notes: [
        'This is the data GoTogether holds about you.',
        'Reviews about you appear here only once they have been revealed (after you both reviewed each other, or after 14 days).',
        'It leaves out your password, session tokens, anything only the server uses, other people\'s shares of shared expenses, reports about you, and moderators\' notes.',
      ],
      account: { ...user, preferenceTags: user.preferenceTags },
      hostedTrips,
      memberships: memberships.map(({ trip, role, status, requestedAt, respondedAt, leftAt }) => ({
        trip,
        role,
        status,
        requestedAt,
        respondedAt,
        leftAt,
      })),
      messages: messages.map((m) => ({ tripId: m.room.tripId, content: m.content, sentAt: m.createdAt })),
      expenses: expenses.map((e) => ({
        id: e.id,
        tripId: e.tripId,
        description: e.description,
        amount: e.amount,
        category: e.category,
        createdAt: e.createdAt,
        paidBy: e.paidBy.name,
        youPaid: e.paidById === userId,
        youLogged: e.createdById === userId,
        yourShare: e.splits[0] ?? null,
      })),
      reviewsYouWrote: given.map((r) => ({
        tripId: r.tripId,
        about: r.reviewee.name,
        ...ratings(r),
        comment: r.comment,
        writtenAt: r.createdAt,
      })),
      reviewsAboutYou: received.map((r) => ({
        tripId: r.tripId,
        from: r.reviewer.name,
        ...ratings(r),
        comment: r.comment,
        writtenAt: r.createdAt,
      })),
      trustScoreHistory: events,
      reportsYouFiled: reports.map(({ reported, ...rest }) => ({ ...rest, about: reported.name })),
      peopleYouBlocked: blocks.map((b) => ({ name: b.blocked.name, blockedAt: b.createdAt })),
      devicesReceivingNotifications: devices,
    };
  }

  /**
   * Deletes the account by making it anonymous - the row stays, because other
   * people's messages, expenses and reviews point at it, and BLUEPRINT section 09
   * says those can't just vanish. Refused while they host a trip that hasn't
   * finished (cancel or complete it first), so nobody is left in a trip with no
   * one running it. Places on trips still open or under way are given up, and
   * a trip that was full because of them reopens. Their sign-ins, device
   * notifications, blocks and trust history go; reviews, chat and expense
   * records stay, showing "Deleted user".
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('This account is not available');
    }
    await this.assertIsThem(user, dto);

    const unfinished = await this.prisma.trip.count({
      where: { hostId: userId, status: { in: UNFINISHED_TRIP_STATUSES } },
    });
    if (unfinished > 0) throw new ConflictException(unfinishedTripsMessage(unfinished));

    const now = new Date();
    const seatOnReleasableTrip = {
      userId,
      role: MembershipRole.MEMBER,
      status: MembershipStatus.APPROVED,
      trip: { status: { in: RELEASABLE_TRIP_STATUSES } },
    };
    await this.prisma.$transaction([
      // A trip that was full only because of them has room again. Before their place is released.
      this.prisma.trip.updateMany({
        where: { status: TripStatus.FULL, memberships: { some: { userId, role: MembershipRole.MEMBER, status: MembershipStatus.APPROVED } } },
        data: { status: TripStatus.OPEN },
      }),
      this.prisma.tripMembership.updateMany({
        where: seatOnReleasableTrip,
        data: { status: MembershipStatus.LEFT, leftAt: now },
      }),
      this.prisma.tripMembership.deleteMany({ where: { userId, status: MembershipStatus.REQUESTED } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.oAuthAccount.deleteMany({ where: { userId } }),
      this.prisma.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
      this.prisma.trustScoreEvent.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { ...anonymisedProfile(userId, now), preferenceTags: { set: [] } },
      }),
    ]);

    // Take effect on this instance immediately rather than after the cache expires.
    this.accounts.invalidate(userId);
    return { deleted: true };
  }

  /** A stolen session shouldn't be enough to erase someone, so it asks again. */
  private async assertIsThem(user: { email: string; passwordHash: string | null }, dto: DeleteAccountDto) {
    if (user.passwordHash) {
      const matches = !!dto.password && (await bcrypt.compare(dto.password, user.passwordHash));
      if (!matches) throw new ForbiddenException('That password is not correct');
      return;
    }
    // No password (signed up with Google): typing the email is the confirmation we have.
    if (dto.confirmEmail?.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('Type your email address exactly to confirm');
    }
  }
}
