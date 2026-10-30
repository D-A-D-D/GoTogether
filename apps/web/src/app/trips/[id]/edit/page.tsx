'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, getTags, getTrip, updateTrip, type TripDetail } from '@/lib/api';
import { invalidateQueries, useQuery } from '@/lib/query';
import { ErrorText } from '@/components/form-controls';
import { TripForm, type TripFormValues } from '@/components/trip-form';
import { Skeleton } from '@/components/ui';

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
  const signedIn = authStatus === 'authenticated';

  // staleMs 0: the form copies its starting values once, so it must start from the trip as it is
  // now, never from a copy remembered a minute ago.
  const tripQuery = useQuery(`trip:${tripId}`, () => getTrip(tripId), { staleMs: 0, enabled: signedIn });
  const tagsQuery = useQuery('tags', getTags, { staleMs: 600_000, enabled: signedIn });
  const trip = tripQuery.data;
  const tags = tagsQuery.data;

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
    invalidateQueries(`trip:${tripId}`, 'trips:mine', 'discover:');
    router.push(`/trips/${tripId}`);
  }

  if (!signedIn) return null;

  const message = (text: string) => (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start gap-3 px-4 py-8">
      <h1 className="sr-only">Edit trip</h1>
      <p className="text-lg text-muted">{text}</p>
      <Link href={`/trips/${tripId}`} className="font-semibold text-accent-ink underline-offset-4 hover:underline">
        Back to the trip
      </Link>
    </main>
  );

  if (tripQuery.error && !trip) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <ErrorText>{tripQuery.error instanceof ApiError ? tripQuery.error.message : 'Could not load this trip.'}</ErrorText>
      </main>
    );
  }

  // Not the form until this is the current copy of the trip, not a remembered one.
  if (!trip || !tags || !user || tripQuery.isRefreshing) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10 pt-5" aria-busy="true" aria-label="Loading trip">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-5 h-64 w-full !rounded-2xl" />
        <Skeleton className="mt-4 h-48 w-full !rounded-2xl" />
      </main>
    );
  }

  if (trip.hostId !== user.id) return message('Only the host can edit this trip.');
  if (trip.status !== 'OPEN' && trip.status !== 'FULL') {
    return message(`A ${trip.status.toLowerCase()} trip can't be edited.`);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10 pt-5">
      <h1 className="sr-only">Edit trip</h1>
      <p className="text-lg text-muted">
        {trip.approvedCount > 1
          ? 'People already on this trip are notified if you change the dates, destination or budget. '
          : ''}
        Places can&apos;t go below the {trip.approvedCount} {trip.approvedCount === 1 ? 'person' : 'people'} already
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
