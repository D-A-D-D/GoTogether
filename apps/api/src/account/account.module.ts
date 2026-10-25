import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

// PassportModule for the controller's JwtAccessGuard, as in the other feature
// modules; AuthModule supplies the account-state cache that deleting an
// account invalidates.
@Module({
  imports: [PassportModule.register({}), AuthModule],
  providers: [AccountService],
  controllers: [AccountController],
})
export class AccountModule {}
