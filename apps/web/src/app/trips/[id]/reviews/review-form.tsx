'use client';

import { useId, useState, type FormEvent } from 'react';
import { ApiError, type CreateReviewInput, type ReviewTarget } from '@/lib/api';
import { ErrorText, Label, PrimaryButton, TextArea } from '@/components/form-controls';

const DIMENSIONS = [
  { key: 'reliability', label: 'Reliability', hint: 'Showed up and kept to the plan' },
  { key: 'friendliness', label: 'Friendliness', hint: 'Easy company' },
  { key: 'communication', label: 'Communication', hint: 'Replied and kept everyone in the loop' },
  { key: 'cleanliness', label: 'Cleanliness', hint: 'Respected shared spaces' },
] as const;

type Dimension = (typeof DIMENSIONS)[number]['key'];
type Ratings = Record<Dimension, number | null>;

interface ReviewFormProps {
  target: ReviewTarget;
  /** Rejects with an ApiError when the server refuses the review. */
  onSubmit: (input: CreateReviewInput) => Promise<void>;
  onCancel: () => void;
}

export function ReviewForm({ target, onSubmit, onCancel }: ReviewFormProps) {
  const formId = useId();
  const [ratings, setRatings] = useState<Ratings>({
    reliability: null,
    friendliness: null,
    communication: null,
    cleanliness: null,
  });
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const complete = DIMENSIONS.every((d) => ratings[d.key] !== null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const { reliability, friendliness, communication, cleanliness } = ratings;
    if (
      submitting ||
      reliability === null ||
      friendliness === null ||
      communication === null ||
      cleanliness === null
    ) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        revieweeId: target.id,
        reliability,
        friendliness,
        communication,
        cleanliness,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit that review.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-xs text-foreground/50">Rate each from 1 (poor) to 5 (excellent).</p>

      {DIMENSIONS.map((d) => (
        <fieldset key={d.key}>
          <legend className="text-sm font-medium text-foreground/80">
            {d.label} <span className="font-normal text-foreground/50">&middot; {d.hint}</span>
          </legend>
          <div className="mt-1.5 flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="cursor-pointer">
                <input
                  type="radio"
                  name={`${formId}-${d.key}`}
                  value={n}
                  checked={ratings[d.key] === n}
                  onChange={() => setRatings((prev) => ({ ...prev, [d.key]: n }))}
                  className="peer sr-only"
                />
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-sm text-foreground/70 transition hover:border-accent/50 peer-checked:border-accent peer-checked:bg-accent peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50">
                  {n}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div>
        <Label htmlFor={`${formId}-comment`}>Comment (optional)</Label>
        <TextArea
          id={`${formId}-comment`}
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="mt-1"
        />
      </div>

      <p className="text-xs text-foreground/50">
        {target.name} will see your name, ratings and comment &mdash; once you&apos;ve both reviewed each other, or
        after 14 days.
      </p>

      <ErrorText>{error}</ErrorText>

      <div className="flex items-center gap-4">
        <PrimaryButton type="submit" disabled={!complete || submitting} className="w-fit px-6">
          {submitting ? 'Submitting…' : 'Submit review'}
        </PrimaryButton>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-sm text-foreground/60 underline hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
