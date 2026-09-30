'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, listMyTrips, type MyTripMembership } from '@/lib/api';
import { ErrorText } from '@/components/form-controls';

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  HOST: { label: 'Hosting', className: 'bg-accent/10 text-accent' },
  REQUESTED: { label: 'Pending', className: 'bg-accent-2/10 text-accent-2' },
  APPROVED: { label: 'Joined', className: 'bg-accent/10 text-accent' },
  REJECTED: { label: 'Not accepted', className: 'bg-foreground/5 text-foreground/50' },
  LEFT: { label: 'Left', className: 'bg-foreground/5 text-foreground/50' },
  REMOVED: { label: 'Removed', className: 'bg-foreground/5 text-foreground/50' },
};

function statusFor(m: MyTripMembership) {
  if (m.role === 'HOST') return STATUS_LABEL.HOST;
  return STATUS_LABEL[m.status] ?? STATUS_LABEL.REQUESTED;
}

export default function MyTripsPage() {
  const status = useRequireAuth();
  const [memberships, setMemberships] = useState<MyTripMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    listMyTrips()
      .then(setMemberships)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load your trips.'));
  }, [status]);

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your trips</h1>
        <Link href="/trips/new" className="text-sm text-accent hover:underline">
          Host a trip
        </Link>
      </div>

      <ErrorText>{error}</ErrorText>

      {memberships?.length === 0 && (
        <p className="mt-8 text-sm text-foreground/60">
          Nothing yet —{' '}
          <Link href="/trips/discover" className="text-accent hover:underline">
            discover a trip
          </Link>{' '}
          or host your own.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {memberships?.map((m) => {
          const badge = statusFor(m);
          return (
            <Link
              key={m.id}
              href={`/trips/${m.trip.id}`}
              className="flex items-center justify-between rounded-xl border border-line bg-surface p-4 transition hover:border-accent/50"
            >
              <div>
                <div className="font-medium">{m.trip.title}</div>
                <div className="text-sm text-foreground/60">{m.trip.destination}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                {badge.label}
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
