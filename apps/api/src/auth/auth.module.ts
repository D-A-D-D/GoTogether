import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { EmailModule } from '../email/email.module.js';
import { TokensService } from './tokens.service.js';
import { AccountStateService } from './account-state.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy.js';
import { GoogleStrategy } from './strategies/google.strategy.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [PassportModule.register({}), JwtModule.register({}), UsersModule, EmailModule],
  controllers: [AuthController, CredentialsController],
  providers: [
    AuthService,
    TokensService,
    AccountStateService,
    LoginAttemptsService,
    CredentialsService,
    JwtAccessStrategy,
    GoogleStrategy,
  ],
  // The chat gateway and the moderation service both need the account-state cache.
  exports: [AuthService, AccountStateService],
})
export class AuthModule {}
