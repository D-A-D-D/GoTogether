import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * The user's travel intent for this search. Deliberately NOT stored on the
 * User profile: budget/dates for a trip search vary session to session (a
 * budget backpacking trip this month, a comfortable one next), so they're
 * captured as query params rather than a fixed preference (see
 * MatchingService for how missing params affect scoring).
 */
export class DiscoverTripsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetMax?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  // How many results to skip — for "show more". Results are ordered
  // deterministically (see discover-paging.ts), so offset paging is stable.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
