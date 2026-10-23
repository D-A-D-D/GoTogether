'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/use-require-auth';
import { createTrip, getTags, type Tag } from '@/lib/api';
import { TripForm, type TripFormValues } from '@/components/trip-form';

export default function NewTripPage() {
  const status = useRequireAuth();
  const router = useRouter();

  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    if (status === 'authenticated') getTags().then(setTags).catch(() => setTags([]));
  }, [status]);

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
    router.push(`/trips/${trip.id}`);
  }

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Host a trip</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Set the essentials — you can always share more in the group chat once people join.
      </p>

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
