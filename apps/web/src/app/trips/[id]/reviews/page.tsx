'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/use-require-auth';
import {
  ApiError,
  getTrip,
  listPendingReviews,
  listReceivedReviews,
  submitReview,
  type CreateReviewInput,
  type ReceivedReview,
  type ReviewTarget,
  type TripDetail,
} from '@/lib/api';
import { ErrorText } from '@/components/form-controls';
import { ReviewForm } from './review-form';

const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

const RATING_LABELS = [
  ['Reliability', 'reliability'],
  ['Friendliness', 'friendliness'],
  ['Communication', 'communication'],
  ['Cleanliness', 'cleanliness'],
] as const;

export default function TripReviewsPage() {
  const authStatus = useRequireAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [pending, setPending] = useState<ReviewTarget[] | null>(null);
  const [received, setReceived] = useState<ReceivedReview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedTrip, loadedPending, loadedReceived] = await Promise.all([
        getTrip(tripId),
        listPendingReviews(tripId),
        listReceivedReviews(tripId),
      ]);
      setTrip(loadedTrip);
      setPending(loadedPending);
      setReceived(loadedReceived);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? 'Only people who were on this trip can see its reviews.'
          : 'Could not load reviews.',
      );
    }
  }, [tripId]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    // Deferred a microtask so setState inside load() never happens
    // synchronously within the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [authStatus, load]);

  async function handleSubmit(input: CreateReviewInput) {
    await submitReview(tripId, input);
    setReviewingId(null);
    await load();
  }

  if (authStatus !== 'authenticated') return null;

  // A failed reload after the first successful load shouldn't blank the page.
  if (loadError && !trip) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <ErrorText>{loadError}</ErrorText>
      </main>
    );
  }

  if (!trip || !pending || !received) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-foreground/60">Loading reviews…</p>
      </main>
    );
  }

  const completed = trip.status === 'COMPLETED';

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <Link href={`/trips/${tripId}`} className="text-sm text-foreground/60 hover:text-foreground">
        &larr; Back to trip
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Reviews</h1>
      <p className="mt-1 text-foreground/70">{trip.title}</p>

      {loadError && (
        <div className="mt-4">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      {!completed ? (
        <p className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm text-foreground/70">
          Reviews open once the host marks this trip complete after it ends.
        </p>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">Review your fellow travellers</h2>
            <p className="mt-1 text-sm text-foreground/60">
              Reviews stay hidden until you&apos;ve both reviewed each other, or 14 days pass &mdash; so nobody&apos;s
              rating is shaped by what the other said.
            </p>
            {pending.length === 0 ? (
              <p className="mt-3 text-sm text-foreground/60">You&apos;ve reviewed everyone on this trip.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {pending.map((person) => (
                  <li key={person.id} className="rounded-xl border border-line bg-surface p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{person.name}</span>
                      {reviewingId !== person.id && (
                        <button
                          type="button"
                          onClick={() => setReviewingId(person.id)}
                          className="rounded-full border border-line px-4 py-1.5 text-sm text-foreground/70 hover:border-accent/50 hover:text-foreground"
                        >
                          Write review
                        </button>
                      )}
                    </div>
                    {reviewingId === person.id && (
                      <div className="mt-4 border-t border-line pt-4">
                        <ReviewForm
                          key={person.id}
                          target={person}
                          onSubmit={handleSubmit}
                          onCancel={() => setReviewingId(null)}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight">Reviews about you</h2>
            {received.length === 0 ? (
              <p className="mt-3 text-sm text-foreground/60">
                Nothing to show yet. A review about you appears here once you&apos;ve reviewed that person too, or
                after 14 days.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {received.map((review) => (
                  <li key={review.id} className="rounded-xl border border-line bg-surface p-4">
                    <p className="text-sm">
                      <span className="font-medium">{review.reviewer.name}</span>
                      <span className="text-foreground/50"> &middot; {dateFormat.format(new Date(review.createdAt))}</span>
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                      {RATING_LABELS.map(([label, key]) => (
                        <div key={key}>
                          <dt className="text-xs text-foreground/50">{label}</dt>
                          <dd className="tabular-nums">{review[key]} / 5</dd>
                        </div>
                      ))}
                    </dl>
                    {review.comment && <p className="mt-3 text-sm text-foreground/80">{review.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
