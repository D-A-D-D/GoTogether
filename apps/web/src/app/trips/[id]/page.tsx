'use client';

import { useState, type ReactNode } from 'react';
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
} from '@/lib/api';
import { invalidateQueries, queryCache, useQuery } from '@/lib/query';
import { formatBudget, formatDateRange, plural, tripDays } from '@/lib/format';
import { Travellers } from './travellers';
import { ErrorText } from '@/components/form-controls';
import { Button, Card, Chip, Skeleton, TripCover } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { IconCalendar, IconChat, IconEdit, IconShield, IconStar, IconUsers, IconWallet } from '@/components/icons';

// Mirror the API's rules in apps/api/src/trips/trip-rules.ts, which are the
// authoritative ones — these only decide what to offer, never what's allowed.
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_APPROVED_MEMBERS_TO_COMPLETE = 2;

const STATUS_CHIP: Record<string, { label: string; tone: 'plain' | 'accent' | 'gold' }> = {
  OPEN: { label: 'Open', tone: 'gold' },
  FULL: { label: 'Full', tone: 'plain' },
  ONGOING: { label: 'Under way', tone: 'accent' },
  COMPLETED: { label: 'Completed', tone: 'plain' },
  CANCELLED: { label: 'Cancelled', tone: 'plain' },
};

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.9rem] text-muted">{label}</p>
        <div className="font-semibold leading-snug">{children}</div>
      </div>
    </div>
  );
}

interface Tile {
  href: string;
  icon: ReactNode;
  label: string;
}

function ActionTile({ href, icon, label }: Tile) {
  return (
    <Link
      href={href}
      className="pressable flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-2 py-3 text-center text-[0.95rem] font-semibold shadow-card"
    >
      <span className="text-accent-ink">{icon}</span>
      {label}
    </Link>
  );
}

export default function TripDetailPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;
  const signedIn = authStatus === 'authenticated';

  const tripQuery = useQuery(`trip:${tripId}`, () => getTrip(tripId), { enabled: signedIn });
  const trip = tripQuery.data;

  const isHost = !!trip && !!user && trip.hostId === user.id;
  const isApprovedMember = isHost || trip?.myMembership?.status === 'APPROVED';

  // These depend on who the person is on this trip, so they wait for the trip - but they then run
  // side by side rather than one after another, and a failed travellers list never breaks the page.
  const requestsQuery = useQuery(`trip:${tripId}:requests`, () => listTripRequests(tripId), { enabled: signedIn && isHost });
  const membersQuery = useQuery(`trip:${tripId}:members`, () => listTripMembers(tripId), { enabled: signedIn && isApprovedMember });
  const requests = requestsQuery.data;
  const members = membersQuery.data;

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Fixed when the page opens, so render stays pure. Only decides whether to offer "mark complete";
  // the server enforces the end-date rule itself.
  const [openedAt] = useState(() => Date.now());

  /** Brings this trip's screens and the lists that show it up to date after a change. */
  async function reload() {
    invalidateQueries(`trip:${tripId}`, 'trips:mine', 'discover:');
    await Promise.all([tripQuery.refetch(), requestsQuery.refetch(), membersQuery.refetch()]);
  }

  async function run(action: () => Promise<unknown>, fallback: string, after?: () => void) {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      after?.();
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  /** Shows the request as sent the instant it is pressed, and takes it back if the server says no. */
  async function handleRequestToJoin() {
    if (!trip) return;
    const before = trip;
    queryCache.set<TripDetail>(`trip:${tripId}`, { ...trip, myMembership: { status: 'REQUESTED', role: 'MEMBER' } });
    setActionError(null);
    setBusy(true);
    try {
      await requestToJoinTrip(tripId);
      await reload();
    } catch (err) {
      queryCache.set<TripDetail>(`trip:${tripId}`, before);
      setActionError(err instanceof ApiError ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) return null;

  if (tripQuery.error && !trip) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <ErrorText>{tripQuery.error instanceof ApiError ? tripQuery.error.message : 'Could not load this trip.'}</ErrorText>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 pt-4" aria-busy="true" aria-label="Loading trip">
        <Skeleton className="aspect-[16/10] w-full !rounded-3xl" />
        <Skeleton className="mt-5 h-7 w-2/3" />
        <Skeleton className="mt-3 h-24 w-full !rounded-2xl" />
        <Skeleton className="mt-3 h-16 w-full !rounded-2xl" />
      </main>
    );
  }

  // The server lets anyone who held an approved membership review, including
  // people who later left, so the link isn't limited to current members.
  const canReview = trip.status === 'COMPLETED' && (isApprovedMember || trip.myMembership?.status === 'LEFT');
  const canMarkComplete = isHost && (trip.status === 'OPEN' || trip.status === 'FULL' || trip.status === 'ONGOING');
  const isCancelled = trip.status === 'CANCELLED';
  // The server only allows editing and cancelling while the trip is OPEN or FULL.
  const canManage = isHost && (trip.status === 'OPEN' || trip.status === 'FULL');
  // endDate is the last day, inclusive: the trip is over once that whole UTC day has passed.
  const endOfLastDay = (Math.floor(new Date(trip.endDate).getTime() / DAY_MS) + 1) * DAY_MS;
  const hasEnded = openedAt >= endOfLastDay;
  const hasEnoughMembers = trip.approvedCount >= MIN_APPROVED_MEMBERS_TO_COMPLETE;
  const status = STATUS_CHIP[trip.status] ?? { label: trip.status, tone: 'plain' as const };
  const seatsLeft = Math.max(0, trip.capacity - trip.approvedCount);
  const canRequest = !isHost && trip.myMembership === null && trip.status === 'OPEN';
  const tiles: Tile[] = [];
  if (isApprovedMember) {
    tiles.push({ href: `/trips/${trip.id}/chat`, icon: <IconChat size={28} />, label: 'Chat' });
    tiles.push({ href: `/trips/${trip.id}/expenses`, icon: <IconWallet size={28} />, label: 'Expenses' });
  }
  if (canReview) tiles.push({ href: `/trips/${trip.id}/reviews`, icon: <IconStar size={28} />, label: 'Reviews' });
  if (canManage) tiles.push({ href: `/trips/${trip.id}/edit`, icon: <IconEdit size={28} />, label: 'Edit trip' });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10 pt-4">
      <TripCover seed={trip.destination} photoUrl={trip.coverPhotoUrl} className="aspect-[16/10] rounded-3xl sm:aspect-[2/1]">
        <Chip tone={status.tone} className="absolute left-3 top-3 shadow">
          {status.label}
        </Chip>
        <div className="absolute inset-x-0 bottom-0 p-5">
          <p className="font-display text-3xl font-bold leading-tight drop-shadow sm:text-4xl">{trip.destination}</p>
          <p className="mt-1 font-medium text-white/90">
            {formatDateRange(trip.startDate, trip.endDate)} · {plural(tripDays(trip.startDate, trip.endDate), 'day')}
          </p>
        </div>
      </TripCover>

      <h1 className="mt-5 text-2xl font-bold leading-snug">{trip.title}</h1>

      {isCancelled && (
        <p className="mt-4 rounded-2xl border border-danger/40 bg-danger/10 p-4 font-medium text-danger">
          This trip was cancelled by the host.
          {trip.myMembership?.status === 'APPROVED' && ' Chat and expenses stay open so you can settle up.'}
        </p>
      )}

      {tiles.length > 0 && (
        <div className={`mt-5 grid gap-3 ${tiles.length >= 3 ? 'grid-cols-3' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {tiles.map((t) => (
            <ActionTile key={t.href} {...t} />
          ))}
        </div>
      )}

      {trip.description && <p className="mt-5 whitespace-pre-line text-[1.05rem] leading-relaxed">{trip.description}</p>}

      <Card className="mt-5 grid gap-5 p-5 sm:grid-cols-2">
        <Fact icon={<IconWallet size={22} />} label="Budget per person">
          {formatBudget(trip.budgetMin, trip.budgetMax)}
        </Fact>
        <Fact icon={<IconCalendar size={22} />} label="Dates">
          {trip.flexibleDates ? 'Flexible' : 'Fixed'}
          {trip.tripType ? ` · ${trip.tripType}` : ''}
        </Fact>
        <div className="sm:col-span-2">
          <Fact icon={<IconUsers size={22} />} label="Travellers">
            {trip.approvedCount} of {trip.capacity} places taken
            {trip.status === 'OPEN' && seatsLeft > 0 && <span className="font-medium text-muted"> · {plural(seatsLeft, 'place')} left</span>}
          </Fact>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-2" role="presentation">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (trip.approvedCount / trip.capacity) * 100)}%` }} />
          </div>
        </div>
      </Card>

      {trip.includeTags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {trip.includeTags.map((tag) => (
            <Chip key={tag.id}>{tag.name}</Chip>
          ))}
        </div>
      )}

      {isHost && trip.excludeTags && trip.excludeTags.length > 0 && (
        <div className="mt-4">
          <p className="text-[0.9rem] text-muted">Excluded (private — only you see this)</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {trip.excludeTags.map((tag) => (
              <Chip key={tag.id} className="!bg-transparent !text-accent-2 ring-1 ring-accent-2/50">
                {tag.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <Card className="mt-5 flex items-center gap-4 p-4">
        <UserAvatar user={trip.host} size={52} />
        <div className="min-w-0 flex-1">
          <p className="text-[0.9rem] text-muted">Hosted by</p>
          <p className="truncate text-lg font-semibold leading-tight">{trip.host.name}</p>
          {trip.host.homeCity && <p className="truncate text-[0.95rem] text-muted">{trip.host.homeCity}</p>}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 font-semibold" title="Trust score">
          <IconShield size={18} className="text-accent-ink" />
          {Math.round(trip.host.trustScore)}
        </span>
      </Card>

      <ErrorText>{actionError}</ErrorText>

      {/* The one thing most visitors came to do, kept within thumb reach above the tab bar. */}
      {canRequest && (
        <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-10 mt-6 md:bottom-4">
          <Button size="lg" block onClick={handleRequestToJoin} disabled={busy} className="shadow-card">
            Request to join
          </Button>
        </div>
      )}
      {!isHost && trip.myMembership?.status === 'REQUESTED' && (
        <Card className="mt-6 flex items-center justify-between gap-3 p-4">
          <span className="font-medium">Request sent — waiting for the host.</span>
          <Button variant="ghost" size="sm" onClick={() => run(() => leaveTrip(tripId), 'Could not do that.')} disabled={busy}>
            Withdraw
          </Button>
        </Card>
      )}
      {!isHost && !isCancelled && trip.myMembership?.status === 'APPROVED' && (
        <Card className="mt-6 flex items-center justify-between gap-3 p-4">
          <span className="font-semibold text-accent-ink">You&rsquo;re in. Have a great trip.</span>
          <Button variant="ghost" size="sm" onClick={() => run(() => leaveTrip(tripId), 'Could not do that.')} disabled={busy}>
            Leave trip
          </Button>
        </Card>
      )}

      {isApprovedMember && members && user && <Travellers tripId={trip.id} members={members} meId={user.id} isHost={trip.host.id === user.id} onChanged={reload} />}

      {canMarkComplete && (
        <Card className="mt-6 p-4">
          {!hasEnded ? (
            <p className="text-muted">
              Once the trip&apos;s last day is over you can mark it complete, which opens reviews for everyone who went.
            </p>
          ) : !hasEnoughMembers ? (
            <p className="text-muted">
              This trip has ended, but reviews are between travellers &mdash; it needs at least one other approved member
              before it can be marked complete.
            </p>
          ) : confirmingComplete ? (
            <div>
              <p>Mark this trip complete? This can&apos;t be undone &mdash; reviews open for everyone who went.</p>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  onClick={() => run(() => completeTrip(tripId), 'Could not mark the trip complete.', () => setConfirmingComplete(false))}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Yes, mark complete'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingComplete(false)} disabled={busy}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted">This trip has ended. Mark it complete to open reviews.</p>
              <Button onClick={() => setConfirmingComplete(true)} className="shrink-0">
                Mark complete
              </Button>
            </div>
          )}
        </Card>
      )}

      {isHost && !isCancelled && (
        <section className="mt-9" aria-labelledby="requests-heading">
          <h2 id="requests-heading" className="text-xl font-bold">
            Join requests
            {requests && requests.length > 0 && <span className="ml-2 text-base font-medium text-muted">{requests.length}</span>}
          </h2>
          {requests && requests.length === 0 && <p className="mt-2 text-muted">No pending requests.</p>}
          <ul className="mt-3 flex flex-col gap-3">
            {requests?.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                  <UserAvatar user={r.user} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.user.name}</p>
                    <p className="text-[0.9rem] text-muted">
                      Trust {Math.round(r.user.trustScore)} · {r.user.homeCity ?? 'no city set'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => respondToTripRequest(tripId, r.id, 'REJECTED'), 'Could not respond to that request.')}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => respondToTripRequest(tripId, r.id, 'APPROVED'), 'Could not respond to that request.')}
                    >
                      Approve
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage && (
        <div className="mt-12 border-t border-line pt-6">
          {confirmingCancel ? (
            <div>
              <p>
                Cancel this trip? Pending requests are declined and everyone on the trip is notified. Chat and expenses
                stay open so you can settle up. This can&apos;t be undone.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant="danger"
                  onClick={() => run(() => cancelTrip(tripId), 'Could not cancel the trip.', () => setConfirmingCancel(false))}
                  disabled={busy}
                >
                  {busy ? 'Cancelling…' : 'Yes, cancel trip'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={busy}>
                  Keep trip
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmingCancel(true)} className="!text-danger">
              Cancel this trip
            </Button>
          )}
        </div>
      )}
    </main>
  );
}
