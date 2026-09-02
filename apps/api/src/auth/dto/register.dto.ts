import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt's effective input limit
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}
