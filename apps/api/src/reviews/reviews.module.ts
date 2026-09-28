import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ReviewsService } from './reviews.service.js';
import { ReviewsController } from './reviews.controller.js';
import { TrustController } from './trust.controller.js';

@Module({
  imports: [PassportModule.register({})],
  providers: [ReviewsService],
  controllers: [ReviewsController, TrustController],
  exports: [ReviewsService],
})
export class ReviewsModule {}
