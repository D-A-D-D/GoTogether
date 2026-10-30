import { IsString, MaxLength } from 'class-validator';

export class MarkReadDto {
  @IsString()
  tripId!: string;

  /** The newest message the person has now seen. */
  @IsString()
  @MaxLength(64)
  messageId!: string;
}
