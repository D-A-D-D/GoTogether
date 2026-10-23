// Web Push on this device: subscribe/unsubscribe and report the current state.
// The worker side (showing the notification, handling the click) lives in
// public/sw.js; the server side in apps/api/src/notifications.

import { deletePushSubscription, getVapidPublicKey, savePushSubscription } from '@/lib/api';

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

/** The VAPID key arrives base64url-encoded; `subscribe()` wants raw bytes. */
function decodeVapidKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Must be called from a user gesture (a click) — browsers refuse to show the
 * permission prompt otherwise. Throws PushPermissionError if the user says no.
 */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushPermissionError();

  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await getVapidPublicKey();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    await subscription.unsubscribe();
    throw new Error('The browser returned an incomplete push subscription.');
  }

  try {
    await savePushSubscription({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  } catch (err) {
    // Don't leave the browser subscribed to something the server doesn't know about.
    await subscription.unsubscribe().catch(() => undefined);
    throw err;
  }

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

/**
 * Turns notifications off for this device. Also run on logout: the server
 * delivers to a subscription's device, so without this a shared device would
 * keep showing the previous person's notifications after they log out.
 */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  // Server first, so it stops sending. A failure there is harmless — the
  // server deletes a dead subscription the next time a push bounces — so it
  // never blocks turning the device off (or logging out).
  await deletePushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}
