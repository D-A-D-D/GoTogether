'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/lib/use-require-auth';
import { listMyTrips } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { formatDateRange, plural, tripDays } from '@/lib/format';
import { travelHistory } from '@/lib/travel-history';
import { ErrorText } from '@/components/form-controls';
import { Card, EmptyState, Skeleton, TripCover } from '@/components/ui';
import { IconChevronRight } from '@/components/icons';
import { TrustHistory } from '@/app/profile/trust-history';

export default function TravelHistoryPage() {
  const status = useRequireAuth();
  const { data, error, isLoading } = useQuery('trips:mine', listMyTrips, { enabled: status === 'authenticated' });
  // Fixed when the page opens, so render stays pure.
  const [openedAt] = useState(() => Date.now());

  if (status !== 'authenticated') return null;

  const { past, totals: counts } = travelHistory(data ?? [], openedAt);
  const totals: [number, string][] = [
    [counts.trips, counts.trips === 1 ? 'trip' : 'trips'],
    [counts.places, counts.places === 1 ? 'place' : 'places'],
    [counts.days, counts.days === 1 ? 'day away' : 'days away'],
  ];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-4">
      <h1 className="sr-only">Travel history</h1>
      <ErrorText>{error && !data ? error.message || 'Could not load your trips.' : null}</ErrorText>

      {isLoading && <Skeleton className="h-24 w-full !rounded-2xl" />}

      {data && (
        <>
          <Card className="grid grid-cols-3 divide-x divide-line p-4 text-center">
            {totals.map(([n, label]) => (
              <div key={label} className="px-2">
                <p className="font-display text-3xl font-extrabold leading-none">{n}</p>
                <p className="mt-1 text-[0.9rem] text-muted">{label}</p>
              </div>
            ))}
          </Card>

          {past.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="No finished trips yet">Trips you have been on appear here once they are over.</EmptyState>
            </div>
          ) : (
            <ul className="mt-5 flex flex-col gap-3">
              {past.map((m) => (
                <li key={m.id}>
                  <Link href={`/trips/${m.trip.id}`} className="pressable flex items-center gap-4 rounded-2xl border border-line bg-surface p-3 shadow-card">
                    <TripCover seed={m.trip.destination} photoUrl={m.trip.coverPhotoUrl} className="h-16 w-16 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-semibold leading-tight">{m.trip.title}</p>
                      <p className="mt-0.5 text-[0.9rem] text-muted">
                        {m.trip.destination} · {formatDateRange(m.trip.startDate, m.trip.endDate)} · {plural(tripDays(m.trip.startDate, m.trip.endDate), 'day')}
                      </p>
                      <p className="text-[0.85rem] font-semibold text-muted">{m.role === 'HOST' ? 'You hosted' : 'You went'}</p>
                    </div>
                    <IconChevronRight size={20} className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="-mt-4">
        <TrustHistory />
      </div>
    </main>
  );
}
