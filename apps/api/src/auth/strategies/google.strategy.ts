import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';

export interface GoogleProfile {
  provider: 'google';
  providerAccountId: string;
  email: string;
  name: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    // passport-oauth2 throws at construction if clientID/clientSecret are
    // empty, so unconfigured deployments get a placeholder instead — the
    // route still exists, it just fails a real Google handshake until
    // real credentials are set (apps/api/.env.example).
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL', 'http://localhost:3001/auth/google/callback'),
      scope: ['email', 'profile'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google account has no email'), undefined);
      return;
    }
    const googleProfile: GoogleProfile = {
      provider: 'google',
      providerAccountId: profile.id,
      email,
      name: profile.displayName || email,
    };
    done(null, googleProfile);
  }
}
