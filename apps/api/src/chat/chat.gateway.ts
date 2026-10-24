import { UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Server, Socket } from 'socket.io';
import { AccountStateService } from '../auth/account-state.service.js';
import { AccountStatus } from '../generated/prisma/index.js';
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
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly chatService: ChatService,
    private readonly blocks: BlocksService,
    private readonly accounts: AccountStateService,
  ) {}

  /** A restricted or deleted account has no business in a live connection. */
  private async isInGoodStanding(userId: string): Promise<boolean> {
    const state = await this.accounts.get(userId);
    return state !== null && state.accountStatus === AccountStatus.ACTIVE;
  }

  /**
   * Auth happens once, as namespace middleware — so the client's `connect` only
   * fires after it succeeds. Doing it in handleConnection instead lets an
   * immediate `joinRoom` outrun the (database-backed) account check and arrive
   * with no userId. A bad token, or a restricted account, is a connect_error.
   */
  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        () => next(new Error('Unauthorized')),
      );
    });
  }

  private async authenticate(socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) throw new Error('Missing token');
    const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
    if (!(await this.isInGoodStanding(payload.sub))) throw new Error('Account not available');
    (socket as AuthedSocket).data.userId = payload.sub;
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
      // A socket opened before a suspension must stop working at the next send.
      if (!(await this.isInGoodStanding(socket.data.userId))) {
        socket.disconnect(true);
        return { ok: false, error: 'This account is not available' };
      }
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
      if (recipientId === undefined) continue;
      // Someone suspended since they connected: cut the connection rather than keep feeding it.
      if (!(await this.isInGoodStanding(recipientId))) {
        recipient.disconnect(true);
        continue;
      }
      if (recipientId === message.senderId || !hidden.has(recipientId)) {
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
