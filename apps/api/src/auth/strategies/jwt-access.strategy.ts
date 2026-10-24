import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccountStatus } from '../../generated/prisma/index.js';
import { AccountStateService } from '../account-state.service.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(
    config: ConfigService,
    private readonly accounts: AccountStateService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * A valid token isn't enough: the account has to still be in good standing.
   * Answering 401 (not 403) is deliberate — the web client reacts to a 401 by
   * trying to refresh, the refresh is refused for a restricted account, and the
   * person lands on the login page, where signing in explains why. A deleted
   * account gets the same answer.
   */
  async validate(payload: AccessTokenPayload) {
    const state = await this.accounts.get(payload.sub);
    if (!state || state.accountStatus !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('This account is not available');
    }
    return { userId: payload.sub, email: payload.email, role: state.role };
  }
}
