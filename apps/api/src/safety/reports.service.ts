import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MembershipStatus, ReportStatus } from '../generated/prisma/index.js';
import { CreateReportDto } from './dto/create-report.dto.js';

/** More than this many reports from one person in a day is flooding, not reporting. */
export const MAX_REPORTS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Collects reports for a human to review (BLUEPRINT §08). Nothing happens
 * automatically yet: the blueprint's "threshold breaches auto-suspend pending
 * human review" needs a reviewer interface and a decision on thresholds first,
 * and suspending someone with no way for anyone to look at it would just lock
 * people out. Until then a report is a record.
 *
 * The guards are about not becoming a harassment tool: you can only report
 * someone you've actually been on a trip with, only once while a report on
 * them is still open, and only a few a day.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reporterId: string, dto: CreateReportDto) {
    if (dto.reportedId === reporterId) throw new BadRequestException("You can't report yourself");

    const reported = await this.prisma.user.findUnique({ where: { id: dto.reportedId }, select: { id: true } });
    if (!reported) throw new NotFoundException('User not found');

    // "Been on a trip with": both held an approved membership on the same
    // trip (approved now, or approved and later left or removed).
    const everApproved = [{ status: MembershipStatus.APPROVED }, { leftAt: { not: null } }];
    const shared = await this.prisma.tripMembership.findFirst({
      where: {
        userId: dto.reportedId,
        ...(dto.tripId ? { tripId: dto.tripId } : {}),
        OR: everApproved,
        trip: { memberships: { some: { userId: reporterId, OR: everApproved } } },
      },
      select: { tripId: true },
    });
    if (!shared) throw new ForbiddenException("You can only report people you've been on a trip with");

    const open = await this.prisma.report.findFirst({
      where: {
        reporterId,
        reportedId: dto.reportedId,
        status: { in: [ReportStatus.OPEN, ReportStatus.REVIEWING] },
      },
      select: { id: true },
    });
    if (open) throw new ConflictException("You've already reported this person — it's being looked at");

    const recent = await this.prisma.report.count({
      where: { reporterId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (recent >= MAX_REPORTS_PER_DAY) {
      throw new HttpException(
        "You've sent several reports today — please try again tomorrow",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.prisma.report.create({
      data: {
        reporterId,
        reportedId: dto.reportedId,
        tripId: dto.tripId ?? shared.tripId,
        reason: dto.reason,
        details: dto.details,
      },
      // The reporter gets an acknowledgement, nothing more.
      select: { id: true, createdAt: true },
    });
  }
}
