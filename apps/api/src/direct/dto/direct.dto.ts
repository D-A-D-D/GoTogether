import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Ask someone to talk privately, with the one message a request may carry. */
export class StartDirectDto {
  @IsString()
  @MaxLength(64)
  userId!: string;

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class SendDirectDto {
  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class RespondDirectDto {
  @IsIn(['ACCEPT', 'DECLINE'])
  decision!: 'ACCEPT' | 'DECLINE';
}

export class DirectMessagesQueryDto {
  /** A message id to page back from. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
