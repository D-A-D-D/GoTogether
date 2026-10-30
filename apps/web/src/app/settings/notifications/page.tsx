'use client';

import { useRequireAuth } from '@/lib/use-require-auth';
import { PushSettings } from '@/app/profile/push-settings';

export default function NotificationSettingsPage() {
  const status = useRequireAuth();
  if (status !== 'authenticated') return null;
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-4">
      <h1 className="sr-only">Notifications</h1>
      <PushSettings standalone />
    </main>
  );
}
