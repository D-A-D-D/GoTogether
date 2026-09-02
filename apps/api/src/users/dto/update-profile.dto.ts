import { IsArray, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  homeCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  homeRegion?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  preferenceTagIds?: string[];
}
