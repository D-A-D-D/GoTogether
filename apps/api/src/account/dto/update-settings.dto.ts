import { IsBoolean, IsOptional } from 'class-validator';

/** Privacy settings. Only what is sent changes. */
export class UpdateSettingsDto {
  /** Share when I have read the chat, and see when others have (both or neither). */
  @IsOptional()
  @IsBoolean()
  readReceipts?: boolean;
}
