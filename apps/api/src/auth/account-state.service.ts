import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccountStatus, UserRole } from '../generated/prisma/index.js';

export interface AccountState {
  accountStatus: AccountStatus;
  role: UserRole;
  /** Whether this person shares, and can see, who has read the chat. Changing it invalidates this entry. */
  readReceipts: boolean;
}

/** How long a user's status and role are trusted before being re-read. */
export const ACCOUNT_STATE_TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;

/**
 * A user's account status and role, for checking on every authenticated
 * request. Access tokens are stateless JWTs, so a suspension would otherwise
 * not bite until the token expired; checking the database on every request
 * would add a query to all of them. This is the middle path: one query per
 * user per 30 seconds, and a moderator's action invalidates the entry
 * straight away (see ModerationService), so in practice a suspension takes
 * effect immediately on the instance that handled it.
 *
 * It's an in-process cache, so with more than one API instance the others
 * would take up to the TTL to notice — fine for "pending review" semantics,
 * and the thing to revisit (shared cache, or pub/sub invalidation) alongside
 * the Redis adapter for chat.
 */
@Injectable()
export class AccountStateService {
  private readonly cache = new Map<string, { state: AccountState | null; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** `null` when the user no longer exists. `now` is injectable for tests. */
  async get(userId: string, now: number = Date.now()): Promise<AccountState | null> {
    const hit = this.cache.get(userId);
    if (hit && hit.expires > now) return hit.state;

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, role: true, readReceipts: true },
    });
    this.remember(userId, row ?? null, now);
    return row ?? null;
  }

  /** Forget a user, so their next request re-reads the database. */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  private remember(userId: string, state: AccountState | null, now: number): void {
    if (this.cache.size >= MAX_ENTRIES) {
      for (const [id, entry] of this.cache) if (entry.expires <= now) this.cache.delete(id);
      if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    }
    this.cache.set(userId, { state, expires: now + ACCOUNT_STATE_TTL_MS });
  }
}
