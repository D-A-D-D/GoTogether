import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { ChatGateway } from './chat.gateway.js';

@Module({
  imports: [PassportModule.register({}), JwtModule.register({})],
  providers: [ChatService, ChatGateway],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
