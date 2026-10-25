// What deleting an account does, as pure data and functions so the rules can be
// tested without a database (account-rules.spec.ts). The approach, from
// BLUEPRINT section 09: records tied to other people's trips - messages,
// expenses, reviews - can't vanish when one member leaves, so the account row is
// kept and made anonymous instead of removed.
import { AccountStatus, TripStatus, UserRole } from '../generated/prisma/index.js';

/** What everyone else sees in place of the person's name. */
export const DELETED_NAME = 'Deleted user';

/** A trip that hasn't finished: its host can't delete their account until they cancel or complete it. */
export const UNFINISHED_TRIP_STATUSES = [TripStatus.DRAFT, TripStatus.OPEN, TripStatus.FULL, TripStatus.ONGOING];

/**
 * Trips where a deleted member's place is given up: still taking people or under
 * way. On a finished trip (completed or cancelled) the membership stays as the
 * record that they were there - reviews and expenses depend on it.
 */
export const RELEASABLE_TRIP_STATUSES = [TripStatus.OPEN, TripStatus.FULL, TripStatus.ONGOING];

/**
 * A unique placeholder in a reserved top-level domain (`.invalid`, RFC 2606) so
 * it can never be a real address, and the original is free to be registered again.
 */
export function anonymisedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

/**
 * The scrubbed values for the user row. Everything that identifies or lets
 * someone sign in is cleared; `role` goes back to a plain user so a deleted
 * admin account carries no privilege; the status makes every existing check
 * (sessions, chat, discovery, push, approvals) treat it as gone.
 */
export function anonymisedProfile(userId: string, now: Date) {
  return {
    email: anonymisedEmail(userId),
    name: DELETED_NAME,
    bio: null,
    homeCity: null,
    homeRegion: null,
    homeLat: null,
    homeLng: null,
    passwordHash: null,
    role: UserRole.USER,
    accountStatus: AccountStatus.DELETED,
    deletedAt: now,
  };
}

/** "You still host 1 trip that hasn't finished..." with the right singular/plural. */
export function unfinishedTripsMessage(count: number): string {
  const trips = count === 1 ? '1 trip that has' : `${count} trips that have`;
  const them = count === 1 ? 'it' : 'them';
  return `You still host ${trips} not finished. Cancel or complete ${them} first, then delete your account.`;
}
