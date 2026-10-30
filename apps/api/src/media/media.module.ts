import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthModule } from '../auth/auth.module.js';
import { SafetyModule } from '../safety/safety.module.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

// PassportModule for the controller's JwtAccessGuard, as in the other feature modules; SafetyModule for
// the block checks that decide who may see a picture.
@Module({
  imports: [PassportModule.register({}), AuthModule, SafetyModule],
  providers: [MediaService],
  controllers: [MediaController],
  exports: [MediaService],
})
export class MediaModule {}
