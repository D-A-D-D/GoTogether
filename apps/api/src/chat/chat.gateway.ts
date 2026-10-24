import { UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { BlocksService } from '../safety/blocks.service.js';
import { ChatService } from './chat.service.js';
import { JoinRoomDto } from './dto/join-room.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';

interface AuthedSocket extends Socket {
  data: { userId: string };
}

function roomName(tripId: string): string {
  return `trip:${tripId}`;
}

/**
 * Single-instance for now — no Redis adapter wired in (see docs/ROADMAP.md
 * Phase 4 / BLUEPRINT §10 "Growth" row). Fine as long as there's exactly
 * one API process; add @socket.io/redis-adapter once there's more than one.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly chatService: ChatService,
    private readonly blocks: BlocksService,
  ) {}

  /** Auth happens once at connection time — a bad/missing token just drops the socket. */
  async handleConnection(socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      (socket as AuthedSocket).data.userId = payload.sub;
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('joinRoom')
  async onJoinRoom(@ConnectedSocket() socket: AuthedSocket, @MessageBody() dto: JoinRoomDto) {
    try {
      await this.chatService.assertCanAccess(dto.tripId, socket.data.userId);
      await socket.join(roomName(dto.tripId));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to join' };
    }
  }

  @SubscribeMessage('sendMessage')
  async onSendMessage(@ConnectedSocket() socket: AuthedSocket, @MessageBody() dto: SendMessageDto) {
    try {
      const message = await this.chatService.createMessage(dto.tripId, socket.data.userId, dto.content);
      await this.broadcast(dto.tripId, message);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to send message' };
    }
  }

  /**
   * Sends a message to everyone in the room — except anyone blocked with the
   * sender (BLUEPRINT §08: a block hides people from each other in chat too).
   * That has to be per recipient, so it can't be a single room-wide emit. The
   * sender always gets their own message back; the client adds it from this
   * broadcast rather than from the send acknowledgement.
   */
  private async broadcast(tripId: string, message: { senderId: string }): Promise<void> {
    const hidden = await this.blocks.blockedWith(message.senderId);
    const sockets = await this.server.in(roomName(tripId)).fetchSockets();
    for (const recipient of sockets) {
      const recipientId = recipient.data.userId as string | undefined;
      if (recipientId === message.senderId || (recipientId !== undefined && !hidden.has(recipientId))) {
        recipient.emit('message', message);
      }
    }
  }

  private extractToken(socket: Socket): string | undefined {
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
