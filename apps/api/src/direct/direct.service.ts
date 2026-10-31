import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlocksService } from '../safety/blocks.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AccountStatus, DirectStatus, MembershipStatus } from '../generated/prisma/index.js';
import { RateWindow } from '../common/rate-window.js';
import { HOUR_MS, MINUTE_MS, TOO_MANY_REQUESTS } from '../common/throttle-limits.js';
import { canAskAgain, needsAttention, pairOf, sendProblem, textProblem, viewOf, type DirectView } from './direct-rules.js';

export const DIRECT_LIMITS = {
  /** New requests one person may send in a day: asking is the thing that can be used to pester people. */
  requests: { limit: 10, windowMs: 24 * HOUR_MS },
  /** Messages one person may send in a minute, across all their private chats. */
  messages: { limit: 30, windowMs: MINUTE_MS },
} as const;

const PERSON = { id: true, name: true, avatarUpdatedAt: true, accountStatus: true } as const;
const NOT_FOUND = 'Not found';
const preview = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);

export interface DirectSummary {
  id: string;
  view: DirectView;
  other: { id: string; name: string; avatarUpdatedAt: Date | null };
  last: { content: string; senderId: string; createdAt: Date } | null;
  unread: boolean;
  lastMessageAt: Date;
}

/**
 * Private one-to-one chat. The rules themselves are in direct-rules.ts; this is the part that reads and writes
 * them. Who may talk: two people who are approved on a trip together right now, neither blocking the other.
 * Everything about a thread someone is not part of - or is not allowed to see - is "not found".
 */
@Injectable()
export class DirectService {
  private readonly requestWindow = new RateWindow(DIRECT_LIMITS.requests.limit, DIRECT_LIMITS.requests.windowMs);
  private readonly messageWindow = new RateWindow(DIRECT_LIMITS.messages.limit, DIRECT_LIMITS.messages.windowMs);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly notifications: NotificationsService,
  ) {}

  private tooFast(): never {
    throw new HttpException(TOO_MANY_REQUESTS, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** A thread I am part of, or "not found". */
  private async mine(threadId: string, meId: string) {
    const thread = await this.prisma.directThread.findUnique({
      where: { id: threadId },
      include: { userLow: { select: PERSON }, userHigh: { select: PERSON } },
    });
    if (!thread || (thread.userLowId !== meId && thread.userHighId !== meId)) throw new NotFoundException(NOT_FOUND);
    const other = thread.userLowId === meId ? thread.userHigh : thread.userLow;
    if (other.accountStatus !== AccountStatus.ACTIVE || viewOf(thread, meId) === 'HIDDEN') throw new NotFoundException(NOT_FOUND);
    if (await this.blocks.areBlocked(meId, other.id)) throw new NotFoundException(NOT_FOUND);
    return { thread, other };
  }

  private async onSameTrip(a: string, b: string): Promise<boolean> {
    const shared = await this.prisma.tripMembership.findFirst({
      where: { userId: a, status: MembershipStatus.APPROVED, trip: { memberships: { some: { userId: b, status: MembershipStatus.APPROVED } } } },
      select: { id: true },
    });
    return shared !== null;
  }

  // ---------------------------------------------------------------- the list

  async listThreads(meId: string): Promise<DirectSummary[]> {
    const [threads, hidden] = await Promise.all([
      this.prisma.directThread.findMany({
        where: { OR: [{ userLowId: meId }, { userHighId: meId }] },
        include: {
          userLow: { select: PERSON },
          userHigh: { select: PERSON },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, senderId: true, createdAt: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
      }),
      this.blocks.blockedWith(meId),
    ]);
    const out: DirectSummary[] = [];
    for (const thread of threads) {
      const other = thread.userLowId === meId ? thread.userHigh : thread.userLow;
      const view = viewOf(thread, meId);
      if (view === 'HIDDEN' || other.accountStatus !== AccountStatus.ACTIVE || hidden.has(other.id)) continue;
      const last = thread.messages[0] ?? null;
      out.push({
        id: thread.id,
        view,
        other: { id: other.id, name: other.name, avatarUpdatedAt: other.avatarUpdatedAt },
        last,
        unread: needsAttention(thread, meId, last),
        lastMessageAt: thread.lastMessageAt,
      });
    }
    return out;
  }

  /** How many private chats need the person: unread replies, and requests waiting for an answer. */
  async attentionCount(meId: string): Promise<{ count: number }> {
    return { count: (await this.listThreads(meId)).filter((t) => t.unread).length };
  }

  // ---------------------------------------------------------------- asking, and sending

  /** Asks someone to talk privately with one message - or, if you already can, just sends it. */
  async start(meId: string, targetId: string, content: string): Promise<{ threadId: string }> {
    const problem = textProblem(content);
    if (problem) throw new BadRequestException(problem);
    if (targetId === meId) throw new BadRequestException("You can't message yourself");

    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: PERSON });
    if (!target || target.accountStatus !== AccountStatus.ACTIVE || (await this.blocks.areBlocked(meId, targetId))) {
      throw new NotFoundException('Person not found');
    }
    const { low, high } = pairOf(meId, targetId);
    const existing = await this.prisma.directThread.findUnique({ where: { userLowId_userHighId: { userLowId: low, userHighId: high } } });

    if (existing?.status === DirectStatus.ACCEPTED) {
      await this.send(meId, existing.id, content);
      return { threadId: existing.id };
    }
    if (existing && !canAskAgain(existing, meId, new Date())) {
      throw new ConflictException(
        existing.status === DirectStatus.PENDING && existing.requesterId !== meId
          ? 'They have already asked to message you - open the request to accept it'
          : "You've already sent a request - you can send more once they accept",
      );
    }
    if (!(await this.onSameTrip(meId, targetId))) throw new ForbiddenException('You can message people you are on a trip with');
    if (this.requestWindow.isFull(meId)) this.tooFast();
    this.requestWindow.record(meId);

    const now = new Date();
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: meId }, select: { name: true } });
    const iAmLow = meId === low;
    const fresh = { requesterId: meId, status: DirectStatus.PENDING, requestedAt: now, respondedAt: null, lastMessageAt: now, lowReadAt: iAmLow ? now : null, highReadAt: iAmLow ? null : now };
    const thread = await this.prisma.directThread.upsert({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
      create: { userLowId: low, userHighId: high, ...fresh },
      update: fresh,
      select: { id: true },
    });
    await this.prisma.directMessage.create({ data: { threadId: thread.id, senderId: meId, content: content.trim() } });
    // A request never shows its message in the notification: it is for the person to decide whether to open it.
    await this.notifications
      .notifyUser(targetId, { title: 'New message request', body: `${me.name} would like to message you`, url: '/messages' })
      .catch(() => undefined);
    return { threadId: thread.id };
  }

  async send(meId: string, threadId: string, content: string) {
    const problem = textProblem(content);
    if (problem) throw new BadRequestException(problem);
    const { thread, other } = await this.mine(threadId, meId);

    const sentSinceRequest = await this.prisma.directMessage.count({
      where: { threadId, senderId: meId, createdAt: { gte: thread.requestedAt } },
    });
    const refusal = sendProblem(thread, meId, sentSinceRequest);
    if (refusal) throw new ForbiddenException(refusal);
    if (this.messageWindow.isFull(meId)) this.tooFast();
    this.messageWindow.record(meId);

    const now = new Date();
    const mySide = thread.userLowId === meId ? { lowReadAt: now } : { highReadAt: now };
    const [message] = await this.prisma.$transaction([
      this.prisma.directMessage.create({
        data: { threadId, senderId: meId, content: content.trim() },
        select: { id: true, senderId: true, content: true, createdAt: true },
      }),
      this.prisma.directThread.update({ where: { id: threadId }, data: { lastMessageAt: now, ...mySide } }),
    ]);
    if (thread.status === DirectStatus.ACCEPTED) {
      const me = await this.prisma.user.findUnique({ where: { id: meId }, select: { name: true } });
      await this.notifications
        .notifyUser(other.id, { title: me?.name ?? 'New message', body: preview(content.trim()), url: `/messages/${threadId}` })
        .catch(() => undefined);
    }
    return message;
  }

  /** Accepts or declines a request someone sent you. Declining is silent: they keep seeing "waiting". */
  async respond(meId: string, threadId: string, decision: 'ACCEPT' | 'DECLINE') {
    const { thread, other } = await this.mine(threadId, meId);
    if (thread.status !== DirectStatus.PENDING || thread.requesterId === meId) {
      throw new ConflictException('There is no request here waiting for your answer');
    }
    const accept = decision === 'ACCEPT';
    await this.prisma.directThread.update({
      where: { id: threadId },
      data: { status: accept ? DirectStatus.ACCEPTED : DirectStatus.DECLINED, respondedAt: new Date() },
    });
    if (accept) {
      const me = await this.prisma.user.findUnique({ where: { id: meId }, select: { name: true } });
      await this.notifications
        .notifyUser(other.id, { title: 'Request accepted', body: `${me?.name ?? 'They'} accepted - you can chat now`, url: `/messages/${threadId}` })
        .catch(() => undefined);
    }
    return { view: accept ? 'ACCEPTED' : 'HIDDEN' };
  }

  // ---------------------------------------------------------------- reading

  /** A page of messages (oldest first), with where the chat stands. Opening it marks it read. */
  async messages(meId: string, threadId: string, before?: string, limit = 50) {
    const { thread, other } = await this.mine(threadId, meId);
    let cursor: Date | undefined;
    if (before) {
      const marker = await this.prisma.directMessage.findFirst({ where: { id: before, threadId }, select: { createdAt: true } });
      if (!marker) throw new BadRequestException('Unknown message');
      cursor = marker.createdAt;
    }
    const rows = await this.prisma.directMessage.findMany({
      where: { threadId, ...(cursor ? { createdAt: { lt: cursor } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, senderId: true, content: true, createdAt: true },
    });
    const now = new Date();
    await this.prisma.directThread.update({
      where: { id: threadId },
      data: thread.userLowId === meId ? { lowReadAt: now } : { highReadAt: now },
    });
    const sentSinceRequest = await this.prisma.directMessage.count({ where: { threadId, senderId: meId, createdAt: { gte: thread.requestedAt } } });
    return {
      thread: {
        id: threadId,
        view: viewOf(thread, meId),
        other: { id: other.id, name: other.name, avatarUpdatedAt: other.avatarUpdatedAt },
        canSend: sendProblem(thread, meId, sentSinceRequest) === null,
      },
      messages: rows.reverse(),
    };
  }
}
