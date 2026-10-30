'use client';

import { useRequireAuth } from '@/lib/use-require-auth';
import { BlockedPeople } from '@/app/profile/blocked-people';

export default function BlockedPeoplePage() {
  const status = useRequireAuth();
  if (status !== 'authenticated') return null;
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-4">
      <h1 className="sr-only">Blocked people</h1>
      <BlockedPeople standalone />
    </main>
  );
}
