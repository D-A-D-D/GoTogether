'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, type Tag } from '@/lib/api';
import { Label, TextInput, TextArea, ErrorText, PrimaryButton } from '@/components/form-controls';

const MAX_INCLUDE_TAGS = 3;

/** Raw form state: strings as typed, so callers decide how to turn "empty" into create-vs-clear. */
export interface TripFormValues {
  title: string;
  description: string;
  destination: string;
  startDate: string;
  endDate: string;
  flexibleDates: boolean;
  budgetMin: string;
  budgetMax: string;
  capacity: string;
  tripType: string;
  includeTagIds: string[];
  excludeTagIds: string[];
}

export const EMPTY_TRIP_FORM: TripFormValues = {
  title: '',
  description: '',
  destination: '',
  startDate: '',
  endDate: '',
  flexibleDates: false,
  budgetMin: '',
  budgetMax: '',
  capacity: '4',
  tripType: '',
  includeTagIds: [],
  excludeTagIds: [],
};

interface TripFormProps {
  tags: Tag[];
  /** Initial values. Read once, on mount — render the form only after they're known. */
  initial?: TripFormValues;
  /** Lowest allowed capacity: 2, or the number of people already approved when editing. */
  minCapacity?: number;
  submitLabel: string;
  submittingLabel: string;
  /** Shown when the failure isn't an ApiError carrying its own message. */
  failureMessage: string;
  /** Rejects with an ApiError when the server refuses the trip; resolves when the caller has handled success. */
  onSubmit: (values: TripFormValues) => Promise<void>;
}

/** The fields of a trip, shared by "Host a trip" and "Edit trip". */
export function TripForm({
  tags,
  initial = EMPTY_TRIP_FORM,
  minCapacity = 2,
  submitLabel,
  submittingLabel,
  failureMessage,
  onSubmit,
}: TripFormProps) {
  const [values, setValues] = useState<TripFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const excludeEligibleTags = useMemo(() => tags.filter((t) => t.category === 'STYLE'), [tags]);

  function set<K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleInclude(id: string) {
    setValues((prev) => {
      if (prev.includeTagIds.includes(id)) return { ...prev, includeTagIds: prev.includeTagIds.filter((t) => t !== id) };
      if (prev.includeTagIds.length >= MAX_INCLUDE_TAGS) return prev;
      return { ...prev, includeTagIds: [...prev.includeTagIds, id] };
    });
  }

  function toggleExclude(id: string) {
    setValues((prev) => ({
      ...prev,
      excludeTagIds: prev.excludeTagIds.includes(id)
        ? prev.excludeTagIds.filter((t) => t !== id)
        : [...prev.excludeTagIds, id],
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failureMessage);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <TextInput
          id="title"
          required
          maxLength={120}
          placeholder="Goa trekking weekend"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destination">Destination</Label>
        <TextInput
          id="destination"
          required
          maxLength={120}
          value={values.destination}
          onChange={(e) => set('destination', e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <TextArea
          id="description"
          rows={3}
          maxLength={2000}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <TextInput
            id="startDate"
            type="date"
            required
            value={values.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">End date</Label>
          <TextInput
            id="endDate"
            type="date"
            required
            value={values.endDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground/70">
        <input
          type="checkbox"
          checked={values.flexibleDates}
          onChange={(e) => set('flexibleDates', e.target.checked)}
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
            value={values.budgetMin}
            onChange={(e) => set('budgetMin', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetMax">Budget max</Label>
          <TextInput
            id="budgetMax"
            type="number"
            min={0}
            required
            value={values.budgetMax}
            onChange={(e) => set('budgetMax', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacity">Capacity</Label>
          <TextInput
            id="capacity"
            type="number"
            min={minCapacity}
            required
            value={values.capacity}
            onChange={(e) => set('capacity', e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tripType">
          Trip type <span className="text-foreground/40">(optional — a visible label, e.g. &ldquo;women-only&rdquo;)</span>
        </Label>
        <TextInput id="tripType" maxLength={60} value={values.tripType} onChange={(e) => set('tripType', e.target.value)} />
      </div>

      <div>
        <Label>
          Include tags <span className="text-foreground/40">(up to {MAX_INCLUDE_TAGS}, shown publicly)</span>
        </Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map((tag) => {
            const active = values.includeTagIds.includes(tag.id);
            const disabled = !active && values.includeTagIds.length >= MAX_INCLUDE_TAGS;
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
            const active = values.excludeTagIds.includes(tag.id);
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
        {submitting ? submittingLabel : submitLabel}
      </PrimaryButton>
    </form>
  );
}
