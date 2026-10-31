'use client';

import Link from 'next/link';
import { getTrip, type DiscoveredTrip, type Trip } from '@/lib/api';
import { formatBudget, formatDateRange, plural, tripDays } from '@/lib/format';
import { prefetchQuery } from '@/lib/query';
import { Chip, Skeleton, TripCover } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { IconCalendar, IconShield, IconUsers, IconWallet } from '@/components/icons';

/** Starts loading a trip's details as soon as a pointer or finger reaches its card. */
export function prefetchTrip(id: string) {
  prefetchQuery(`trip:${id}`, () => getTrip(id));
}

/** A trip in a feed: a cover to catch the eye, then the facts a person actually decides on. */
export function TripCard({ trip }: { trip: Trip | DiscoveredTrip }) {
  const matchScore = 'matchScore' in trip ? trip.matchScore : undefined;
  const isOwn = 'isOwn' in trip && trip.isOwn === true;
  const isJoined = 'isJoined' in trip && trip.isJoined === true;
  const days = tripDays(trip.startDate, trip.endDate);

  return (
    <Link
      href={`/trips/${trip.id}`}
      onPointerEnter={() => prefetchTrip(trip.id)}
      onTouchStart={() => prefetchTrip(trip.id)}
      className="pressable group block overflow-hidden rounded-3xl border border-line bg-surface shadow-card"
    >
      <TripCover seed={trip.destination} photoUrl={trip.coverPhotoUrl} className="aspect-[16/10]">
        {isOwn || isJoined ? (
          <Chip tone="gold" className="absolute right-3 top-3 font-bold shadow">
            {isOwn ? 'Your trip' : 'Joined'}
          </Chip>
        ) : (
          matchScore !== undefined && (
            <Chip tone="gold" className="absolute right-3 top-3 font-bold shadow">
              {matchScore}% match
            </Chip>
          )
        )}
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="font-display text-[1.7rem] font-bold leading-tight drop-shadow">{trip.destination}</p>
          <p className="mt-0.5 text-[0.95rem] font-medium text-white/90">
            {formatDateRange(trip.startDate, trip.endDate)} · {plural(days, 'day')}
          </p>
        </div>
      </TripCover>

      <div className="flex flex-col gap-3 p-4">
        <h3 className="text-xl font-semibold leading-snug">{trip.title}</h3>

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.95rem] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <IconWallet size={18} />
            {formatBudget(trip.budgetMin, trip.budgetMax)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <IconUsers size={18} />
            {plural(trip.capacity, 'seat')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <IconCalendar size={18} />
            {trip.flexibleDates ? 'Flexible dates' : 'Fixed dates'}
          </span>
        </div>

        {trip.includeTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {trip.includeTags.map((tag) => (
              <Chip key={tag.id}>{tag.name}</Chip>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-line pt-3">
          <UserAvatar user={trip.host} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{trip.host.name}</p>
            <p className="truncate text-[0.9rem] text-muted">{trip.host.homeCity ? `Hosting from ${trip.host.homeCity}` : 'Host'}</p>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[0.9rem] font-semibold"
            title="Trust score"
          >
            <IconShield size={16} className="text-accent-ink" />
            {Math.round(trip.host.trustScore)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** The same shape as a TripCard, drawn grey while the real one loads, so the page does not jump. */
export function TripCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card" aria-hidden="true">
      <Skeleton className="aspect-[16/10] w-full !rounded-none" />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-20 !rounded-full" />
          <Skeleton className="h-7 w-24 !rounded-full" />
        </div>
        <div className="flex items-center gap-3 border-t border-line pt-3">
          <Skeleton className="h-9 w-9 !rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </div>
  );
}
