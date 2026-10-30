'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listTrustEvents, type TrustEvent } from '@/lib/api';
import { ErrorText } from '@/components/form-controls';

const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return '0';
}

/** The audit trail behind the trust score — every change, newest first. */
export function TrustHistory() {
  const [events, setEvents] = useState<TrustEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTrustEvents()
      .then(setEvents)
      .catch(() => setError('Could not load your trust history.'));
  }, []);

  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold">Trust score history</h2>
      <p className="mt-1 text-[0.95rem] text-muted">
        Your score moves only when a review about you comes in. Every change is listed here.
      </p>

      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
        {!error && events === null && <p className="text-[0.95rem] text-muted">Loading…</p>}
        {events !== null && events.length === 0 && (
          <p className="text-[0.95rem] text-muted">
            No changes yet. Your score starts at 50 and moves as reviews from your trips come in.
          </p>
        )}
        {events !== null && events.length > 0 && (
          <ul className="flex flex-col gap-2">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface shadow-card px-4 py-3 text-[0.95rem]"
              >
                <div>
                  <p>
                    {event.tripId ? (
                      <>
                        Review received
                        {event.tripTitle && (
                          <>
                            {' '}
                            on <span className="text-foreground/80">{event.tripTitle}</span>
                          </>
                        )}
                      </>
                    ) : (
                      event.reason
                    )}
                  </p>
                  <p className="mt-0.5 text-[0.85rem] text-muted">
                    {dateFormat.format(new Date(event.createdAt))}
                    {event.tripId && event.tripTitle && (
                      <>
                        {' '}
                        &middot;{' '}
                        <Link href={`/trips/${event.tripId}`} className="underline hover:text-foreground">
                          View trip
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`font-mono font-semibold ${
                      event.delta > 0 ? 'text-accent-ink' : event.delta < 0 ? 'text-danger' : 'text-muted'
                    }`}
                  >
                    {formatDelta(event.delta)}
                  </span>
                  <span className="ml-2 text-muted">
                    &rarr; <span className="tabular-nums">{event.resultingScore}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
