import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountStateService } from '../auth/account-state.service.js';
import type { RequestUser } from '../auth/current-user.decorator.js';
import { AccountStatus, ReportStatus, UserRole } from '../generated/prisma/index.js';
import type { ReviewReportDto, SetAccountStatusDto } from './dto/admin.dto.js';

const OPEN_QUEUE = [ReportStatus.OPEN, ReportStatus.REVIEWING];
const QUEUE_LIMIT = 100;

/**
 * What a moderator can do (BLUEPRINT §08: "pending human review"). Every
 * decision here is a person's — nothing is automatic — and the rules are about
 * keeping a mistaken or abusive moderator from doing harm unseen:
 *  - every status change is written to an append-only audit trail with the
 *    moderator's reason;
 *  - you can't review a report you're part of, change your own status, or
 *    suspend another admin (demote them first, which needs database access);
 *  - restricting an account revokes its refresh tokens in the same transaction,
 *    so its sessions can't be extended, and clears the cached status so the
 *    API stops accepting it at once.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountStateService,
  ) {}

  /**
   * The report queue, oldest first, each report with context a reviewer needs
   * to judge it in proportion: how many other open reports the same person has
   * and from how many different people, and how many people have blocked them.
   * One report, or a pile-on from one person, reads very differently from
   * several independent reports.
   */
  async listReports(status?: ReportStatus) {
    const reports = await this.prisma.report.findMany({
      where: { status: status ? status : { in: OPEN_QUEUE } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        tripId: true,
        resolution: true,
        reviewedAt: true,
        reviewedBy: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true, trustScore: true } },
        reported: { select: { id: true, name: true, trustScore: true, accountStatus: true } },
      },
    });

    const reportedIds = [...new Set(reports.map((r) => r.reported.id))];
    const tripIds = [...new Set(reports.flatMap((r) => (r.tripId ? [r.tripId] : [])))];

    const [openAgainst, blockCounts, trips] = reportedIds.length
      ? await Promise.all([
          this.prisma.report.findMany({
            where: { reportedId: { in: reportedIds }, status: { in: OPEN_QUEUE } },
            select: { reportedId: true, reporterId: true },
          }),
          this.prisma.block.groupBy({
            by: ['blockedId'],
            where: { blockedId: { in: reportedIds } },
            _count: { _all: true },
          }),
          tripIds.length
            ? this.prisma.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, title: true } })
            : Promise.resolve([]),
        ])
      : [[], [], []];

    const openCount = new Map<string, number>();
    const reporters = new Map<string, Set<string>>();
    for (const row of openAgainst) {
      openCount.set(row.reportedId, (openCount.get(row.reportedId) ?? 0) + 1);
      reporters.set(row.reportedId, (reporters.get(row.reportedId) ?? new Set()).add(row.reporterId));
    }
    const blockedBy = new Map(blockCounts.map((b) => [b.blockedId, b._count._all]));
    const titleById = new Map(trips.map((t) => [t.id, t.title]));

    return reports.map((r) => ({
      ...r,
      tripTitle: r.tripId ? (titleById.get(r.tripId) ?? null) : null,
      context: {
        openReportsAgainstThem: openCount.get(r.reported.id) ?? 0,
        distinctReportersAgainstThem: reporters.get(r.reported.id)?.size ?? 0,
        blockedByCount: blockedBy.get(r.reported.id) ?? 0,
      },
    }));
  }

  /** Moves a report forward: start reviewing it, or close it with a note on how it was resolved. */
  async reviewReport(actor: RequestUser, reportId: string, dto: ReviewReportDto) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');

    if (actor.userId === report.reporterId || actor.userId === report.reportedId) {
      throw new ForbiddenException("You can't review a report you're part of");
    }
    if (report.status === ReportStatus.ACTIONED || report.status === ReportStatus.DISMISSED) {
      throw new ConflictException('This report has already been resolved');
    }
    if (dto.status === ReportStatus.REVIEWING && report.status === ReportStatus.REVIEWING) {
      throw new ConflictException('This report is already being reviewed');
    }

    const resolution = dto.resolution?.trim();
    const closing = dto.status === ReportStatus.ACTIONED || dto.status === ReportStatus.DISMISSED;
    if (closing && !resolution) {
      throw new BadRequestException('A note on how it was resolved is required to close a report');
    }

    return this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: dto.status,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        ...(closing ? { resolution } : {}),
      },
      select: { id: true, status: true, reviewedAt: true, resolution: true },
    });
  }

  /**
   * Suspend, ban or reinstate an account — the one action in the app that can
   * lock someone out, so it's the most constrained. See the class comment for
   * the rules; the transaction below applies them together or not at all.
   */
  async setAccountStatus(actor: RequestUser, targetId: string, dto: SetAccountStatusDto) {
    if (actor.userId === targetId) {
      throw new BadRequestException("You can't change your own account's status");
    }
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('A reason is required');

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, accountStatus: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === UserRole.ADMIN) {
      throw new ForbiddenException("An admin's account can't be restricted here — change their role first");
    }
    // Scrubbed and gone: there is nobody left to restrict or reinstate.
    if (target.accountStatus === AccountStatus.DELETED) {
      throw new ConflictException('This account has been deleted');
    }
    if (target.accountStatus === dto.status) {
      throw new ConflictException(`This account is already ${dto.status.toLowerCase()}`);
    }

    if (dto.reportId) {
      const report = await this.prisma.report.findUnique({ where: { id: dto.reportId } });
      if (!report || report.reportedId !== targetId) {
        throw new BadRequestException("That report isn't about this account");
      }
      if (actor.userId === report.reporterId) {
        throw new ForbiddenException("You can't act on a report you filed");
      }
      if (report.status === ReportStatus.ACTIONED || report.status === ReportStatus.DISMISSED) {
        throw new ConflictException('That report has already been resolved');
      }
    }

    const restricting = dto.status !== AccountStatus.ACTIVE;
    const now = new Date();

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetId },
        data: { accountStatus: dto.status },
        select: { id: true, accountStatus: true },
      }),
      this.prisma.moderationAction.create({
        data: {
          actorId: actor.userId,
          targetId,
          fromStatus: target.accountStatus,
          toStatus: dto.status,
          reason,
          reportId: dto.reportId,
        },
      }),
      // Restricting ends their sessions: without this they could keep refreshing their way back in.
      ...(restricting
        ? [this.prisma.refreshToken.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: now } })]
        : []),
      ...(dto.reportId
        ? [
            this.prisma.report.update({
              where: { id: dto.reportId },
              data: {
                status: ReportStatus.ACTIONED,
                reviewedById: actor.userId,
                reviewedAt: now,
                resolution: reason,
              },
            }),
          ]
        : []),
    ]);

    // After the commit, so no request can re-cache the old status in between.
    this.accounts.invalidate(targetId);
    return updated;
  }

  /** Accounts currently suspended or closed, with the latest decision on each. */
  async listRestricted() {
    const users = await this.prisma.user.findMany({
      where: { accountStatus: { notIn: [AccountStatus.ACTIVE, AccountStatus.DELETED] } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        name: true,
        trustScore: true,
        accountStatus: true,
        moderationsReceived: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { reason: true, createdAt: true, actor: { select: { id: true, name: true } } },
        },
      },
    });
    return users.map(({ moderationsReceived, ...user }) => ({ ...user, lastDecision: moderationsReceived[0] ?? null }));
  }
}
