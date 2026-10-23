'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, getTags, getTrip, updateTrip, type Tag, type TripDetail } from '@/lib/api';
import { ErrorText } from '@/components/form-controls';
import { TripForm, type TripFormValues } from '@/components/trip-form';

/** Dates arrive as full ISO timestamps; the date inputs want just the day. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function formValuesFor(trip: TripDetail): TripFormValues {
  return {
    title: trip.title,
    description: trip.description ?? '',
    destination: trip.destination,
    startDate: dayOf(trip.startDate),
    endDate: dayOf(trip.endDate),
    flexibleDates: trip.flexibleDates,
    budgetMin: String(trip.budgetMin),
    budgetMax: String(trip.budgetMax),
    capacity: String(trip.capacity),
    tripType: trip.tripType ?? '',
    includeTagIds: trip.includeTags.map((t) => t.id),
    // The host is the only viewer who ever receives these.
    excludeTagIds: (trip.excludeTags ?? []).map((t) => t.id),
  };
}

export default function EditTripPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    // Deferred a microtask so setState never happens synchronously within
    // the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(async () => {
      try {
        const [loadedTrip, allTags] = await Promise.all([getTrip(tripId), getTags()]);
        if (cancelled) return;
        setTrip(loadedTrip);
        setTags(allTags);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Could not load this trip.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authStatus, tripId]);

  async function handleSubmit(values: TripFormValues) {
    await updateTrip(tripId, {
      title: values.title,
      // Empty strings clear these two; everything else is always sent.
      description: values.description,
      tripType: values.tripType,
      destination: values.destination,
      startDate: values.startDate,
      endDate: values.endDate,
      flexibleDates: values.flexibleDates,
      budgetMin: Number(values.budgetMin),
      budgetMax: Number(values.budgetMax),
      capacity: Number(values.capacity),
      includeTagIds: values.includeTagIds,
      excludeTagIds: values.excludeTagIds,
    });
    router.push(`/trips/${tripId}`);
  }

  if (authStatus !== 'authenticated') return null;

  const message = (text: string) => (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-3 px-6 py-12">
      <Link href={`/trips/${tripId}`} className="text-sm text-foreground/60 hover:text-foreground">
        &larr; Back to trip
      </Link>
      <p className="text-sm text-foreground/70">{text}</p>
    </main>
  );

  if (loadError) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <ErrorText>{loadError}</ErrorText>
      </main>
    );
  }

  if (!trip || !tags || !user) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-foreground/60">Loading trip…</p>
      </main>
    );
  }

  if (trip.hostId !== user.id) return message('Only the host can edit this trip.');
  if (trip.status !== 'OPEN' && trip.status !== 'FULL') {
    return message(`A ${trip.status.toLowerCase()} trip can't be edited.`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <Link href={`/trips/${tripId}`} className="text-sm text-foreground/60 hover:text-foreground">
        &larr; Back to trip
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit trip</h1>
      <p className="mt-1 text-sm text-foreground/60">
        {trip.approvedCount > 1
          ? 'People already on this trip are notified if you change the dates, destination or budget. '
          : ''}
        Capacity can&apos;t go below the {trip.approvedCount} {trip.approvedCount === 1 ? 'person' : 'people'} already
        approved.
      </p>

      <TripForm
        tags={tags}
        initial={formValuesFor(trip)}
        minCapacity={Math.max(2, trip.approvedCount)}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        failureMessage="Could not save your changes — try again."
        onSubmit={handleSubmit}
      />
    </main>
  );
}
