'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import {
  ApiError,
  cancelTrip,
  completeTrip,
  getTrip,
  leaveTrip,
  listTripMembers,
  listTripRequests,
  requestToJoinTrip,
  respondToTripRequest,
  type TripDetail,
  type TripMember,
  type TripRequest,
} from '@/lib/api';
import { Travellers } from './travellers';
import { ErrorText, PrimaryButton } from '@/components/form-controls';

// Mirror the API's rules in apps/api/src/trips/trip-rules.ts, which are the
// authoritative ones — these only decide what to offer, never what's allowed.
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_APPROVED_MEMBERS_TO_COMPLETE = 2;

const PILL_LINK =
  'rounded-full border border-line px-4 py-2 text-sm text-foreground/70 hover:border-accent/50 hover:text-foreground';

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
  const [members, setMembers] = useState<TripMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Captured when the trip loads rather than read during render, so render
  // stays pure (react-hooks/purity). Only used to decide whether to offer
  // "mark complete"; the server enforces the end-date rule itself.
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const isHost = trip !== null && user !== null && trip.hostId === user.id;

  const load = useCallback(async () => {
    try {
      const t = await getTrip(tripId);
      setTrip(t);
      setLoadedAt(Date.now());
      if (t.hostId === user?.id) {
        setRequests(await listTripRequests(tripId));
      }
      // The travellers list is only for people on the trip (the API refuses anyone
      // else). It's a nicety, so a failure here must never break the page.
      if (t.hostId === user?.id || t.myMembership?.status === 'APPROVED') {
        try {
          setMembers(await listTripMembers(tripId));
        } catch {
          setMembers(null);
        }
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

  async function handleCancel() {
    setActionError(null);
    setBusy(true);
    try {
      await cancelTrip(tripId);
      setConfirmingCancel(false);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not cancel the trip.');
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    setActionError(null);
    setBusy(true);
    try {
      await completeTrip(tripId);
      setConfirmingComplete(false);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not mark the trip complete.');
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
  // The server lets anyone who held an approved membership review, including
  // people who later left, so the link isn't limited to current members.
  const canReview =
    trip.status === 'COMPLETED' &&
    (isApprovedMember || trip.myMembership?.status === 'LEFT');
  const canMarkComplete = isHost && (trip.status === 'OPEN' || trip.status === 'FULL' || trip.status === 'ONGOING');
  const isCancelled = trip.status === 'CANCELLED';
  // The server only allows editing and cancelling while the trip is OPEN or FULL.
  const canManage = isHost && (trip.status === 'OPEN' || trip.status === 'FULL');
  // endDate is the last day, inclusive: the trip is over once that whole UTC day has passed.
  const endOfLastDay = (Math.floor(new Date(trip.endDate).getTime() / DAY_MS) + 1) * DAY_MS;
  const hasEnded = loadedAt !== null && loadedAt >= endOfLastDay;
  const hasEnoughMembers = trip.approvedCount >= MIN_APPROVED_MEMBERS_TO_COMPLETE;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">{trip.status}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{trip.title}</h1>
          <p className="mt-1 text-foreground/70">{trip.destination}</p>
        </div>
        {(isApprovedMember || canReview) && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {isApprovedMember && (
              <>
                <Link href={`/trips/${trip.id}/expenses`} className={PILL_LINK}>
                  Expenses
                </Link>
                <Link href={`/trips/${trip.id}/chat`} className={PILL_LINK}>
                  Open chat
                </Link>
              </>
            )}
            {canReview && (
              <Link href={`/trips/${trip.id}/reviews`} className={PILL_LINK}>
                Reviews
              </Link>
            )}
            {canManage && (
              <Link href={`/trips/${trip.id}/edit`} className={PILL_LINK}>
                Edit trip
              </Link>
            )}
          </div>
        )}
      </div>

      {isCancelled && (
        <p className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          This trip was cancelled by the host.
          {trip.myMembership?.status === 'APPROVED' && ' Chat and expenses stay open so you can settle up.'}
        </p>
      )}

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
        {!isHost && !isCancelled && trip.myMembership?.status === 'APPROVED' && (
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

      {isApprovedMember && members !== null && user && (
        <Travellers tripId={trip.id} members={members} meId={user.id} onChanged={load} />
      )}

      {canMarkComplete && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-4">
          {!hasEnded ? (
            <p className="text-sm text-foreground/60">
              Once the trip&apos;s last day is over you can mark it complete, which opens reviews for everyone who
              went.
            </p>
          ) : !hasEnoughMembers ? (
            <p className="text-sm text-foreground/60">
              This trip has ended, but reviews are between travellers &mdash; it needs at least one other approved
              member before it can be marked complete.
            </p>
          ) : confirmingComplete ? (
            <div>
              <p className="text-sm text-foreground/80">
                Mark this trip complete? This can&apos;t be undone &mdash; reviews open for everyone who went.
              </p>
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={busy}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Yes, mark complete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingComplete(false)}
                  disabled={busy}
                  className="text-sm text-foreground/60 underline hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-foreground/70">This trip has ended. Mark it complete to open reviews.</p>
              <button
                type="button"
                onClick={() => setConfirmingComplete(true)}
                className="shrink-0 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-background hover:opacity-90"
              >
                Mark complete
              </button>
            </div>
          )}
        </div>
      )}

      {isHost && !isCancelled && (
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

      {canManage && (
        <div className="mt-12 border-t border-line pt-6">
          {confirmingCancel ? (
            <div>
              <p className="text-sm text-foreground/80">
                Cancel this trip? Pending requests are declined and everyone on the trip is notified. Chat and expenses
                stay open so you can settle up. This can&apos;t be undone.
              </p>
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={busy}
                  className="rounded-full border border-danger px-4 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  {busy ? 'Cancelling…' : 'Yes, cancel trip'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={busy}
                  className="text-sm text-foreground/60 underline hover:text-foreground"
                >
                  Keep trip
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="text-sm text-foreground/50 underline hover:text-danger"
            >
              Cancel this trip
            </button>
          )}
        </div>
      )}
    </main>
  );
}
