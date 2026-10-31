import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { DirectService } from './direct.service.js';
import { DirectMessagesQueryDto, RespondDirectDto, SendDirectDto, StartDirectDto } from './dto/direct.dto.js';

@Controller('direct')
@UseGuards(JwtAccessGuard)
export class DirectController {
  constructor(private readonly direct: DirectService) {}

  @Get('threads')
  list(@CurrentUser() user: RequestUser) {
    return this.direct.listThreads(user.userId);
  }

  @Get('attention')
  attention(@CurrentUser() user: RequestUser) {
    return this.direct.attentionCount(user.userId);
  }

  @Post('requests')
  start(@CurrentUser() user: RequestUser, @Body() dto: StartDirectDto) {
    return this.direct.start(user.userId, dto.userId, dto.content);
  }

  @Get('threads/:id/messages')
  messages(@CurrentUser() user: RequestUser, @Param('id') id: string, @Query() query: DirectMessagesQueryDto) {
    return this.direct.messages(user.userId, id, query.before, query.limit);
  }

  @Post('threads/:id/messages')
  send(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SendDirectDto) {
    return this.direct.send(user.userId, id, dto.content);
  }

  @Post('threads/:id/respond')
  respond(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RespondDirectDto) {
    return this.direct.respond(user.userId, id, dto.decision);
  }
}
