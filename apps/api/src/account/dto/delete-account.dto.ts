import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Proof it's really them, since this can't be undone. Accounts with a password
 * send it; an account that has none (signed up with Google) types its own email.
 * The service decides which one is required.
 */
export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(72) // bcrypt's effective input limit, same as registration
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  confirmEmail?: string;
}
