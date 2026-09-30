'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, createTrip, getTags, type Tag } from '@/lib/api';
import { Label, TextInput, TextArea, ErrorText, PrimaryButton } from '@/components/form-controls';

const MAX_INCLUDE_TAGS = 3;

export default function NewTripPage() {
  const status = useRequireAuth();
  const router = useRouter();

  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    if (status === 'authenticated') getTags().then(setTags).catch(() => setTags([]));
  }, [status]);
  const excludeEligibleTags = useMemo(() => tags.filter((t) => t.category === 'STYLE'), [tags]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [flexibleDates, setFlexibleDates] = useState(false);
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [tripType, setTripType] = useState('');
  const [includeTagIds, setIncludeTagIds] = useState<string[]>([]);
  const [excludeTagIds, setExcludeTagIds] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleInclude(id: string) {
    setIncludeTagIds((prev) => {
      if (prev.includes(id)) return prev.filter((t) => t !== id);
      if (prev.length >= MAX_INCLUDE_TAGS) return prev;
      return [...prev, id];
    });
  }

  function toggleExclude(id: string) {
    setExcludeTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trip = await createTrip({
        title,
        description: description || undefined,
        destination,
        startDate,
        endDate,
        flexibleDates,
        budgetMin: Number(budgetMin),
        budgetMax: Number(budgetMax),
        capacity: Number(capacity),
        tripType: tripType || undefined,
        includeTagIds: includeTagIds.length ? includeTagIds : undefined,
        excludeTagIds: excludeTagIds.length ? excludeTagIds : undefined,
      });
      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the trip — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (status !== 'authenticated') return null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Host a trip</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Set the essentials — you can always share more in the group chat once people join.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Title</Label>
          <TextInput
            id="title"
            required
            maxLength={120}
            placeholder="Goa trekking weekend"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="destination">Destination</Label>
          <TextInput
            id="destination"
            required
            maxLength={120}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description (optional)</Label>
          <TextArea
            id="description"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startDate">Start date</Label>
            <TextInput
              id="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endDate">End date</Label>
            <TextInput
              id="endDate"
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground/70">
          <input
            type="checkbox"
            checked={flexibleDates}
            onChange={(e) => setFlexibleDates(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-accent"
          />
          Dates are flexible by a few days
        </label>

        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="budgetMin">Budget min</Label>
            <TextInput
              id="budgetMin"
              type="number"
              min={0}
              required
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
              required
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="capacity">Capacity</Label>
            <TextInput
              id="capacity"
              type="number"
              min={2}
              required
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tripType">
            Trip type <span className="text-foreground/40">(optional — a visible label, e.g. &ldquo;women-only&rdquo;)</span>
          </Label>
          <TextInput id="tripType" maxLength={60} value={tripType} onChange={(e) => setTripType(e.target.value)} />
        </div>

        <div>
          <Label>
            Include tags <span className="text-foreground/40">(up to {MAX_INCLUDE_TAGS}, shown publicly)</span>
          </Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => {
              const active = includeTagIds.includes(tag.id);
              const disabled = !active && includeTagIds.length >= MAX_INCLUDE_TAGS;
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleInclude(tag.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    active
                      ? 'border-accent bg-accent text-background'
                      : disabled
                        ? 'border-line text-foreground/30'
                        : 'border-line text-foreground/70 hover:border-accent/50'
                  }`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>
            Exclude tags{' '}
            <span className="text-foreground/40">(private — never shown to anyone, style tags only)</span>
          </Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {excludeEligibleTags.map((tag) => {
              const active = excludeTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleExclude(tag.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    active
                      ? 'border-accent-2 bg-accent-2 text-background'
                      : 'border-line text-foreground/70 hover:border-accent-2/50'
                  }`}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>

        <ErrorText>{error}</ErrorText>

        <PrimaryButton type="submit" disabled={submitting} className="w-fit px-6">
          {submitting ? 'Creating…' : 'Create trip'}
        </PrimaryButton>
      </form>
    </main>
  );
}
