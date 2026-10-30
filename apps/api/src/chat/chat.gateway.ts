import { HttpException, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
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
import { RateWindow } from '../common/rate-window.js';
import { AccountStatus } from '../generated/prisma/index.js';
import { BlocksService } from '../safety/blocks.service.js';
import { ChatService } from './chat.service.js';
import { JoinRoomDto } from './dto/join-room.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';

interface AuthedSocket extends Socket {
  data: { userId: string };
}

/** A person typing fast sends about one message a second; this leaves room for that and stops a flood. */
export const CHAT_MESSAGES_PER_WINDOW = 15;
export const CHAT_WINDOW_MS = 10_000;
export const CHAT_TOO_FAST = 'You are sending messages too quickly - wait a moment and try again';

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
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private server!: Server;

  /** Messages sent per user, over all their trips. In memory, so per API instance. */
  private readonly sendLimiter = new RateWindow(CHAT_MESSAGES_PER_WINDOW, CHAT_WINDOW_MS);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly chatService: ChatService,
    private readonly blocks: BlocksService,
    private readonly accounts: AccountStateService,
  ) {}

  /**
   * What a client is told about a failure. A deliberate refusal ("only approved members can
   * use this chat") is an HttpException and its message is meant to be read. Anything else is
   * a bug or an outage, and its text - a database host, a file path, a query - must never
   * reach a client: it is logged, and the client gets something generic.
   */
  private clientError(error: unknown, fallback: string): string {
    if (error instanceof HttpException) return error.message;
    this.logger.error(
      `Chat request failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
    return fallback;
  }

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
      return { ok: false, error: this.clientError(error, 'Could not join the chat right now - please try again') };
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
      if (this.sendLimiter.isFull(socket.data.userId)) {
        return { ok: false, error: CHAT_TOO_FAST };
      }
      this.sendLimiter.record(socket.data.userId);
      // Saving the message and finding out who is blocked with the sender do not depend on each other.
      const [message, hidden] = await Promise.all([
        this.chatService.createMessage(dto.tripId, socket.data.userId, dto.content),
        this.blocks.blockedWith(socket.data.userId),
      ]);
      await this.broadcast(dto.tripId, message, hidden);
      // After delivery, and not waited for: a slow push service must never delay a chat, and a failing
      // one must never turn a delivered message into an error.
      this.notifyInBackground(dto.tripId, message, hidden);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, error: this.clientError(error, 'Could not send that message - please try again') };
    }
  }

  /**
   * Sends a message to everyone in the room — except anyone blocked with the
   * sender (BLUEPRINT §08: a block hides people from each other in chat too).
   * That has to be per recipient, so it can't be a single room-wide emit. The
   * sender always gets their own message back; the client adds it from this
   * broadcast rather than from the send acknowledgement.
   */
  private async broadcast(tripId: string, message: { senderId: string }, hidden: ReadonlySet<string>): Promise<void> {
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

  private notifyInBackground(tripId: string, message: Parameters<ChatService['notifyOthers']>[1], hidden: ReadonlySet<string>): void {
    void Promise.resolve()
      .then(() => this.chatService.notifyOthers(tripId, message, hidden))
      .catch((error: unknown) => {
        this.logger.warn(`Push notification for a chat message failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private extractToken(socket: Socket): string | undefined {
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
