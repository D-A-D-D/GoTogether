'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import {
  ApiError,
  getTrip,
  leaveTrip,
  listTripRequests,
  requestToJoinTrip,
  respondToTripRequest,
  type TripDetail,
  type TripRequest,
} from '@/lib/api';
import { ErrorText, PrimaryButton } from '@/components/form-controls';

function formatDateRange(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${fmt.format(new Date(startIso))} – ${fmt.format(new Date(endIso))}`;
}

export default function TripDetailPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [requests, setRequests] = useState<TripRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isHost = trip !== null && user !== null && trip.hostId === user.id;

  const load = useCallback(async () => {
    try {
      const t = await getTrip(tripId);
      setTrip(t);
      if (t.hostId === user?.id) {
        setRequests(await listTripRequests(tripId));
      }
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load this trip.');
    }
  }, [tripId, user]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    // Deferred a microtask so setState inside load() never happens
    // synchronously within the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [authStatus, load]);

  async function handleRequestToJoin() {
    setActionError(null);
    setBusy(true);
    try {
      await requestToJoinTrip(tripId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    setActionError(null);
    setBusy(true);
    try {
      await leaveTrip(tripId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not do that.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRespond(membershipId: string, decision: 'APPROVED' | 'REJECTED') {
    setActionError(null);
    setBusy(true);
    try {
      await respondToTripRequest(tripId, membershipId, decision);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not respond to that request.');
    } finally {
      setBusy(false);
    }
  }

  if (authStatus !== 'authenticated') return null;

  if (loadError) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <ErrorText>{loadError}</ErrorText>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-foreground/60">Loading trip…</p>
      </main>
    );
  }

  const isApprovedMember = isHost || trip.myMembership?.status === 'APPROVED';

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">{trip.status}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{trip.title}</h1>
          <p className="mt-1 text-foreground/70">{trip.destination}</p>
        </div>
        {isApprovedMember && (
          <div className="flex shrink-0 gap-2">
            <Link
              href={`/trips/${trip.id}/expenses`}
              className="rounded-full border border-line px-4 py-2 text-sm text-foreground/70 hover:border-accent/50 hover:text-foreground"
            >
              Expenses
            </Link>
            <Link
              href={`/trips/${trip.id}/chat`}
              className="rounded-full border border-line px-4 py-2 text-sm text-foreground/70 hover:border-accent/50 hover:text-foreground"
            >
              Open chat
            </Link>
          </div>
        )}
      </div>

      {trip.description && <p className="mt-4 text-sm text-foreground/70">{trip.description}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <div className="text-foreground/50">Dates</div>
          <div>{formatDateRange(trip.startDate, trip.endDate)}</div>
        </div>
        <div>
          <div className="text-foreground/50">Budget</div>
          <div>
            {trip.budgetMin}&ndash;{trip.budgetMax}
          </div>
        </div>
        <div>
          <div className="text-foreground/50">Members</div>
          <div>
            {trip.approvedCount}/{trip.capacity}
          </div>
        </div>
        <div>
          <div className="text-foreground/50">Host</div>
          <div>{trip.host.name}</div>
        </div>
        {trip.tripType && (
          <div>
            <div className="text-foreground/50">Trip type</div>
            <div>{trip.tripType}</div>
          </div>
        )}
      </div>

      {trip.includeTags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {trip.includeTags.map((tag) => (
            <span key={tag.id} className="rounded-full border border-line px-2.5 py-1 text-xs text-foreground/70">
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {isHost && trip.excludeTags && trip.excludeTags.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-foreground/50">Excluded (private — only you see this)</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {trip.excludeTags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full border border-accent-2/40 px-2.5 py-1 text-xs text-accent-2"
              >
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <ErrorText>{actionError}</ErrorText>

      <div className="mt-6">
        {!isHost && trip.myMembership === null && trip.status === 'OPEN' && (
          <PrimaryButton type="button" onClick={handleRequestToJoin} disabled={busy} className="w-fit px-6">
            Request to join
          </PrimaryButton>
        )}
        {!isHost && trip.myMembership?.status === 'REQUESTED' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-foreground/60">Your request is pending.</span>
            <button
              type="button"
              onClick={handleLeave}
              disabled={busy}
              className="text-sm text-foreground/60 underline hover:text-foreground"
            >
              Withdraw
            </button>
          </div>
        )}
        {!isHost && trip.myMembership?.status === 'APPROVED' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-accent">You&rsquo;re in.</span>
            <button
              type="button"
              onClick={handleLeave}
              disabled={busy}
              className="text-sm text-foreground/60 underline hover:text-foreground"
            >
              Leave trip
            </button>
          </div>
        )}
      </div>

      {isHost && (
        <div className="mt-10">
          <h2 className="text-lg font-medium">Join requests</h2>
          {requests !== null && requests.length === 0 && (
            <p className="mt-2 text-sm text-foreground/60">No pending requests.</p>
          )}
          <div className="mt-3 flex flex-col gap-3">
            {requests?.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-xl border border-line bg-surface p-4"
              >
                <div>
                  <div className="font-medium">{r.user.name}</div>
                  <div className="text-xs text-foreground/50">
                    Trust {r.user.trustScore} &middot; {r.user.homeCity ?? 'no city set'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRespond(r.id, 'REJECTED')}
                    className="rounded-full border border-line px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRespond(r.id, 'APPROVED')}
                    className="rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
