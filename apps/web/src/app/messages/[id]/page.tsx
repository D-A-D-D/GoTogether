'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, getDirectMessages, respondDirect, sendDirect } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { invalidateQueries, useQuery } from '@/lib/query';
import { usePoll } from '@/lib/use-poll';
import { ErrorText } from '@/components/form-controls';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { IconSend } from '@/components/icons';

const MAX_LENGTH = 2000;

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export default function PrivateChatPage() {
  const status = useRequireAuth();
  const authed = status === 'authenticated';
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const threadId = params.id;

  const chat = useQuery(`direct:thread:${threadId}`, () => getDirectMessages(threadId), { enabled: authed, staleMs: 3_000 });
  usePoll(() => void chat.refetch(), 5_000, authed);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const count = chat.data?.messages.length ?? 0;
  // Opening a chat reads it on the server: bring the Messages dot and list up to date.
  useEffect(() => {
    if (count > 0) invalidateQueries('direct:attention', 'direct:threads');
  }, [count]);

  // New messages scroll into view - unless the person has scrolled up to read something older.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [count]);

  if (!authed) return null;

  const thread = chat.data?.thread;
  const messages = chat.data?.messages ?? [];

  if (chat.error && !chat.data) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6">
        <EmptyState title="This chat is not available" action={<Button onClick={() => router.push('/messages')}>Back to Messages</Button>}>
          It may have been closed, or the person may no longer be reachable.
        </EmptyState>
      </main>
    );
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);
    try {
      await sendDirect(threadId, text);
      setDraft('');
      stickToBottom.current = true;
      await chat.refetch();
      invalidateQueries('direct:threads');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that - try again.');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  }

  async function handleRespond(decision: 'ACCEPT' | 'DECLINE') {
    setError(null);
    setSending(true);
    try {
      await respondDirect(threadId, decision);
      invalidateQueries('direct:attention', 'direct:threads');
      if (decision === 'DECLINE') router.push('/messages');
      else await chat.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not do that - try again.');
    } finally {
      setSending(false);
    }
  }

  const name = thread?.other.name ?? '';

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] w-full max-w-2xl flex-col">
      <h1 className="sr-only">{name ? `Private chat with ${name}` : 'Private chat'}</h1>
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        {thread ? <UserAvatar user={thread.other} size={40} /> : <Skeleton className="h-10 w-10 !rounded-full" />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{name || ' '}</p>
          <p className="truncate text-[0.9rem] text-muted">Private chat · only the two of you</p>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="h-full overflow-y-auto overscroll-contain px-3 py-4"
          aria-live="polite"
          aria-label="Messages"
        >
          {chat.isLoading && <Skeleton className="h-16 w-2/3 !rounded-2xl" />}
          <ul className="flex flex-col gap-1.5">
            {messages.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${mine ? 'rounded-br-md bg-accent text-on-accent' : 'rounded-bl-md bg-surface-2'}`}>
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    <p className={`mt-0.5 text-right text-[0.75rem] ${mine ? 'text-on-accent/80' : 'text-muted'}`}>{clock(m.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="pb-safe border-t border-line bg-surface">
        {thread?.view === 'REQUEST_IN' && (
          <div className="flex flex-col gap-3 px-4 py-4">
            <p>
              {name} would like to message you privately. They can&apos;t send you anything more until you accept, and they aren&apos;t told if you decline.
              You can still block them from the trip&apos;s Travellers list.
            </p>
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-3">
              <Button onClick={() => void handleRespond('ACCEPT')} disabled={sending}>
                Accept
              </Button>
              <Button variant="secondary" onClick={() => void handleRespond('DECLINE')} disabled={sending}>
                Decline
              </Button>
            </div>
          </div>
        )}

        {thread?.view === 'REQUEST_OUT' && (
          <p className="px-4 py-4 text-muted">Waiting for {name} to accept. You can send more once they do.</p>
        )}

        {thread?.view === 'CLOSED' && (
          <p className="px-4 py-4 text-muted">
            This private chat is closed. You can ask again once you are on a trip together, and {name} accepts.{' '}
            <Link href="/messages" className="font-semibold text-accent-ink underline underline-offset-4">
              Back to Messages
            </Link>
          </p>
        )}

        {thread?.view === 'ACCEPTED' && (
          <form onSubmit={handleSend} className="flex items-end gap-2 px-2 py-2.5">
            <label htmlFor="direct-message" className="sr-only">
              Message {name}
            </label>
            <textarea
              id="direct-message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={MAX_LENGTH}
              placeholder={`Message ${name}`}
              enterKeyHint="send"
              className="field-sizing-content max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-3xl border border-field bg-background px-4 py-3 text-base leading-snug text-foreground outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length === 0}
              aria-label="Send message"
              className="pressable btn-shadow flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-50 disabled:shadow-none"
            >
              <IconSend size={22} />
            </button>
          </form>
        )}
        {thread?.view === 'ACCEPTED' && error && <p role="alert" className="px-4 pb-2 text-[0.95rem] font-medium text-danger">{error}</p>}
      </div>
    </main>
  );
}
