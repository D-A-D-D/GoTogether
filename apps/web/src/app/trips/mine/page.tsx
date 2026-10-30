'use client';

import Link from 'next/link';
import { useRequireAuth } from '@/lib/use-require-auth';
import { listMyTrips, type MyTripMembership } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { formatDateRange } from '@/lib/format';
import { ErrorText } from '@/components/form-controls';
import { ButtonLink, Chip, EmptyState, Skeleton, TripCover } from '@/components/ui';
import { prefetchTrip } from '@/components/trip-card';
import { IconChevronRight, IconPlus } from '@/components/icons';

type Group = 'hosting' | 'going' | 'pending' | 'other';

const GROUPS: { id: Group; title: string }[] = [
  { id: 'hosting', title: 'Hosting' },
  { id: 'going', title: 'You\'re going' },
  { id: 'pending', title: 'Waiting for a reply' },
  { id: 'other', title: 'Earlier' },
];

function groupOf(m: MyTripMembership): Group {
  // A cancelled trip is over whatever your part in it was.
  if (m.trip.status === 'CANCELLED') return 'other';
  if (m.role === 'HOST') return 'hosting';
  if (m.status === 'APPROVED') return 'going';
  if (m.status === 'REQUESTED') return 'pending';
  return 'other';
}

function badgeFor(m: MyTripMembership): { label: string; tone: 'plain' | 'accent' | 'gold' } {
  if (m.trip.status === 'CANCELLED') return { label: 'Cancelled', tone: 'plain' };
  if (m.role === 'HOST') return { label: 'Hosting', tone: 'accent' };
  switch (m.status) {
    case 'APPROVED':
      return { label: 'Going', tone: 'accent' };
    case 'REQUESTED':
      return { label: 'Pending', tone: 'gold' };
    case 'REJECTED':
      return { label: 'Not accepted', tone: 'plain' };
    case 'LEFT':
      return { label: 'Left', tone: 'plain' };
    case 'REMOVED':
      return { label: 'Removed', tone: 'plain' };
    default:
      return { label: m.status, tone: 'plain' };
  }
}

export default function MyTripsPage() {
  const status = useRequireAuth();
  const { data, error, isLoading } = useQuery('trips:mine', listMyTrips, { enabled: status === 'authenticated' });

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 pt-5">
      <h1 className="sr-only">My trips</h1>
      <ErrorText>{error && !data ? error.message || 'Could not load your trips.' : null}</ErrorText>

      {isLoading && (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full !rounded-2xl" />
          ))}
        </div>
      )}

      {data?.length === 0 && (
        <EmptyState
          title="No trips yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/trips/discover">Discover trips</ButtonLink>
              <ButtonLink href="/trips/new" variant="secondary">
                Host your own
              </ButtonLink>
            </div>
          }
        >
          Find people to travel with, or start a trip and let them find you.
        </EmptyState>
      )}

      {data && data.length > 0 && (
        <div className="flex flex-col gap-7">
          {GROUPS.map((group) => {
            const items = data.filter((m) => groupOf(m) === group.id);
            if (items.length === 0) return null;
            return (
              <section key={group.id} aria-labelledby={`g-${group.id}`}>
                <h2 id={`g-${group.id}`} className="mb-2.5 px-1 text-lg font-bold">
                  {group.title}
                  <span className="ml-2 text-base font-medium text-muted">{items.length}</span>
                </h2>
                <ul className="flex flex-col gap-3">
                  {items.map((m) => {
                    const badge = badgeFor(m);
                    return (
                      <li key={m.id}>
                        <Link
                          href={`/trips/${m.trip.id}`}
                          onPointerEnter={() => prefetchTrip(m.trip.id)}
                          onTouchStart={() => prefetchTrip(m.trip.id)}
                          className="pressable flex items-center gap-4 rounded-2xl border border-line bg-surface p-3 shadow-card"
                        >
                          <TripCover seed={m.trip.destination} photoUrl={m.trip.coverPhotoUrl} className="h-20 w-20 shrink-0 rounded-xl" />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-lg font-semibold leading-tight">{m.trip.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-[0.95rem] text-muted">
                              {m.trip.destination} · {formatDateRange(m.trip.startDate, m.trip.endDate)}
                            </p>
                            <Chip tone={badge.tone} className="mt-2 !py-0.5 !text-[0.85rem]">
                              {badge.label}
                            </Chip>
                          </div>
                          <IconChevronRight size={22} className="shrink-0 text-muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <ButtonLink href="/trips/new" variant="secondary" className="self-center">
            <IconPlus size={20} />
            Host a trip
          </ButtonLink>
        </div>
      )}
    </main>
  );
}
