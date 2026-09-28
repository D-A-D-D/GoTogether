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

export class CreateTripDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MaxLength(120)
  destination!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  flexibleDates?: boolean;

  @IsInt()
  @Min(0)
  budgetMin!: number;

  @IsInt()
  @Min(0)
  budgetMax!: number;

  @IsInt()
  @Min(2)
  capacity!: number;

  // Up to three, and public once the trip is created (BLUEPRINT §01/§04).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  includeTagIds?: string[];

  // Private — only STYLE-category tags are eligible (enforced in the
  // service, not just here, since Prisma can't check a relation's category).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  excludeTagIds?: string[];

  // Visible, explicit alternative to identity-based exclusion (BLUEPRINT §01).
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
