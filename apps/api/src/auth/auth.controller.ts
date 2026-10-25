import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LIMITS } from '../common/throttle-limits.js';
import { AuthService } from './auth.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UsersService } from '../users/users.service.js';
import { GoogleGuard } from './guards/google.guard.js';
import type { GoogleProfile } from './strategies/google.strategy.js';
import type { TokenPair } from './tokens.service.js';

const REFRESH_COOKIE = 'gt_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
    private readonly loginAttempts: LoginAttemptsService,
  ) {}

  private setRefreshCookie(res: Response, tokens: TokenPair) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/auth',
      expires: tokens.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }

  @Post('register')
  @Throttle({ default: LIMITS.register })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.authService.register(dto.email, dto.password, dto.name);
    this.setRefreshCookie(res, tokens);
    return { user: this.usersService.toPublicProfile(user), accessToken: tokens.accessToken };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LIMITS.login })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    this.loginAttempts.assertAllowed(dto.email);
    let user;
    try {
      user = await this.authService.validateUser(dto.email, dto.password);
    } catch (error) {
      // Only a wrong email or password counts - a database error shouldn't burn someone's attempts.
      if (error instanceof UnauthorizedException) this.loginAttempts.recordFailure(dto.email);
      throw error;
    }
    this.loginAttempts.recordSuccess(dto.email);
    const { tokens } = await this.authService.login(user);
    this.setRefreshCookie(res, tokens);
    return { user: this.usersService.toPublicProfile(user), accessToken: tokens.accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LIMITS.refresh })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken) {
      throw new UnauthorizedException('No refresh token');
    }
    const { user, tokens } = await this.authService.refresh(rawToken);
    this.setRefreshCookie(res, tokens);
    return { user: this.usersService.toPublicProfile(user), accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (rawToken) {
      await this.authService.logout(rawToken);
    }
    this.clearRefreshCookie(res);
  }

  // Google OAuth is optional — routes work but redirect to Google with an
  // invalid client until GOOGLE_CLIENT_ID/SECRET are set (apps/api/.env.example).
  @Get('google')
  @UseGuards(GoogleGuard)
  googleLogin() {
    // GoogleGuard performs the redirect to Google; nothing to do here.
  }

  @Get('google/callback')
  @UseGuards(GoogleGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const profile = req.user as GoogleProfile;
    const user = await this.authService.findOrCreateOAuthUser(profile);
    const { tokens } = await this.authService.login(user);
    this.setRefreshCookie(res, tokens);

    const webOrigin = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
    // Access token travels in the URL fragment, not a query string, so it
    // never reaches server logs — the frontend reads it client-side and
    // discards it from the URL immediately.
    res.redirect(`${webOrigin}/auth/callback#accessToken=${encodeURIComponent(tokens.accessToken)}`);
  }
}
