import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LIMITS } from '../common/throttle-limits.js';
import { CurrentUser, type RequestUser } from './current-user.decorator.js';
import { CredentialsService } from './credentials.service.js';
import { ForgotPasswordDto, ResetPasswordDto, VerifyEmailDto } from './dto/credentials.dto.js';
import { JwtAccessGuard } from './guards/jwt-access.guard.js';

@Controller('auth')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  /** Always the same answer, whether or not the address has an account. */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LIMITS.emailRequest })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.credentials.requestPasswordReset(dto.email);
    return { ok: true };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LIMITS.emailLink })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.credentials.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LIMITS.emailLink })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.credentials.verifyEmail(dto.token);
    return { ok: true };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAccessGuard)
  @Throttle({ default: LIMITS.emailRequest })
  resendVerification(@CurrentUser() user: RequestUser) {
    return this.credentials.resendVerification(user.userId);
  }
}
