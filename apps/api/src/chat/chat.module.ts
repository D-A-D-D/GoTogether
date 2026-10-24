import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { ChatGateway } from './chat.gateway.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SafetyModule } from '../safety/safety.module.js';

@Module({
  imports: [PassportModule.register({}), JwtModule.register({}), NotificationsModule, SafetyModule],
  providers: [ChatService, ChatGateway],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
