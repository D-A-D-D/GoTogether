'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { Button, Card, Skeleton } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { ReviewForm } from './review-form';

const dateFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', year: 'numeric' });

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
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <ErrorText>{loadError}</ErrorText>
      </main>
    );
  }

  if (!trip || !pending || !received) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 pt-5" aria-busy="true" aria-label="Loading reviews">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="mt-5 h-24 w-full !rounded-2xl" />
        <Skeleton className="mt-3 h-24 w-full !rounded-2xl" />
      </main>
    );
  }

  const completed = trip.status === 'COMPLETED';

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10 pt-5">
      <h1 className="sr-only">Reviews</h1>
      <p className="text-lg font-semibold">{trip.title}</p>

      {loadError && (
        <div className="mt-4">
          <ErrorText>{loadError}</ErrorText>
        </div>
      )}

      {!completed ? (
        <Card className="mt-6 p-5">
          <p className="text-muted">Reviews open once the host marks this trip complete after it ends.</p>
        </Card>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-xl font-bold">Review your fellow travellers</h2>
            <p className="mt-1 text-muted">
              Reviews stay hidden until you&apos;ve both reviewed each other, or 14 days pass &mdash; so nobody&apos;s
              rating is shaped by what the other said.
            </p>
            {pending.length === 0 ? (
              <p className="mt-3 text-muted">You&apos;ve reviewed everyone on this trip.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {pending.map((person) => (
                  <li key={person.id}>
                   <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar user={person} size={44} />
                      <span className="min-w-0 flex-1 truncate text-lg font-semibold">{person.name}</span>
                      {reviewingId !== person.id && (
                        <Button variant="secondary" size="sm" onClick={() => setReviewingId(person.id)}>
                          Write review
                        </Button>
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
                   </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-bold">Reviews about you</h2>
            {received.length === 0 ? (
              <p className="mt-3 text-muted">
                Nothing to show yet. A review about you appears here once you&apos;ve reviewed that person too, or
                after 14 days.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {received.map((review) => (
                  <li key={review.id}>
                   <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <UserAvatar user={review.reviewer} size={36} />
                      <p className="min-w-0">
                        <span className="font-semibold">{review.reviewer.name}</span>
                        <span className="text-[0.9rem] text-muted"> &middot; {dateFormat.format(new Date(review.createdAt))}</span>
                      </p>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                      {RATING_LABELS.map(([label, key]) => (
                        <div key={key}>
                          <dt className="text-[0.85rem] text-muted">{label}</dt>
                          <dd className="font-bold tabular-nums">{review[key]} / 5</dd>
                        </div>
                      ))}
                    </dl>
                    {review.comment && <p className="mt-3">{review.comment}</p>}
                   </Card>
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
