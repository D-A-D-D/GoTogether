import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { ReviewsService } from './reviews.service.js';
import { CreateReviewDto } from './dto/create-review.dto.js';

@Controller('trips/:tripId/reviews')
@UseGuards(JwtAccessGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Param('tripId') tripId: string, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(tripId, user.userId, dto);
  }

  @Get('pending')
  listPending(@CurrentUser() user: RequestUser, @Param('tripId') tripId: string) {
    return this.reviewsService.listPending(tripId, user.userId);
  }

  @Get('received')
  listReceived(@CurrentUser() user: RequestUser, @Param('tripId') tripId: string) {
    return this.reviewsService.listReceived(tripId, user.userId);
  }
}
