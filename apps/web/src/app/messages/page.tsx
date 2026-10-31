'use client';

import Link from 'next/link';
import { useRequireAuth } from '@/lib/use-require-auth';
import { listDirectThreads, listMyTrips, type DirectSummary } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { usePoll } from '@/lib/use-poll';
import { ErrorText } from '@/components/form-controls';
import { Card, EmptyState, Skeleton, TripCover } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { IconChevronRight } from '@/components/icons';

/** "14:05" for today, "3 Nov" for anything older: enough to tell chats apart at a glance. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function previewOf(t: DirectSummary): string {
  if (t.view === 'REQUEST_IN') return 'Wants to message you';
  if (t.view === 'CLOSED') return 'Closed - you can ask again once you are on a trip together';
  const text = t.last?.content ?? '';
  return t.view === 'REQUEST_OUT' ? `Waiting for a reply · ${text}` : text;
}

function ThreadRow({ thread }: { thread: DirectSummary }) {
  return (
    <li>
      <Link href={`/messages/${thread.id}`} className="pressable flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
        <UserAvatar user={thread.other} size={48} />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-2">
            <span className={`truncate leading-tight ${thread.unread ? 'font-bold' : 'font-semibold'}`}>{thread.other.name}</span>
            <span className="shrink-0 text-[0.8rem] text-muted">{shortTime(thread.lastMessageAt)}</span>
          </p>
          <p className={`mt-0.5 truncate text-[0.95rem] ${thread.unread ? 'font-semibold text-foreground' : 'text-muted'}`}>{previewOf(thread)}</p>
        </div>
        {thread.unread && (
          <>
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-accent" />
            <span className="sr-only">Needs your attention</span>
          </>
        )}
      </Link>
    </li>
  );
}

export default function MessagesPage() {
  const status = useRequireAuth();
  const authed = status === 'authenticated';
  const threads = useQuery('direct:threads', listDirectThreads, { enabled: authed, staleMs: 10_000 });
  const trips = useQuery('trips:mine', listMyTrips, { enabled: authed });
  usePoll(() => void threads.refetch(), 20_000, authed);

  if (!authed) return null;

  const groups = (trips.data ?? []).filter((m) => m.status === 'APPROVED' && m.trip.status !== 'CANCELLED');
  const requests = (threads.data ?? []).filter((t) => t.view === 'REQUEST_IN');
  const chats = (threads.data ?? []).filter((t) => t.view !== 'REQUEST_IN');

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-4 md:pb-10">
      <h1 className="sr-only">Messages</h1>
      <ErrorText>{threads.error && !threads.data ? 'Could not load your private chats.' : null}</ErrorText>

      {requests.length > 0 && (
        <section aria-labelledby="requests-heading" className="mb-8">
          <h2 id="requests-heading" className="text-xl font-bold">
            Requests
            <span className="ml-2 text-base font-medium text-muted">{requests.length}</span>
          </h2>
          <p className="mt-1 text-[0.95rem] text-muted">People on your trips who would like to message you privately. Nothing is shared until you accept.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {requests.map((t) => (
              <ThreadRow key={t.id} thread={t} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="groups-heading">
        <h2 id="groups-heading" className="text-xl font-bold">
          Trip groups
        </h2>
        {trips.isLoading ? (
          <Skeleton className="mt-3 h-20 w-full !rounded-2xl" />
        ) : groups.length === 0 ? (
          <Card className="mt-3 p-4 text-muted">Once you are approved on a trip, its group chat appears here.</Card>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {groups.map((m) => (
              <li key={m.id}>
                <Link href={`/trips/${m.trip.id}/chat`} className="pressable flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
                  <TripCover seed={m.trip.destination} photoUrl={m.trip.coverPhotoUrl} className="h-12 w-12 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">{m.trip.title}</p>
                    <p className="truncate text-[0.95rem] text-muted">{m.trip.destination}</p>
                  </div>
                  <IconChevronRight size={20} className="shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="private-heading" className="mt-8">
        <h2 id="private-heading" className="text-xl font-bold">
          Private chats
        </h2>
        {threads.isLoading ? (
          <Skeleton className="mt-3 h-20 w-full !rounded-2xl" />
        ) : chats.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No private chats yet">
              Open a trip you are on, and tap Message beside someone in Travellers. They get one message to start with, and can accept to chat.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {chats.map((t) => (
              <ThreadRow key={t.id} thread={t} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
