// What to do about this device's push subscription when someone logs in.
// Pure and dependency-free on purpose: the decision is the part worth
// testing, and it's imported by scripts/push-sync-policy.test.mjs, which
// runs it under plain Node (type annotations are erased, so no imports here).
//
// Background: a push subscription belongs to a *device*, but notifications
// are about an *account*. So the browser remembers which account turned push
// on for this device (the "owner"), and:
//   - a different account logging in must never inherit the owner's
//     subscription — drop it (this is what stops user A's chat previews
//     appearing for user B on a shared phone);
//   - the owner logging back in gets it restored quietly (logout removes the
//     subscription for privacy, but the person did opt in on this device) and
//     occasionally re-saved, so a subscription the server dropped heals.

export interface PushOwner {
  userId: string;
  /** When the subscription was last (re)saved to the server, ms since epoch. */
  syncedAt: number;
}

export type PushSyncAction =
  /** Unsubscribe the browser: this subscription isn't this user's. */
  | 'drop-subscription'
  /** Subscribe again and save it: they opted in here, logout removed it. */
  | 'restore-subscription'
  /** The subscription is theirs but the server's copy may be stale — save it again. */
  | 'resave-subscription'
  | 'nothing';

export interface PushSyncDecision {
  action: PushSyncAction;
  /** The recorded owner is somebody else, so the record should be forgotten. */
  clearOwner: boolean;
}

/** How long a saved subscription is trusted before it's re-saved to the server. */
export const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000;

export function decidePushSync(input: {
  owner: PushOwner | null;
  userId: string;
  hasSubscription: boolean;
  /** `Notification.permission`: 'granted' | 'denied' | 'default'. */
  permission: string;
  now: number;
}): PushSyncDecision {
  const { owner, userId, hasSubscription, permission, now } = input;
  const ownedByOther = owner !== null && owner.userId !== userId;
  const ownedByThisUser = owner !== null && owner.userId === userId;

  // Never let a subscription from another account — or one with no recorded
  // owner at all — deliver to this user.
  if (hasSubscription && !ownedByThisUser) {
    return { action: 'drop-subscription', clearOwner: ownedByOther };
  }

  if (!ownedByThisUser) {
    // Nobody opted in on this device as this user.
    return { action: 'nothing', clearOwner: ownedByOther };
  }

  if (hasSubscription) {
    const stale = now - owner.syncedAt > RESYNC_AFTER_MS;
    return { action: stale ? 'resave-subscription' : 'nothing', clearOwner: false };
  }

  // They opted in here earlier and the subscription is gone (logout removed
  // it). Restoring needs no prompt — but only if permission is still granted.
  return { action: permission === 'granted' ? 'restore-subscription' : 'nothing', clearOwner: false };
}
