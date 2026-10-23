import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { TripVisibility } from '../../generated/prisma/index.js';

// Every field optional: only what's sent is changed. Mirrors CreateTripDto's
// validators (there's no mapped-types package to derive it from). The rules
// that depend on the trip's current state — dates, capacity vs. who's already
// approved, which statuses can be edited — live in TripsService.update.
export class UpdateTripDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  // An empty string clears it.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destination?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  flexibleDates?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMax?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  capacity?: number;

  // Replaces the whole list when present (an empty array clears it).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  includeTagIds?: string[];

  // Private, STYLE tags only (checked in the service). Replaces the whole list when present.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  excludeTagIds?: string[];

  // An empty string clears it.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tripType?: string;

  @IsOptional()
  @IsUrl()
  coverPhotoUrl?: string;

  @IsOptional()
  @IsIn([TripVisibility.PUBLIC, TripVisibility.UNLISTED])
  visibility?: TripVisibility;
}
