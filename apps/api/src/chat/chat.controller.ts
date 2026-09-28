import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { ChatService } from './chat.service.js';
import { ListMessagesDto } from './dto/list-messages.dto.js';

// Reading history is REST (simple, cacheable, works before a socket is even
// open); sending is WebSocket-only (ChatGateway) so there's a single send
// path rather than two copies of the same access-control + persistence logic.
@Controller('trips/:tripId/messages')
@UseGuards(JwtAccessGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param('tripId') tripId: string, @Query() dto: ListMessagesDto) {
    return this.chatService.listMessages(tripId, user.userId, dto.before, dto.limit ?? 50);
  }
}
