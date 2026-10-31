import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { DirectController } from './direct.controller.js';
import { DirectService } from './direct.service.js';

// PassportModule for the controller's JwtAccessGuard, as in the other feature modules; SafetyModule for
// the block checks, NotificationsModule for the pushes.
@Module({
  imports: [PassportModule.register({}), AuthModule, SafetyModule, NotificationsModule],
  providers: [DirectService],
  controllers: [DirectController],
})
export class DirectModule {}
