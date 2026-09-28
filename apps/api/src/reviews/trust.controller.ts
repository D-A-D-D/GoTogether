import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { ReviewsService } from './reviews.service.js';

// Self-only audit trail behind the trust score (BLUEPRINT §01: "anything
// that changes a user's standing needs a human-reviewable trail").
@Controller('users/me/trust-events')
@UseGuards(JwtAccessGuard)
export class TrustController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.reviewsService.listMyTrustEvents(user.userId);
  }
}
