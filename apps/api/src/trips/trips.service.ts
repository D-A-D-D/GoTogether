import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MatchingService } from './matching.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { BlocksService } from '../safety/blocks.service.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { DiscoverTripsDto } from './dto/discover-trips.dto.js';
import { UpdateTripDto } from './dto/update-trip.dto.js';
import { compareDiscovered, pageOf } from './discover-paging.js';
import { MIN_APPROVED_MEMBERS_TO_COMPLETE, hasTripEnded, isSameUtcDay, startOfUtcDay, startsInThePast } from './trip-rules.js';
import {
  AccountStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
  TagCategory,
  TripStatus,
  TripVisibility,
  type Trip,
  type Tag,
} from '../generated/prisma/index.js';

const HOST_SELECT = { id: true, name: true, trustScore: true, homeCity: true, avatarUpdatedAt: true } as const;
const REQUESTER_SELECT = {
  id: true,
  name: true,
  bio: true,
  homeCity: true,
  trustScore: true,
  avatarUpdatedAt: true,
  preferenceTags: true,
} as const;

type TripWithRelations = Trip & {
  includeTags: Tag[];
  excludeTags: Tag[];
  host: { id: string; accountStatus: AccountStatus };
};

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
    private readonly notifications: NotificationsService,
    private readonly blocks: BlocksService,
  ) {}

  /** Strips the private exclude-tag list unless the viewer is the host (BLUEPRINT §01/§09). */
  toPublicTrip<T extends { excludeTags?: unknown }>(trip: T, viewerIsHost: boolean): Omit<T, 'excludeTags'> {
    if (viewerIsHost) return trip;
    const { excludeTags: _excludeTags, ...rest } = trip;
    return rest;
  }

  /** Every tag id must exist, and exclude tags must be STYLE-category (BLUEPRINT §01) — shared by create and update. */
  private async assertTagsValid(includeTagIds?: string[], excludeTagIds?: string[]): Promise<void> {
    if (includeTagIds?.length) {
      const found = await this.prisma.tag.count({ where: { id: { in: includeTagIds } } });
      if (found !== new Set(includeTagIds).size) {
        throw new BadRequestException('One or more includeTagIds do not exist');
      }
    }
    if (excludeTagIds?.length) {
      const excludeTags = await this.prisma.tag.findMany({ where: { id: { in: excludeTagIds } } });
      if (excludeTags.length !== excludeTagIds.length) {
        throw new BadRequestException('One or more excludeTagIds do not exist');
      }
      const nonStyle = excludeTags.filter((t) => t.category !== TagCategory.STYLE);
      if (nonStyle.length > 0) {
        throw new BadRequestException(
          `Only style tags can be used as exclude tags — identity-based filtering must use tripType instead: ${nonStyle.map((t) => t.name).join(', ')}`,
        );
      }
    }
  }

  async create(hostId: string, dto: CreateTripDto) {
    if (new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (startsInThePast(new Date(dto.startDate), new Date())) {
      throw new BadRequestException("A trip can't start in the past — pick today or a later date");
    }
    if (dto.budgetMax < dto.budgetMin) {
      throw new BadRequestException('budgetMax must not be less than budgetMin');
    }

    await this.assertTagsValid(dto.includeTagIds, dto.excludeTagIds);

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
      relationLoadStrategy: 'join',
      where: { hostId },
      include: { includeTags: true, excludeTags: true, host: { select: HOST_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Every trip this user has any relationship to — hosting (role=HOST is
   * just a TripMembership row like any other, auto-created at trip
   * creation) and every trip they've requested or joined, at any status.
   * A list view, so excludeTags is left out entirely rather than deciding
   * per-row whether this viewer is the host — the trip detail page
   * (findById) is where that per-viewer privacy check actually lives.
   */
  async listMine(userId: string) {
    return this.prisma.tripMembership.findMany({
      relationLoadStrategy: 'join',
      where: { userId },
      include: {
        trip: { include: { includeTags: true, host: { select: HOST_SELECT } } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async discover(userId: string, dto: DiscoverTripsDto) {
    // Three independent lookups, run together: each is a round trip to the database, and
    // one after another they were most of this page's load time. One read of the viewer's
    // memberships serves both "trips already requested or joined" and "dates already taken".
    const [user, blockedHostIds, ownMemberships] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        relationLoadStrategy: 'join',
        where: { id: userId },
        include: { preferenceTags: true },
      }),
      this.blocks.blockedWith(userId),
      this.prisma.tripMembership.findMany({
        relationLoadStrategy: 'join',
        where: { userId },
        select: { tripId: true, status: true, role: true, trip: { select: { startDate: true, endDate: true } } },
      }),
    ]);
    // A trip the viewer hosts, or is approved on, stays in the feed (it opens that trip's page); every
    // other trip they have already asked to join or left does not.
    const joinedTripIds = new Set(
      ownMemberships.filter((m) => m.role !== MembershipRole.HOST && m.status === MembershipStatus.APPROVED).map((m) => m.tripId),
    );
    const alreadyInteractedTripIds = ownMemberships
      .filter((m) => m.role !== MembershipRole.HOST && m.status !== MembershipStatus.APPROVED)
      .map((m) => m.tripId);
    const approvedWindows = ownMemberships.filter((m) => m.status === MembershipStatus.APPROVED);

    // 'join': tags and host come back in this one query rather than one query each.
    const candidates = await this.prisma.trip.findMany({
      relationLoadStrategy: 'join',
      where: {
        status: TripStatus.OPEN,
        visibility: TripVisibility.PUBLIC,
        hostId: { notIn: [...blockedHostIds] },
        // A suspended or closed host can't run a trip, so it isn't offered to anyone new.
        host: { accountStatus: AccountStatus.ACTIVE },
        id: { notIn: alreadyInteractedTripIds },
        ...(dto.destination ? { destination: { contains: dto.destination, mode: 'insensitive' } } : {}),
      },
      include: { includeTags: true, excludeTags: true, host: { select: HOST_SELECT } },
    });

    const userTagIds = new Set(user.preferenceTags.map((t) => t.id));

    const eligible = candidates.filter((trip) => {
      // Your own trip, or one you have joined, is never filtered by your tags or by the dates it takes up itself.
      if (trip.hostId === userId || joinedTripIds.has(trip.id)) return true;
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
        isOwn: trip.hostId === userId,
        isJoined: joinedTripIds.has(trip.id),
        matchScore: this.matching.score(user, trip, {
          budgetMin: dto.budgetMin,
          budgetMax: dto.budgetMax,
          startDate: dto.startDate,
          endDate: dto.endDate,
        }),
      }))
      .sort(compareDiscovered);

    return pageOf(scored, dto.offset ?? 0, dto.limit ?? 20);
  }

  async findById(tripId: string, requestingUserId: string) {
    const found = await this.prisma.trip.findUnique({
      relationLoadStrategy: 'join',
      where: { id: tripId },
      // accountStatus is for this check only — it must not reach the client in `host`.
      include: { includeTags: true, excludeTags: true, host: { select: { ...HOST_SELECT, accountStatus: true } } },
    });
    if (!found) {
      throw new NotFoundException('Trip not found');
    }
    const { accountStatus: hostStatus, ...host } = found.host;
    const trip = { ...found, host };

    const viewerIsHost = trip.hostId === requestingUserId;

    // All three at once - they depend only on the trip we already have, and each is a round
    // trip to the database. The block check is only used for an outsider, but starting it
    // alongside the others costs nothing and saves a step for the common case.
    const [approvedCount, myMembership, blockedWithHost] = await Promise.all([
      this.prisma.tripMembership.count({ where: { tripId, status: MembershipStatus.APPROVED } }),
      this.prisma.tripMembership.findUnique({
        where: { tripId_userId: { tripId, userId: requestingUserId } },
        select: { status: true, role: true },
      }),
      viewerIsHost ? Promise.resolve(false) : this.blocks.areBlocked(requestingUserId, trip.hostId),
    ]);

    // A block hides the two people from each other, trips included — as if the
    // trip didn't exist, so nothing reveals that a block is why. A suspended or
    // closed host's trip is hidden from outsiders the same way. Someone already
    // on the trip keeps access; neither a block nor a suspension removes anyone.
    if (!viewerIsHost && !myMembership) {
      if (hostStatus !== AccountStatus.ACTIVE || blockedWithHost) {
        throw new NotFoundException('Trip not found');
      }
    }

    return {
      ...this.toPublicTrip(trip, viewerIsHost),
      approvedCount,
      myMembership: myMembership ?? null,
    };
  }

  private async getTripOrThrow(tripId: string): Promise<TripWithRelations> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { includeTags: true, excludeTags: true, host: { select: { id: true, accountStatus: true } } },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  async requestToJoin(tripId: string, userId: string) {
    const trip = await this.getTripOrThrow(tripId);

    if (trip.host.id === userId) {
      throw new BadRequestException("You can't request to join your own trip");
    }
    // Same "doesn't exist" answer as viewing the trip: a block (or the host's
    // suspension) must not be discoverable.
    if (trip.host.accountStatus !== AccountStatus.ACTIVE || (await this.blocks.areBlocked(userId, trip.host.id))) {
      throw new NotFoundException('Trip not found');
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
      const membership = await this.prisma.tripMembership.create({
        data: { tripId, userId, role: MembershipRole.MEMBER, status: MembershipStatus.REQUESTED },
      });
      await this.notifications.notifyUser(trip.host.id, {
        title: 'New join request',
        body: `${user.name} wants to join "${trip.title}"`,
        url: `/trips/${tripId}`,
      });
      return membership;
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
      relationLoadStrategy: 'join',
      // Someone suspended since they asked can't take a place, so the host isn't shown them.
      where: { tripId, status: MembershipStatus.REQUESTED, user: { accountStatus: AccountStatus.ACTIVE } },
      include: { user: { select: REQUESTER_SELECT } },
      orderBy: { requestedAt: 'asc' },
    });
  }

  /**
   * Who's on the trip. Approved members only, and only visible to other
   * approved members — a pending requester or an outsider shouldn't be able
   * to enumerate the group. Exposes just name and trust score.
   */
  async listMembers(tripId: string, requesterId: string) {
    const own = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId: requesterId } },
    });
    if (!own || own.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException('Only approved trip members can see who else is on the trip');
    }
    // Blocked pairs are absent from each other's roster (BLUEPRINT §08), in both directions.
    const hidden = await this.blocks.blockedWith(requesterId);
    return this.prisma.tripMembership.findMany({
      where: {
        tripId,
        status: MembershipStatus.APPROVED,
        ...(hidden.size > 0 ? { userId: { notIn: [...hidden] } } : {}),
      },
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { id: true, name: true, trustScore: true, avatarUpdatedAt: true } },
      },
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
      const rejected = await this.prisma.tripMembership.update({
        where: { id: membershipId },
        data: { status: MembershipStatus.REJECTED, respondedAt: new Date() },
      });
      await this.notifications.notifyUser(membership.userId, {
        title: 'Request declined',
        body: `Your request to join "${trip.title}" wasn't accepted this time`,
        url: `/trips/${tripId}`,
      });
      return rejected;
    }

    // A suspended or closed account can't take a place. Answered as "not found"
    // — the request has dropped out of the host's list — and rejecting stays allowed.
    const requester = await this.prisma.user.findUnique({
      where: { id: membership.userId },
      select: { accountStatus: true },
    });
    if (requester?.accountStatus !== AccountStatus.ACTIVE) {
      throw new NotFoundException('Request not found');
    }

    // Rejecting is always fine, but approving needs a trip still taking people.
    // Without this a host could complete a trip and then approve a friend who
    // requested earlier — who'd become eligible to review, and be reviewed,
    // without having been on it (see trip-rules.ts on trust farming).
    if (trip.status !== TripStatus.OPEN && trip.status !== TripStatus.FULL) {
      throw new BadRequestException(`A ${trip.status.toLowerCase()} trip can't take new members`);
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

      await this.notifications.notifyUser(membership.userId, {
        title: "You're in!",
        body: `Your request to join "${trip.title}" was approved`,
        url: `/trips/${tripId}`,
      });

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

  /**
   * The gate reviews wait on (BLUEPRINT §05: "opens only when
   * Trip.status = completed"). Host-only, and only once the trip has
   * actually happened — its last day is over and someone other than the
   * host joined (see trip-rules.ts for why). No scheduled job flips this
   * automatically yet (see docs/IDEAS.md), so it's an explicit action.
   */
  async complete(tripId: string, hostUserId: string) {
    const trip = await this.assertIsHost(tripId, hostUserId);
    if (trip.status === TripStatus.COMPLETED) {
      throw new ConflictException('This trip is already marked completed');
    }
    if (trip.status === TripStatus.CANCELLED || trip.status === TripStatus.DRAFT) {
      throw new BadRequestException(`A trip that's ${trip.status.toLowerCase()} can't be completed`);
    }
    if (!hasTripEnded(trip.endDate, new Date())) {
      throw new BadRequestException("This trip can't be marked complete until its last day is over");
    }
    const approvedCount = await this.prisma.tripMembership.count({
      where: { tripId, status: MembershipStatus.APPROVED },
    });
    if (approvedCount < MIN_APPROVED_MEMBERS_TO_COMPLETE) {
      throw new BadRequestException(
        'A trip needs at least one other approved member before it can be marked complete — reviews are between travellers',
      );
    }
    return this.prisma.trip.update({ where: { id: tripId }, data: { status: TripStatus.COMPLETED } });
  }

  /**
   * Host edits to a trip that's still open (OPEN or FULL). Only the fields
   * sent change. The rules that depend on the trip's current state live here:
   *  - the past-date rules apply only to a date that is actually being
   *    *changed*, so a host can still fix a description on a trip that has
   *    already started;
   *  - capacity can't drop below the people already approved, and the
   *    OPEN/FULL status follows the new capacity;
   *  - a date change that would put an approved member on two trips at once
   *    is refused by the database's overlap constraint (the date-sync trigger
   *    from the overlap migration re-checks every member), and surfaced as a 409;
   *  - members are told only about changes they'd plan around.
   */
  async update(tripId: string, hostUserId: string, dto: UpdateTripDto) {
    const trip = await this.assertIsHost(tripId, hostUserId);
    if (trip.status !== TripStatus.OPEN && trip.status !== TripStatus.FULL) {
      throw new BadRequestException(`A ${trip.status.toLowerCase()} trip can't be edited`);
    }

    const now = new Date();
    // "Changed" is judged by UTC day, so re-sending the same date (the web
    // form always does) never counts as an edit — or trips the past-date rule.
    const startChanged = dto.startDate !== undefined && !isSameUtcDay(new Date(dto.startDate), trip.startDate);
    const endChanged = dto.endDate !== undefined && !isSameUtcDay(new Date(dto.endDate), trip.endDate);
    const startDate = startChanged ? new Date(dto.startDate as string) : trip.startDate;
    const endDate = endChanged ? new Date(dto.endDate as string) : trip.endDate;

    if (startChanged && startsInThePast(startDate, now)) {
      throw new BadRequestException("A trip can't start in the past — pick today or a later date");
    }
    if (endChanged && startOfUtcDay(endDate).getTime() < startOfUtcDay(now).getTime()) {
      throw new BadRequestException("A trip can't end in the past — pick today or a later date");
    }
    if (endDate < startDate) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if ((dto.budgetMax ?? trip.budgetMax) < (dto.budgetMin ?? trip.budgetMin)) {
      throw new BadRequestException('budgetMax must not be less than budgetMin');
    }

    let approvedCount: number | undefined;
    if (dto.capacity !== undefined) {
      approvedCount = await this.prisma.tripMembership.count({
        where: { tripId, status: MembershipStatus.APPROVED },
      });
      if (dto.capacity < approvedCount) {
        throw new BadRequestException(
          `Capacity can't be lower than the ${approvedCount} ${approvedCount === 1 ? 'person' : 'people'} already approved`,
        );
      }
    }

    await this.assertTagsValid(dto.includeTagIds, dto.excludeTagIds);

    const data: Prisma.TripUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description === '' ? null : dto.description;
    if (dto.destination !== undefined) data.destination = dto.destination;
    if (startChanged) data.startDate = startDate;
    if (endChanged) data.endDate = endDate;
    if (dto.flexibleDates !== undefined) data.flexibleDates = dto.flexibleDates;
    if (dto.budgetMin !== undefined) data.budgetMin = dto.budgetMin;
    if (dto.budgetMax !== undefined) data.budgetMax = dto.budgetMax;
    if (dto.capacity !== undefined && approvedCount !== undefined) {
      data.capacity = dto.capacity;
      data.status = approvedCount >= dto.capacity ? TripStatus.FULL : TripStatus.OPEN;
    }
    if (dto.tripType !== undefined) data.tripType = dto.tripType === '' ? null : dto.tripType;
    if (dto.coverPhotoUrl !== undefined) data.coverPhotoUrl = dto.coverPhotoUrl;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    if (dto.includeTagIds !== undefined) data.includeTags = { set: dto.includeTagIds.map((id) => ({ id })) };
    if (dto.excludeTagIds !== undefined) data.excludeTags = { set: dto.excludeTagIds.map((id) => ({ id })) };

    const changes: string[] = [];
    if (startChanged || endChanged) changes.push('dates');
    if (dto.destination !== undefined && dto.destination !== trip.destination) changes.push('destination');
    if (
      (dto.budgetMin !== undefined && dto.budgetMin !== trip.budgetMin) ||
      (dto.budgetMax !== undefined && dto.budgetMax !== trip.budgetMax)
    ) {
      changes.push('budget');
    }

    let updated;
    try {
      updated = await this.prisma.trip.update({
        where: { id: tripId },
        data,
        include: { includeTags: true, excludeTags: true, host: { select: HOST_SELECT } },
      });
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new ConflictException(
          "One of the approved members is already on another trip during those dates, so the trip can't move there",
        );
      }
      throw error;
    }

    if (changes.length > 0) {
      const members = await this.prisma.tripMembership.findMany({
        where: { tripId, status: MembershipStatus.APPROVED, userId: { not: hostUserId } },
        select: { userId: true },
      });
      const what = changes.length > 1 ? `${changes.slice(0, -1).join(', ')} and ${changes[changes.length - 1]}` : changes[0];
      await this.notifications.notifyUsers(
        members.map((m) => m.userId),
        { title: 'Trip updated', body: `"${updated.title}": the ${what} changed`, url: `/trips/${tripId}` },
      );
    }

    return this.toPublicTrip(updated, true);
  }

  /**
   * Host cancels a trip that's still open. Pending requests are declined, and
   * every member's date hold is released: an approved membership carries the
   * trip's date range, and the overlap constraint would otherwise keep
   * blocking those people from joining anything else that week. (`period` is
   * nullable and the constraint ignores nulls, so this needs no migration.)
   * Approved members keep their membership, so chat and expenses stay open —
   * people may still need to settle up.
   */
  async cancel(tripId: string, hostUserId: string) {
    const trip = await this.assertIsHost(tripId, hostUserId);
    if (trip.status === TripStatus.CANCELLED) {
      throw new ConflictException('This trip is already cancelled');
    }
    if (trip.status !== TripStatus.OPEN && trip.status !== TripStatus.FULL) {
      throw new BadRequestException(`A ${trip.status.toLowerCase()} trip can't be cancelled`);
    }

    const { cancelled, memberIds, requesterIds } = await this.prisma.$transaction(
      async (tx) => {
        const members = await tx.tripMembership.findMany({
          where: { tripId, status: MembershipStatus.APPROVED, userId: { not: hostUserId } },
          select: { userId: true },
        });
        const requesters = await tx.tripMembership.findMany({
          where: { tripId, status: MembershipStatus.REQUESTED },
          select: { userId: true },
        });
        const cancelled = await tx.trip.update({ where: { id: tripId }, data: { status: TripStatus.CANCELLED } });
        await tx.tripMembership.updateMany({
          where: { tripId, status: MembershipStatus.REQUESTED },
          data: { status: MembershipStatus.REJECTED, respondedAt: new Date() },
        });
        await tx.$executeRaw`UPDATE "TripMembership" SET period = NULL WHERE "tripId" = ${tripId}`;
        return {
          cancelled,
          memberIds: members.map((m) => m.userId),
          requesterIds: requesters.map((r) => r.userId),
        };
      },
      { timeout: 15000 },
    );

    await this.notifications.notifyUsers(memberIds, {
      title: 'Trip cancelled',
      body: `"${trip.title}" was cancelled by the host`,
      url: `/trips/${tripId}`,
    });
    await this.notifications.notifyUsers(requesterIds, {
      title: 'Request closed',
      body: `"${trip.title}" was cancelled, so your request is closed`,
      url: `/trips/${tripId}`,
    });

    return cancelled;
  }
}
