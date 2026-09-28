import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExpenseSplitInputDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  amount!: number;
}

export class CreateExpenseDto {
  @IsString()
  @MaxLength(200)
  description!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  // Defaults to the caller — set this when logging an expense someone else
  // actually paid.
  @IsOptional()
  @IsString()
  paidById?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  // Equal-split shorthand: who to divide `amount` across. Defaults to every
  // approved member of the trip when omitted. Ignored if `splits` is given.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  splitUserIds?: string[];

  // Custom split: exact amounts per person, which must sum to `amount`.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ExpenseSplitInputDto)
  splits?: ExpenseSplitInputDto[];
}
