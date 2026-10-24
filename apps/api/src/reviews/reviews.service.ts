import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MembershipStatus, TripStatus, type Review, type Trip } from '../generated/prisma/index.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const PUBLIC_SELECT = { id: true, name: true, trustScore: true } as const;

// BLUEPRINT §05 tuning constants. Deliberately in one place, not scattered
// through the formula below — same "live in config, not code" spirit as
// the matching weights, and the first things worth adjusting once there's
// real review data to tune against.
const BLIND_WINDOW_DAYS = 14;
const K_NEW = 6; // first K_NEW_TRIP_THRESHOLD completed trips — fast, uncertain signal
const K_ESTABLISHED = 3; // afterward — more stable
const K_NEW_TRIP_THRESHOLD = 5;
const SHORT_TRIP_DURATION_WEIGHT = 0.5; // trips under a day count for less
const PER_TRIP_CAP = 15; // max total |trust movement| one trip can cause for a given reviewee

function ratingNormalized(review: {
  reliability: number;
  friendliness: number;
  communication: number;
  cleanliness: number;
}): number {
  const avg = (review.reliability + review.friendliness + review.communication + review.cleanliness) / 4;
  return (avg - 1) / 4; // 1..5 -> 0..1
}

/** Scales `newDelta` down (possibly to 0, or flips sign) so priorSum + result never exceeds ±cap. */
function clampToTripCap(priorSum: number, newDelta: number, cap: number): number {
  const prospective = priorSum + newDelta;
  if (Math.abs(prospective) <= cap) return newDelta;
  const clampedProspective = Math.sign(prospective) * cap;
  return Math.round(clampedProspective - priorSum);
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** "Held approved membership" per BLUEPRINT §05 — currently approved, or approved-then-left/removed. */
  private async assertEverApprovedMember(tripId: string, userId: string): Promise<void> {
    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId } },
    });
    const wasApproved =
      membership && (membership.status === MembershipStatus.APPROVED || membership.leftAt !== null);
    if (!wasApproved) {
      throw new ForbiddenException('Only trip members who held an approved membership can do this');
    }
  }

  async create(tripId: string, reviewerId: string, dto: CreateReviewDto) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.status !== TripStatus.COMPLETED) {
      throw new BadRequestException('Reviews open only once a trip is marked completed');
    }
    if (dto.revieweeId === reviewerId) {
      throw new BadRequestException("You can't review yourself");
    }

    await this.assertEverApprovedMember(tripId, reviewerId);
    await this.assertEverApprovedMember(tripId, dto.revieweeId);

    const existing = await this.prisma.review.findUnique({
      where: { tripId_reviewerId_revieweeId: { tripId, reviewerId, revieweeId: dto.revieweeId } },
    });
    if (existing) {
      throw new ConflictException("You've already reviewed this person for this trip");
    }

    const review = await this.prisma.review.create({
      data: {
        tripId,
        reviewerId,
        revieweeId: dto.revieweeId,
        reliability: dto.reliability,
        friendliness: dto.friendliness,
        communication: dto.communication,
        cleanliness: dto.cleanliness,
        comment: dto.comment,
      },
    });

    // Mutual trigger: if the reviewee already reviewed the reviewer back,
    // both directions resolve right now — the blind window's whole point
    // is to stop one side's score/content leaking before the other has
    // committed to theirs, and that risk is over the moment both exist.
    const reciprocal = await this.prisma.review.findUnique({
      where: { tripId_reviewerId_revieweeId: { tripId, reviewerId: dto.revieweeId, revieweeId: reviewerId } },
    });
    if (reciprocal) {
      await this.processReview(review, trip);
      await this.processReview(reciprocal, trip);
    }

    // Lazy timeout sweep — see docs/IDEAS.md on why this piggybacks on
    // requests rather than a real scheduled job (no worker/queue infra yet).
    await this.sweepExpiredReviews(tripId, trip);

    return review;
  }

  async listPending(tripId: string, userId: string) {
    await this.assertEverApprovedMember(tripId, userId);

    const members = await this.prisma.tripMembership.findMany({
      where: {
        tripId,
        userId: { not: userId },
        OR: [{ status: MembershipStatus.APPROVED }, { leftAt: { not: null } }],
      },
      include: { user: { select: PUBLIC_SELECT } },
    });

    const reviewed = await this.prisma.review.findMany({
      where: { tripId, reviewerId: userId },
      select: { revieweeId: true },
    });
    const reviewedIds = new Set(reviewed.map((r) => r.revieweeId));

    return members.filter((m) => !reviewedIds.has(m.userId)).map((m) => m.user);
  }

  async listReceived(tripId: string, userId: string) {
    await this.assertEverApprovedMember(tripId, userId);

    const trip = await this.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    await this.sweepExpiredReviews(tripId, trip);

    // Only ever returns processed (blind-window-resolved) reviews — an
    // unprocessed one about you is exactly what the blind window exists
    // to keep you from seeing yet.
    return this.prisma.review.findMany({
      where: { tripId, revieweeId: userId, processedAt: { not: null } },
      include: { reviewer: { select: PUBLIC_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async sweepExpiredReviews(tripId: string, trip: Trip): Promise<void> {
    const cutoff = new Date(Date.now() - BLIND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const stale = await this.prisma.review.findMany({
      where: { tripId, processedAt: null, createdAt: { lte: cutoff } },
    });
    for (const review of stale) {
      await this.processReview(review, trip);
    }
  }

  /**
   * Applies one review's trust-score delta and marks it processed. ELO-
   * inspired (BLUEPRINT §05): `delta = K × reviewerWeight × durationWeight
   * × (rating − expected)`, where `expected` is the reviewee's OWN current
   * score (as a 0–1 fraction) — a rating that merely confirms it moves the
   * score little; one that contradicts it moves the score more. `K` shrinks
   * once the reviewee has enough trip history that their score should be
   * more stable. `reviewerWeight` is the anti-gaming piece: a low-trust
   * reviewer can't swing someone else's score as hard as an established one.
   */
  private async processReview(review: Review, trip: Trip): Promise<void> {
    if (review.processedAt) return;

    const [reviewee, reviewer] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: review.revieweeId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: review.reviewerId } }),
    ]);

    const completedTripCount = await this.prisma.tripMembership.count({
      where: {
        userId: review.revieweeId,
        trip: { status: TripStatus.COMPLETED },
        OR: [{ status: MembershipStatus.APPROVED }, { leftAt: { not: null } }],
      },
    });

    const k = completedTripCount <= K_NEW_TRIP_THRESHOLD ? K_NEW : K_ESTABLISHED;
    const durationDays = (trip.endDate.getTime() - trip.startDate.getTime()) / (24 * 60 * 60 * 1000);
    const durationWeight = durationDays < 1 ? SHORT_TRIP_DURATION_WEIGHT : 1;
    const reviewerWeight = reviewer.trustScore / 100;
    const expected = reviewee.trustScore / 100;
    const rating = ratingNormalized(review);

    let delta = Math.round(k * reviewerWeight * durationWeight * (rating - expected));

    const priorAgg = await this.prisma.trustScoreEvent.aggregate({
      where: { userId: review.revieweeId, tripId: review.tripId },
      _sum: { delta: true },
    });
    delta = clampToTripCap(priorAgg._sum.delta ?? 0, delta, PER_TRIP_CAP);

    const newScore = Math.max(0, Math.min(100, reviewee.trustScore + delta));

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: review.revieweeId }, data: { trustScore: newScore } }),
      this.prisma.trustScoreEvent.create({
        data: {
          userId: review.revieweeId,
          delta,
          reason: `Review from trip ${review.tripId}`,
          resultingScore: newScore,
          sourceReviewId: review.id,
          tripId: review.tripId,
        },
      }),
      this.prisma.review.update({ where: { id: review.id }, data: { processedAt: new Date() } }),
    ]);

    // Only ever fires once the blind window has actually resolved — the
    // notification itself can't leak anything early since this whole
    // method only runs at that point.
    await this.notifications.notifyUser(review.revieweeId, {
      title: 'New review received',
      body:
        delta === 0
          ? "A teammate's review of you came in"
          : `Your trust score just ${delta > 0 ? 'went up' : 'went down'} — a review came in`,
      url: `/trips/${review.tripId}/reviews`,
    });
  }

  /**
   * The caller's own trust history, newest first, with the title of the trip
   * each change came from. `TrustScoreEvent.tripId` is a plain column (no
   * relation), so titles are looked up in one extra query. A trip that has
   * since been deleted just has no title.
   */
  async listMyTrustEvents(userId: string) {
    const events = await this.prisma.trustScoreEvent.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const tripIds = [...new Set(events.flatMap((e) => (e.tripId ? [e.tripId] : [])))];
    const trips = tripIds.length
      ? await this.prisma.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, title: true } })
      : [];
    const titleById = new Map(trips.map((t) => [t.id, t.title]));

    return events.map((e) => ({ ...e, tripTitle: e.tripId ? (titleById.get(e.tripId) ?? null) : null }));
  }
}
