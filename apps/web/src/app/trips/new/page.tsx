'use client';

import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/use-require-auth';
import { createTrip, getTags } from '@/lib/api';
import { invalidateQueries, useQuery } from '@/lib/query';
import { TripForm, type TripFormValues } from '@/components/trip-form';

export default function NewTripPage() {
  const status = useRequireAuth();
  const router = useRouter();

  // The tag list barely ever changes: kept for ten minutes, and usually already there.
  const { data: tags = [] } = useQuery('tags', getTags, { staleMs: 600_000, enabled: status === 'authenticated' });

  async function handleSubmit(values: TripFormValues) {
    const trip = await createTrip({
      title: values.title,
      description: values.description || undefined,
      destination: values.destination,
      startDate: values.startDate,
      endDate: values.endDate,
      flexibleDates: values.flexibleDates,
      budgetMin: Number(values.budgetMin),
      budgetMax: Number(values.budgetMax),
      capacity: Number(values.capacity),
      tripType: values.tripType || undefined,
      includeTagIds: values.includeTagIds.length ? values.includeTagIds : undefined,
      excludeTagIds: values.excludeTagIds.length ? values.excludeTagIds : undefined,
    });
    invalidateQueries('trips:mine', 'discover:');
    router.push(`/trips/${trip.id}`);
  }

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10 pt-5">
      <h1 className="sr-only">Host a trip</h1>
      <p className="text-lg text-muted">Set the essentials. You can always share more in the group chat once people join.</p>

      <TripForm
        tags={tags}
        submitLabel="Create trip"
        submittingLabel="Creating…"
        failureMessage="Could not create the trip — try again."
        onSubmit={handleSubmit}
      />
    </main>
  );
}
