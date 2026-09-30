'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, discoverTrips, type DiscoveredTrip } from '@/lib/api';
import { Label, TextInput, ErrorText, PrimaryButton } from '@/components/form-controls';
import { TripCard } from '@/components/trip-card';

export default function DiscoverTripsPage() {
  const status = useRequireAuth();

  const [destination, setDestination] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [trips, setTrips] = useState<DiscoveredTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await discoverTrips({
        destination: destination || undefined,
        budgetMin: budgetMin ? Number(budgetMin) : undefined,
        budgetMax: budgetMax ? Number(budgetMax) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setTrips(results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load trips — try again.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit "Search" submit only, not on every keystroke
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    // Deferred a microtask so setState inside runSearch() never happens
    // synchronously within the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => runSearch());
  }, [status, runSearch]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    runSearch();
  }

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Discover trips</h1>
        <Link href="/trips/new" className="text-sm text-accent hover:underline">
          Host a trip
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap items-end gap-3">
        <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="destination">Destination</Label>
          <TextInput
            id="destination"
            placeholder="Anywhere"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetMin">Budget min</Label>
          <TextInput
            id="budgetMin"
            type="number"
            min={0}
            className="w-28"
            value={budgetMin}
            onChange={(e) => setBudgetMin(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetMax">Budget max</Label>
          <TextInput
            id="budgetMax"
            type="number"
            min={0}
            className="w-28"
            value={budgetMax}
            onChange={(e) => setBudgetMax(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">From</Label>
          <TextInput id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">To</Label>
          <TextInput id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <PrimaryButton type="submit" disabled={loading} className="w-auto px-5">
          {loading ? 'Searching…' : 'Search'}
        </PrimaryButton>
      </form>

      <ErrorText>{error}</ErrorText>

      <div className="mt-8 flex flex-col gap-3">
        {trips !== null && trips.length === 0 && !loading && (
          <p className="text-sm text-foreground/60">No trips match yet — try widening your search.</p>
        )}
        {trips?.map((trip) => <TripCard key={trip.id} trip={trip} />)}
      </div>
    </main>
  );
}
