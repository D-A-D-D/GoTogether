import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  /** The token from the emailed link. */
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  // Same rules as registration (bcrypt only reads the first 72 bytes).
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}
