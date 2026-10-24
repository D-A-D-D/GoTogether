import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard } from './admin.guard.js';
import { ModerationService } from './moderation.service.js';

// PassportModule is registered here for the same reason as the other feature
// modules: the controller's JwtAccessGuard needs it in its own module scope.
// AuthModule supplies the account-state cache a moderator's action invalidates.
@Module({
  imports: [PassportModule.register({}), AuthModule],
  providers: [ModerationService, AdminGuard],
  controllers: [AdminController],
})
export class AdminModule {}
