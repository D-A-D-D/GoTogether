import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { REPORT_REASONS, type ReportReason } from '../../safety/report-reasons.js';

/** Removing someone can also report them, in the same step: a reason sends a report for people to review. */
export class RemoveMemberDto {
  @IsOptional()
  @IsIn(REPORT_REASONS)
  reason?: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;
}
