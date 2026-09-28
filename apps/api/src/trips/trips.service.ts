import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MatchingService } from './matching.service.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { DiscoverTripsDto } from './dto/discover-trips.dto.js';
import {
  MembershipRole,
  MembershipStatus,
  Prisma,
  TagCategory,
  TripStatus,
  TripVisibility,
  type Trip,
  type Tag,
} from '../generated/prisma/index.js';

const HOST_SELECT = { id: true, name: true, trustScore: true, homeCity: true } as const;
const REQUESTER_SELECT = {
  id: true,
  name: true,
  bio: true,
  homeCity: true,
  trustScore: true,
  preferenceTags: true,
} as const;

type TripWithRelations = Trip & { includeTags: Tag[]; excludeTags: Tag[]; host: { id: string } };

/** True when `error` is the TripMembership overlap GIST exclusion constraint firing. */
function isOverlapViolation(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError) &&
    error.message.includes('trip_membership_no_overlap')
  );
}

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  /** Strips the private exclude-tag list unless the viewer is the host (BLUEPRINT §01/§09). */
  toPublicTrip<T extends { excludeTags?: unknown }>(trip: T, viewerIsHost: boolean): Omit<T, 'excludeTags'> {
    if (viewerIsHost) return trip;
    const { excludeTags: _excludeTags, ...rest } = trip;
    return rest;
  }

  async create(hostId: string, dto: CreateTripDto) {
    if (new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (dto.budgetMax < dto.budgetMin) {
      throw new BadRequestException('budgetMax must not be less than budgetMin');
    }

    if (dto.excludeTagIds?.length) {
      const excludeTags = await this.prisma.tag.findMany({ where: { id: { in: dto.excludeTagIds } } });
      if (excludeTags.length !== dto.excludeTagIds.length) {
        throw new BadRequestException('One or more excludeTagIds do not exist');
      }
      const nonStyle = excludeTags.filter((t) => t.category !== TagCategory.STYLE);
      if (nonStyle.length > 0) {
        throw new BadRequestException(
          `Only style tags can be used as exclude tags — identity-based filtering must use tripType instead: ${nonStyle.map((t) => t.name).join(', ')}`,
        );
      }
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const trip = await tx.trip.create({
            data: {
              hostId,
              title: dto.title,
              description: dto.description,
              destination: dto.destination,
              startDate: new Date(dto.startDate),
              endDate: new Date(dto.endDate),
              flexibleDates: dto.flexibleDates ?? false,
              budgetMin: dto.budgetMin,
              budgetMax: dto.budgetMax,
              capacity: dto.capacity,
              tripType: dto.tripType,
              coverPhotoUrl: dto.coverPhotoUrl,
              visibility: dto.visibility ?? TripVisibility.PUBLIC,
              status: TripStatus.OPEN,
              includeTags: dto.includeTagIds ? { connect: dto.includeTagIds.map((id) => ({ id })) } : undefined,
              excludeTags: dto.excludeTagIds ? { connect: dto.excludeTagIds.map((id) => ({ id })) } : undefined,
            },
            include: { includeTags: true, excludeTags: true, host: { select: HOST_SELECT } },
          });

          await tx.tripMembership.create({
            data: {
              tripId: trip.id,
              userId: hostId,
              role: MembershipRole.HOST,
              status: MembershipStatus.APPROVED,
              respondedAt: new Date(),
            },
          });

          // The host's own membership above is the trip's first approval,
          // so the room is created right here rather than waiting on a
          // separate "first approval" event (BLUEPRINT §06).
          await tx.chatRoom.create({ data: { tripId: trip.id } });

          return trip;
        },
        // Neon's pooled endpoint can add real latency to the first query of a
        // transaction (cold-start reconnect) — the 5s default timeout isn't
        // always enough, unlike a local Postgres.
        { timeout: 15000 },
      );
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new ConflictException('You already have an approved trip during these dates');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BadRequestException('One or more includeTagIds do not exist');
      }
      throw error;
    }
  }

  async listHosted(hostId: string) {
    return this.prisma.trip.findMany({
      where: { hostId },
      include: { includeTags: true, excludeTags: true, host: { select: HOST_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async discover(userId: string, dto: DiscoverTripsDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { preferenceTags: true },
    });

    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    });
    const blockedHostIds = new Set(
      blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)),
    );

    const ownMemberships = await this.prisma.tripMembership.findMany({
      where: { userId },
      select: { tripId: true },
    });
    const alreadyInteractedTripIds = ownMemberships.map((m) => m.tripId);

    const approvedWindows = await this.prisma.tripMembership.findMany({
      where: { userId, status: MembershipStatus.APPROVED },
      include: { trip: { select: { startDate: true, endDate: true } } },
    });

    const candidates = await this.prisma.trip.findMany({
      where: {
        status: TripStatus.OPEN,
        visibility: TripVisibility.PUBLIC,
        hostId: { notIn: [...blockedHostIds, userId] },
        id: { notIn: alreadyInteractedTripIds },
        ...(dto.destination ? { destination: { contains: dto.destination, mode: 'insensitive' } } : {}),
      },
      include: { includeTags: true, excludeTags: true, host: { select: HOST_SELECT } },
    });

    const userTagIds = new Set(user.preferenceTags.map((t) => t.id));

    const eligible = candidates.filter((trip) => {
      const excludedByTags = trip.excludeTags.some((t) => userTagIds.has(t.id));
      if (excludedByTags) return false;

      const overlapsApprovedTrip = approvedWindows.some(
        (m) => trip.startDate <= m.trip.endDate && m.trip.startDate <= trip.endDate,
      );
      return !overlapsApprovedTrip;
    });

    const scored = eligible
      .map((trip) => ({
        ...this.toPublicTrip(trip, false),
        matchScore: this.matching.score(user, trip, {
          budgetMin: dto.budgetMin,
          budgetMax: dto.budgetMax,
          startDate: dto.startDate,
          endDate: dto.endDate,
        }),
      }))
      .sort((a, b) => b.matchScore - a.matchScore);

    return scored.slice(0, dto.limit ?? 20);
  }

  async findById(tripId: string, requestingUserId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { includeTags: true, excludeTags: true, host: { select: HOST_SELECT } },
    });
    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    const [approvedCount, myMembership] = await Promise.all([
      this.prisma.tripMembership.count({ where: { tripId, status: MembershipStatus.APPROVED } }),
      this.prisma.tripMembership.findUnique({
        where: { tripId_userId: { tripId, userId: requestingUserId } },
        select: { status: true, role: true },
      }),
    ]);

    const viewerIsHost = trip.hostId === requestingUserId;
    return {
      ...this.toPublicTrip(trip, viewerIsHost),
      approvedCount,
      myMembership: myMembership ?? null,
    };
  }

  private async getTripOrThrow(tripId: string): Promise<TripWithRelations> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { includeTags: true, excludeTags: true, host: { select: { id: true } } },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  async requestToJoin(tripId: string, userId: string) {
    const trip = await this.getTripOrThrow(tripId);

    if (trip.host.id === userId) {
      throw new BadRequestException("You can't request to join your own trip");
    }
    if (trip.status !== TripStatus.OPEN) {
      throw new BadRequestException('This trip is not open for requests');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { preferenceTags: true },
    });
    const userTagIds = new Set(user.preferenceTags.map((t) => t.id));
    if (trip.excludeTags.some((t) => userTagIds.has(t.id))) {
      throw new ForbiddenException("You're not eligible to join this trip");
    }

    const existing = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId } },
    });
    if (existing) {
      throw new ConflictException('You have already requested or joined this trip');
    }

    const approvedCount = await this.prisma.tripMembership.count({
      where: { tripId, status: MembershipStatus.APPROVED },
    });
    if (approvedCount >= trip.capacity) {
      throw new ConflictException('This trip is full');
    }

    try {
      return await this.prisma.tripMembership.create({
        data: { tripId, userId, role: MembershipRole.MEMBER, status: MembershipStatus.REQUESTED },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already requested or joined this trip');
      }
      throw error;
    }
  }

  async listRequests(tripId: string, hostUserId: string) {
    await this.assertIsHost(tripId, hostUserId);
    return this.prisma.tripMembership.findMany({
      where: { tripId, status: MembershipStatus.REQUESTED },
      include: { user: { select: REQUESTER_SELECT } },
      orderBy: { requestedAt: 'asc' },
    });
  }

  async respondToRequest(
    tripId: string,
    membershipId: string,
    hostUserId: string,
    decision: typeof MembershipStatus.APPROVED | typeof MembershipStatus.REJECTED,
  ) {
    const trip = await this.assertIsHost(tripId, hostUserId);

    const membership = await this.prisma.tripMembership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.tripId !== tripId) {
      throw new NotFoundException('Request not found');
    }
    if (membership.status !== MembershipStatus.REQUESTED) {
      throw new ConflictException('This request has already been responded to');
    }

    if (decision === MembershipStatus.REJECTED) {
      return this.prisma.tripMembership.update({
        where: { id: membershipId },
        data: { status: MembershipStatus.REJECTED, respondedAt: new Date() },
      });
    }

    const approvedCount = await this.prisma.tripMembership.count({
      where: { tripId, status: MembershipStatus.APPROVED },
    });
    if (approvedCount >= trip.capacity) {
      throw new ConflictException('This trip is already full');
    }

    try {
      const updated = await this.prisma.tripMembership.update({
        where: { id: membershipId },
        data: { status: MembershipStatus.APPROVED, respondedAt: new Date() },
      });

      if (approvedCount + 1 >= trip.capacity) {
        await this.prisma.trip.update({ where: { id: tripId }, data: { status: TripStatus.FULL } });
      }

      return updated;
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new ConflictException('This user already has an approved trip during these dates');
      }
      throw error;
    }
  }

  /**
   * A user leaving their own membership. A REQUESTED row is deleted
   * outright (withdrawing a request should let them request again later —
   * @@unique([tripId, userId]) would otherwise block that forever). An
   * APPROVED row is marked LEFT instead of deleted: it's a real event in
   * the trip's history, and the unique constraint correctly prevents
   * rejoining a trip once you've left it.
   */
  async leave(tripId: string, userId: string) {
    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId } },
    });
    if (!membership) {
      throw new NotFoundException("You don't have a membership on this trip");
    }
    if (membership.role === MembershipRole.HOST) {
      throw new BadRequestException("The host can't leave their own trip");
    }

    if (membership.status === MembershipStatus.REQUESTED) {
      await this.prisma.tripMembership.delete({ where: { id: membership.id } });
      return { status: MembershipStatus.LEFT };
    }
    if (membership.status !== MembershipStatus.APPROVED) {
      throw new ConflictException('This membership is already settled — nothing to leave');
    }

    const updated = await this.prisma.tripMembership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.LEFT, leftAt: new Date() },
    });
    await this.reopenIfNoLongerFull(tripId);
    return updated;
  }

  /** Host-initiated removal of an approved member — same reopen-if-needed behavior as leave(). */
  async removeMember(tripId: string, membershipId: string, hostUserId: string) {
    await this.assertIsHost(tripId, hostUserId);

    const membership = await this.prisma.tripMembership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.tripId !== tripId) {
      throw new NotFoundException('Member not found');
    }
    if (membership.role === MembershipRole.HOST) {
      throw new BadRequestException("The host can't remove themselves");
    }
    if (membership.status !== MembershipStatus.APPROVED) {
      throw new ConflictException('This user is not an approved member of this trip');
    }

    const updated = await this.prisma.tripMembership.update({
      where: { id: membershipId },
      data: { status: MembershipStatus.REMOVED, leftAt: new Date() },
    });
    await this.reopenIfNoLongerFull(tripId);
    return updated;
  }

  /** A trip marked FULL that just lost an approved member should accept requests again. */
  private async reopenIfNoLongerFull(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.status !== TripStatus.FULL) return;

    const approvedCount = await this.prisma.tripMembership.count({
      where: { tripId, status: MembershipStatus.APPROVED },
    });
    if (approvedCount < trip.capacity) {
      await this.prisma.trip.update({ where: { id: tripId }, data: { status: TripStatus.OPEN } });
    }
  }

  private async assertIsHost(tripId: string, userId: string): Promise<Trip> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.hostId !== userId) {
      throw new ForbiddenException('Only the host can do this');
    }
    return trip;
  }
}
