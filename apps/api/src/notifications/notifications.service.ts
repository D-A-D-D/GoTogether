import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { AccountStatus } from '../generated/prisma/index.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
}

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    webpush.setVapidDetails(
      this.config.getOrThrow<string>('VAPID_SUBJECT'),
      this.config.getOrThrow<string>('VAPID_PUBLIC_KEY'),
      this.config.getOrThrow<string>('VAPID_PRIVATE_KEY'),
    );
  }

  getPublicKey(): string {
    return this.config.getOrThrow<string>('VAPID_PUBLIC_KEY');
  }

  subscribe(userId: string, endpoint: string, p256dh: string, auth: string) {
    // Upserted by endpoint, not (userId, endpoint) — a browser's endpoint is
    // globally unique, and re-subscribing (e.g. after clearing site data)
    // should just take over the row rather than fight a stale one.
    return this.prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId, p256dh, auth },
      create: { userId, endpoint, p256dh, auth },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /**
   * Best-effort side effect — a failed or entirely absent subscription
   * never breaks the action that triggered it (approving a request,
   * sending a chat message, processing a review, etc. all still succeed).
   */
  async notifyUser(userId: string, payload: NotificationPayload): Promise<void> {
    // A suspended or closed account gets nothing — otherwise a chat preview would
    // keep reaching the lock screen of someone who has been locked out of the app.
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId, user: { accountStatus: AccountStatus.ACTIVE } },
    });
    await Promise.all(subs.map((sub) => this.send(sub, payload)));
  }

  async notifyUsers(userIds: string[], payload: NotificationPayload): Promise<void> {
    await Promise.all(userIds.map((id) => this.notifyUser(id, payload)));
  }

  private async send(sub: StoredSubscription, payload: NotificationPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Gone/not found — the browser or push service dropped this
        // subscription on their end; stop trying and clean it up.
        await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      } else {
        this.logger.warn(`Push send failed for subscription ${sub.id}: ${(error as Error).message}`);
      }
    }
  }
}
