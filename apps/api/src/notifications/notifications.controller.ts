import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { NotificationsService } from './notifications.service.js';
import { SubscribeDto } from './dto/subscribe.dto.js';
import { UnsubscribeDto } from './dto/unsubscribe.dto.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Not secret — this is what a browser needs to call pushManager.subscribe().
  @Get('vapid-public-key')
  getPublicKey() {
    return { publicKey: this.notificationsService.getPublicKey() };
  }

  @Post('subscribe')
  @UseGuards(JwtAccessGuard)
  subscribe(@CurrentUser() user: RequestUser, @Body() dto: SubscribeDto) {
    return this.notificationsService.subscribe(user.userId, dto.endpoint, dto.keys.p256dh, dto.keys.auth);
  }

  @Delete('subscribe')
  @UseGuards(JwtAccessGuard)
  unsubscribe(@CurrentUser() user: RequestUser, @Body() dto: UnsubscribeDto) {
    return this.notificationsService.unsubscribe(user.userId, dto.endpoint);
  }
}
