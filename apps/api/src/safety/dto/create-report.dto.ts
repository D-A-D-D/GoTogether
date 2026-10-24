import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { REPORT_REASONS, type ReportReason } from '../report-reasons.js';

export class CreateReportDto {
  @IsString()
  reportedId!: string;

  @IsIn(REPORT_REASONS)
  reason!: ReportReason;

  // Optional context; the person's own words, for whoever reviews it.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;

  // The trip this happened on. Must be one both people were on; when
  // omitted, a trip they share is recorded for the reviewer's benefit.
  @IsOptional()
  @IsString()
  tripId?: string;
}
