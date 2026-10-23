// Web Push on this device: subscribe/unsubscribe and report the current state.
// The worker side (showing the notification, handling the click) lives in
// public/sw.js; the server side in apps/api/src/notifications; the rules for
// whose subscription this is in push-sync-policy.ts.

import { deletePushSubscription, getVapidPublicKey, savePushSubscription } from '@/lib/api';
import { decidePushSync, type PushOwner } from '@/lib/push-sync-policy';

export type PushStatus =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on' };

/** The user declined (or has blocked) the browser's notification prompt. */
export class PushPermissionError extends Error {
  constructor() {
    super('Notification permission was not granted');
    this.name = 'PushPermissionError';
  }
}

// The service worker is registered in production only (see
// register-service-worker.tsx), and push needs one.
const WORKER_ENABLED = process.env.NODE_ENV === 'production';

function browserSupportsPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// ---- Who turned push on for this device ----
//
// A subscription belongs to the device but notifications are about an
// account, so the browser remembers which account opted in (see
// push-sync-policy.ts for how that's used). localStorage can be unavailable
// (private windows, blocked site data), so every access is guarded and the
// app behaves sensibly without it: no owner means no silent restore, and any
// leftover subscription is dropped at the next login.

const OWNER_KEY = 'gotogether.push.owner';

function readOwner(): PushOwner | null {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as PushOwner).userId === 'string' &&
      typeof (parsed as PushOwner).syncedAt === 'number'
    ) {
      return parsed as PushOwner;
    }
  } catch {
    // fall through
  }
  return null;
}

function writeOwner(userId: string): void {
  try {
    const owner: PushOwner = { userId, syncedAt: Date.now() };
    localStorage.setItem(OWNER_KEY, JSON.stringify(owner));
  } catch {
    // Storage unavailable — see above.
  }
}

function clearOwner(): void {
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // Storage unavailable — see above.
  }
}

// ---- Subscription plumbing ----

/**
 * This device's current subscription, if any. Deliberately uses
 * `getRegistration()` rather than `serviceWorker.ready`: `ready` never
 * resolves when no worker exists (development), and this runs on logout.
 */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (!browserSupportsPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** The VAPID key arrives base64url-encoded; `subscribe()` wants raw bytes. */
function decodeVapidKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Saves a subscription to the server. */
async function saveToServer(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('The browser returned an incomplete push subscription.');
  }
  await savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
}

/**
 * Subscribes (or reuses this device's existing subscription) and saves it to
 * the server. If the save fails the browser subscription is removed again, so
 * the browser is never subscribed to something the server doesn't know about.
 * Needs notification permission to already be granted.
 */
async function subscribeAndSave(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  const { publicKey } = await getVapidPublicKey();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    }));
  try {
    await saveToServer(subscription);
  } catch (err) {
    await subscription.unsubscribe().catch(() => undefined);
    throw err;
  }
  return subscription;
}

/**
 * Removes this device's subscription — server first, so it stops sending. A
 * failure there is harmless (the server deletes a dead subscription the next
 * time a push bounces), so it never blocks the device being switched off.
 */
async function removeSubscription(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await deletePushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

// ---- Public API ----

export async function getPushStatus(): Promise<PushStatus> {
  if (!browserSupportsPush()) {
    return {
      kind: 'unsupported',
      reason:
        "This browser can't show push notifications here. On an iPhone or iPad, add GoTogether to your Home Screen first.",
    };
  }
  if (!WORKER_ENABLED) {
    return {
      kind: 'unsupported',
      reason: 'Push notifications need the production build — the service worker is switched off in development.',
    };
  }
  if (Notification.permission === 'denied') return { kind: 'denied' };
  return (await currentSubscription()) ? { kind: 'on' } : { kind: 'off' };
}

/**
 * Must be called from a user gesture (a click) — browsers refuse to show the
 * permission prompt otherwise. Throws PushPermissionError if the user says no.
 */
export async function enablePush(userId: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushPermissionError();

  const registration = await navigator.serviceWorker.ready;
  await subscribeAndSave(registration);
  writeOwner(userId);

  // A local confirmation that the worker can show notifications. Purely
  // cosmetic, so it must never turn a successful subscribe into an error.
  await registration
    .showNotification('Notifications are on', {
      body: "You'll hear about join requests, approvals, chat messages and reviews.",
      icon: '/icons/icon-192.png',
      tag: 'gotogether-push-enabled',
    })
    .catch(() => undefined);
}

/** The user switching notifications off on this device: an explicit opt-out, so nothing is remembered. */
export async function disablePush(): Promise<void> {
  clearOwner();
  await removeSubscription();
}

/**
 * Run on logout. Removes the subscription — the server delivers to a
 * *device*, so without this the next person on a shared phone would keep
 * seeing the previous user's notifications — but keeps the record of who opted
 * in, so that person gets it back quietly next time they log in here.
 */
export async function detachPushForLogout(): Promise<void> {
  await removeSubscription();
}

/**
 * Run whenever a user is signed in. Applies push-sync-policy.ts: drops a
 * subscription that isn't this user's, quietly restores the one they opted
 * into on this device, and now and then re-saves it so a subscription the
 * server forgot heals. Best-effort — callers should swallow errors.
 */
export async function syncPushForUser(userId: string): Promise<void> {
  if (!WORKER_ENABLED || !browserSupportsPush()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;

  const subscription = await registration.pushManager.getSubscription();
  const decision = decidePushSync({
    owner: readOwner(),
    userId,
    hasSubscription: subscription !== null,
    permission: Notification.permission,
    now: Date.now(),
  });

  if (decision.clearOwner) clearOwner();

  switch (decision.action) {
    case 'drop-subscription':
      // Browser side only: the server row belongs to the other account (we
      // couldn't delete it with this user's token anyway) and goes away on
      // its own the first time a push to the now-dead endpoint bounces.
      await subscription?.unsubscribe();
      return;
    case 'resave-subscription':
    case 'restore-subscription':
      await subscribeAndSave(await navigator.serviceWorker.ready);
      writeOwner(userId);
      return;
    case 'nothing':
      return;
  }
}
