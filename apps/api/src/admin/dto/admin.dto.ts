import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AccountStatus, ReportStatus } from '../../generated/prisma/index.js';

// DELETED is something a person does to their own account (see the account module);
// a moderator can restrict or reinstate, never delete.
const MODERATOR_STATUSES = [AccountStatus.ACTIVE, AccountStatus.SUSPENDED, AccountStatus.BANNED];

export class ListReportsDto {
  // Omitted: the open queue (OPEN and REVIEWING). Pass ACTIONED or DISMISSED for history.
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class ReviewReportDto {
  // A report only moves forward; it can't be reopened.
  @IsIn([ReportStatus.REVIEWING, ReportStatus.ACTIONED, ReportStatus.DISMISSED])
  status!: typeof ReportStatus.REVIEWING | typeof ReportStatus.ACTIONED | typeof ReportStatus.DISMISSED;

  // Required (checked in the service) to close a report: ACTIONED or DISMISSED.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution?: string;
}

export class SetAccountStatusDto {
  @IsIn(MODERATOR_STATUSES)
  status!: AccountStatus;

  // Always required. It's the audit trail's whole point.
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  // The report this action closes, if it came from one.
  @IsOptional()
  @IsString()
  reportId?: string;
}
