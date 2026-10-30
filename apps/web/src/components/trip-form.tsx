'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, type Tag } from '@/lib/api';
import { Label, TextInput, TextArea, ErrorText, PrimaryButton } from '@/components/form-controls';
import { Card } from '@/components/ui';
import { IconCheck } from '@/components/icons';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </Card>
  );
}

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
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
      <Section title="The trip">
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
      </Section>

      <Section title="When and how much">
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

      <label className="flex min-h-11 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={values.flexibleDates}
          onChange={(e) => set('flexibleDates', e.target.checked)}
          className="h-6 w-6 shrink-0 rounded border-field accent-accent"
        />
        Dates are flexible by a few days
      </label>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetMin">Budget from (₹)</Label>
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
          <Label htmlFor="budgetMax">Budget to (₹)</Label>
          <TextInput
            id="budgetMax"
            type="number"
            min={0}
            required
            value={values.budgetMax}
            onChange={(e) => set('budgetMax', e.target.value)}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <Label htmlFor="capacity">Places (including you)</Label>
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

      </Section>

      <Section title="Who it is for">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tripType">
          Trip type <span className="text-muted">(optional — a visible label, e.g. &ldquo;women-only&rdquo;)</span>
        </Label>
        <TextInput id="tripType" maxLength={60} value={values.tripType} onChange={(e) => set('tripType', e.target.value)} />
      </div>

      <div>
        <Label>
          Include tags <span className="text-muted">(up to {MAX_INCLUDE_TAGS}, shown publicly)</span>
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
                aria-pressed={active}
                className={`pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-base font-medium transition ${
                  active
                    ? 'border-accent bg-accent text-on-accent'
                    : disabled
                      ? 'border-line text-muted opacity-50'
                      : 'border-field text-foreground hover:border-accent'
                }`}
              >
                {active && <IconCheck size={18} />}
                {tag.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>
          Exclude tags{' '}
          <span className="text-muted">(private — never shown to anyone, style tags only)</span>
        </Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {excludeEligibleTags.map((tag) => {
            const active = values.excludeTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleExclude(tag.id)}
                aria-pressed={active}
                className={`pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-4 text-base font-medium transition ${
                  active
                    ? 'border-accent-2 bg-accent-2 text-background'
                    : 'border-field text-foreground hover:border-accent-2'
                }`}
              >
                {active && <IconCheck size={18} />}
                {tag.name}
              </button>
            );
          })}
        </div>
      </div>

      </Section>

      <ErrorText>{error}</ErrorText>

      <PrimaryButton type="submit" disabled={submitting} className="h-14 text-lg">
        {submitting ? submittingLabel : submitLabel}
      </PrimaryButton>
    </form>
  );
}
