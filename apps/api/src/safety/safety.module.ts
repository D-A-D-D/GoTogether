import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { BlocksService } from './blocks.service.js';
import { ReportsService } from './reports.service.js';
import { SafetyController } from './safety.controller.js';

// PassportModule registered here for the same reason as the other feature
// modules: the controller's JwtAccessGuard needs it in its own module scope.
@Module({
  imports: [PassportModule.register({})],
  providers: [BlocksService, ReportsService],
  controllers: [SafetyController],
  // Trips and chat both have to honour blocks.
  exports: [BlocksService],
})
export class SafetyModule {}
