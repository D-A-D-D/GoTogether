import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { TokensService } from './tokens.service.js';
import { AccountStateService } from './account-state.service.js';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy.js';
import { GoogleStrategy } from './strategies/google.strategy.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [PassportModule.register({}), JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, TokensService, AccountStateService, JwtAccessStrategy, GoogleStrategy],
  // The chat gateway and the moderation service both need the account-state cache.
  exports: [AuthService, AccountStateService],
})
export class AuthModule {}
