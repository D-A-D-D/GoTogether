import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TripsService } from './trips.service.js';
import { TripsController } from './trips.controller.js';
import { MatchingService } from './matching.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SafetyModule } from '../safety/safety.module.js';

// PassportModule registered here for the same reason as UsersModule: the
// controller's JwtAccessGuard needs AuthModuleOptions in its own module scope.
@Module({
  imports: [PassportModule.register({}), NotificationsModule, SafetyModule],
  providers: [TripsService, MatchingService],
  controllers: [TripsController],
  exports: [TripsService],
})
export class TripsModule {}
