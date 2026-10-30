import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A chat message. Whether it is acceptable for its kind (text needs words, a picture needs its file) is
 * decided by messageProblem() in message-rules.ts, so the sentence a person reads comes from one place.
 */
export class SendMessageDto {
  @IsString()
  tripId!: string;

  /** Defaults to TEXT, so a client that only knows about text keeps working. */
  @IsOptional()
  @IsIn(['TEXT', 'IMAGE', 'VOICE'])
  kind?: 'TEXT' | 'IMAGE' | 'VOICE';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  /** The id of a picture or voice note already uploaded to this trip (POST /trips/:id/media). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mediaId?: string;
}
