import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  revieweeId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  reliability!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  friendliness!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  communication!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  cleanliness!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
