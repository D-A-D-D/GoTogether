'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { API_URL, getAccessToken, getTrip, listMessages, type ChatMessage } from '@/lib/api';
import { layoutChat } from '@/lib/chat-layout';
import { plural } from '@/lib/format';
import { useQuery } from '@/lib/query';
import { Avatar, ButtonLink, Skeleton, TripCover } from '@/components/ui';
import { IconArrowDown, IconSend } from '@/components/icons';

type RoomStatus = 'connecting' | 'joined' | 'denied' | 'disconnected';

// Passed explicitly: "a full page came back" is how we know there may be older messages.
const HISTORY_PAGE_SIZE = 50;

// Within this many pixels of the bottom counts as "reading the latest".
const NEAR_BOTTOM_PX = 120;

// The tallest the message box grows before it scrolls inside itself (about five lines).
const COMPOSER_MAX_PX = 140;

/** A message the person has sent that the server hasn't confirmed yet, or that failed. */
interface Outgoing {
  localId: string;
  content: string;
  createdAt: string;
  failed: boolean;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/**
 * Merges two lists of messages, oldest first, one entry per id. Used for the
 * first history page (which must not wipe out a live message that arrived
 * before it did) and for each older page prepended later. Ordered by time and
 * then id — the same total order the server pages in.
 */
function mergeMessages(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...a, ...b]) byId.set(message.id, message);
  return [...byId.values()].sort((x, y) =>
    x.createdAt === y.createdAt ? (x.id < y.id ? -1 : 1) : x.createdAt < y.createdAt ? -1 : 1,
  );
}

export default function TripChatPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  // Usually already cached from the trip page the person just came from.
  const { data: trip } = useQuery(`trip:${tripId}`, () => getTrip(tripId), { enabled: authStatus === 'authenticated' });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // False until the first page of history has come back: until then "no messages" would be a guess.
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('connecting');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [away, setAway] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  // Whether the reader is at the latest messages. Only then does a new message scroll the list.
  const nearBottom = useRef(true);
  // Set just before older messages are prepended, so the scroll position can be kept where it was.
  const prependAnchor = useRef<{ scrollHeight: number } | null>(null);
  const lastMessageId = useRef<string | null>(null);
  const localCounter = useRef(0);
  const userId = user?.id;

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const history = await listMessages(tripId, undefined, HISTORY_PAGE_SIZE);
        if (cancelled) return;
        // Merged, not assigned: a live message may have arrived first.
        setMessages((prev) => mergeMessages(history, prev));
        setHasMoreHistory(history.length >= HISTORY_PAGE_SIZE);
        setHistoryLoaded(true);
      } catch {
        if (!cancelled) {
          setHistoryError('Could not load message history.');
          setHistoryLoaded(true);
        }
      }
    });

    const socket = io(`${API_URL}/chat`, {
      auth: { token: getAccessToken() },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinRoom', { tripId }, (ack: { ok: boolean; error?: string }) => {
        if (cancelled) return;
        if (ack.ok) {
          setRoomStatus('joined');
        } else {
          setRoomStatus('denied');
          setRoomError(ack.error ?? "You can't access this chat.");
        }
      });
    });

    // The server refuses the connection itself (bad/expired token, suspended account).
    socket.on('connect_error', () => {
      if (!cancelled) setRoomStatus('disconnected');
    });

    socket.on('disconnect', () => {
      if (!cancelled) setRoomStatus('disconnected');
    });

    socket.on('message', (message: ChatMessage) => {
      if (cancelled) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      // The server has it now: the grey "sending" copy of the same text can go.
      if (message.senderId === userId) {
        setOutgoing((prev) => {
          const at = prev.findIndex((o) => !o.failed && o.content === message.content);
          return at === -1 ? prev : prev.filter((_, i) => i !== at);
        });
      }
    });

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [authStatus, tripId, userId]);

  // Runs before paint, so older messages appearing above never cause a visible jump.
  useLayoutEffect(() => {
    const list = listRef.current;
    const last = messages[messages.length - 1];
    if (prependAnchor.current && list) {
      // Older messages were added above: keep the reader looking at what they were reading.
      list.scrollTop += list.scrollHeight - prependAnchor.current.scrollHeight;
      prependAnchor.current = null;
    } else if (last && last.id !== lastMessageId.current) {
      // A message was added at the bottom. Follow it if this is the first load, the reader is
      // already at the bottom, or it's their own — but don't yank someone who's reading history.
      const firstLoad = lastMessageId.current === null;
      if (firstLoad || nearBottom.current || last.senderId === userId) {
        bottomRef.current?.scrollIntoView({ block: 'end' });
        setUnseen(0);
      } else {
        setUnseen((n) => n + 1);
      }
    }
    lastMessageId.current = last?.id ?? null;
  }, [messages, userId]);

  // Something the person just sent appears at the bottom at once, and they are taken to it.
  useLayoutEffect(() => {
    if (outgoing.length > 0) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [outgoing.length]);

  async function handleLoadOlder() {
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    setHistoryError(null);
    try {
      const older = await listMessages(tripId, oldest.id, HISTORY_PAGE_SIZE);
      if (older.length > 0) {
        prependAnchor.current = { scrollHeight: listRef.current?.scrollHeight ?? 0 };
        setMessages((prev) => mergeMessages(older, prev));
      }
      setHasMoreHistory(older.length >= HISTORY_PAGE_SIZE);
    } catch {
      setHistoryError('Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }

  function handleListScroll() {
    const list = listRef.current;
    if (!list) return;
    const gap = list.scrollHeight - list.scrollTop - list.clientHeight;
    nearBottom.current = gap < NEAR_BOTTOM_PX;
    setAway(gap > NEAR_BOTTOM_PX * 2);
    if (nearBottom.current) setUnseen(0);
  }

  function jumpToLatest() {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    setUnseen(0);
  }

  function resizeBox() {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, COMPOSER_MAX_PX)}px`;
  }

  function transmit(content: string, localId: string) {
    const socket = socketRef.current;
    if (!socket) {
      setOutgoing((prev) => prev.map((o) => (o.localId === localId ? { ...o, failed: true } : o)));
      return;
    }
    socket.emit('sendMessage', { tripId, content }, (ack: { ok: boolean; error?: string }) => {
      if (ack.ok) {
        // If the live copy never turns up (a dropped connection), do not leave a grey ghost behind.
        setTimeout(() => setOutgoing((prev) => prev.filter((o) => o.localId !== localId)), 8000);
      } else {
        setOutgoing((prev) => prev.map((o) => (o.localId === localId ? { ...o, failed: true } : o)));
      }
    });
  }

  function send() {
    const content = draft.trim();
    if (!content || roomStatus !== 'joined') return;
    const localId = `local-${++localCounter.current}`;
    setOutgoing((prev) => [...prev, { localId, content, createdAt: new Date().toISOString(), failed: false }]);
    setDraft('');
    requestAnimationFrame(resizeBox);
    transmit(content, localId);
  }

  function retry(o: Outgoing) {
    setOutgoing((prev) => prev.map((x) => (x.localId === o.localId ? { ...x, failed: false } : x)));
    transmit(o.content, o.localId);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send();
    boxRef.current?.focus();
  }

  // On a computer, Enter sends and Shift+Enter starts a new line. On a phone, Enter is a new line
  // and the Send button sends - the way every messaging app there behaves.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !window.matchMedia('(pointer: coarse)').matches) {
      event.preventDefault();
      send();
    }
  }

  const items = useMemo(() => layoutChat(messages), [messages]);

  if (authStatus !== 'authenticated') return null;

  const canSend = roomStatus === 'joined' && draft.trim().length > 0;

  if (roomStatus === 'denied') {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <h2 className="text-xl font-bold">You can&apos;t open this chat</h2>
        <p role="alert" className="max-w-sm text-muted">
          {roomError}
        </p>
        <ButtonLink href={`/trips/${tripId}`} variant="secondary">
          Back to the trip
        </ButtonLink>
      </main>
    );
  }

  return (
    // The whole screen minus the top bar: the message list takes the middle and scrolls on its own,
    // while the message box stays pinned at the bottom whatever the keyboard does.
    <main className="mx-auto flex h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] w-full max-w-2xl flex-col">
      <h1 className="sr-only">{trip?.title ? `Chat: ${trip.title}` : 'Trip chat'}</h1>
      <Link
        href={`/trips/${tripId}`}
        className="pressable flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5"
        aria-label="Open trip details"
      >
        <TripCover seed={trip?.destination ?? tripId} photoUrl={trip?.coverPhotoUrl} className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{trip?.title ?? 'Trip chat'}</p>
          <p className="truncate text-[0.9rem] text-muted">
            {trip ? `${trip.destination} · ${plural(trip.approvedCount, 'traveller')}` : ' '}
          </p>
        </div>
      </Link>

      <div className="relative flex-1 overflow-hidden">
        <div ref={listRef} onScroll={handleListScroll} className="h-full overflow-y-auto overscroll-contain px-3 py-4" aria-live="polite" aria-label="Messages">
          {hasMoreHistory && (
            <div className="mb-3 text-center">
              <button
                type="button"
                onClick={handleLoadOlder}
                disabled={loadingOlder}
                className="pressable rounded-full bg-surface-2 px-4 py-2 text-[0.9rem] font-semibold disabled:opacity-60"
              >
                {loadingOlder ? 'Loading…' : 'Earlier messages'}
              </button>
            </div>
          )}
          {historyError && (
            <p role="alert" className="mb-3 text-center text-[0.95rem] font-medium text-danger">
              {historyError}
            </p>
          )}

          {!historyLoaded && messages.length === 0 && (
            <div className="flex flex-col gap-3" aria-hidden="true">
              <Skeleton className="h-11 w-2/3 !rounded-3xl" />
              <Skeleton className="h-11 w-1/2 !rounded-3xl" />
              <Skeleton className="ml-auto h-11 w-3/5 !rounded-3xl" />
              <Skeleton className="h-11 w-2/5 !rounded-3xl" />
            </div>
          )}

          {historyLoaded && messages.length === 0 && outgoing.length === 0 && !historyError && (
            <p className="mx-auto mt-16 max-w-xs text-center text-muted">No messages yet. Say hello to your fellow travellers.</p>
          )}

          <div className="flex flex-col">
            {items.map((item) => {
              if (item.kind === 'day') {
                return (
                  <div key={item.key} className="my-3 flex justify-center">
                    <span className="rounded-full bg-surface-2 px-3 py-1 text-[0.85rem] font-semibold text-muted">{item.label}</span>
                  </div>
                );
              }
              const { message: m, first, last } = item;
              const mine = m.senderId === userId;
              return (
                <div key={item.key} className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-2.5' : 'mt-0.5'}`}>
                  {!mine && <div className="w-8 shrink-0">{last && <Avatar name={m.sender.name} size={32} />}</div>}
                  <div className={`flex max-w-[78%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    {!mine && first && <span className="mb-0.5 ml-3 text-[0.85rem] font-semibold text-muted">{m.sender.name}</span>}
                    <div
                      className={`whitespace-pre-wrap break-words px-4 py-2.5 text-base leading-snug ${
                        mine ? 'bg-accent text-on-accent' : 'bg-surface-2 text-foreground'
                      } ${
                        mine
                          ? `rounded-3xl ${last ? 'rounded-br-md' : ''} ${first ? '' : 'rounded-tr-lg'}`
                          : `rounded-3xl ${last ? 'rounded-bl-md' : ''} ${first ? '' : 'rounded-tl-lg'}`
                      }`}
                    >
                      {m.content}
                    </div>
                    {last && <span className="mx-3 mt-0.5 text-[0.8rem] text-muted">{formatTime(m.createdAt)}</span>}
                  </div>
                </div>
              );
            })}

            {outgoing.map((o) => (
              <div key={o.localId} className="mt-0.5 flex justify-end">
                <div className="flex max-w-[78%] flex-col items-end">
                  <div className={`whitespace-pre-wrap break-words rounded-3xl bg-accent px-4 py-2.5 text-base leading-snug text-on-accent ${o.failed ? 'opacity-60 ring-2 ring-danger' : 'opacity-70'}`}>
                    {o.content}
                  </div>
                  {o.failed ? (
                    <button type="button" onClick={() => retry(o)} className="mx-3 mt-1 text-[0.9rem] font-semibold text-danger underline">
                      Not sent. Tap to try again
                    </button>
                  ) : (
                    <span className="mx-3 mt-0.5 text-[0.8rem] text-muted">Sending…</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div ref={bottomRef} />
        </div>

        {(away || unseen > 0) && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="pop-in pressable absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-forest px-4 py-2.5 text-[0.95rem] font-semibold text-[#F2E6D6] shadow-card ring-1 ring-white/20"
          >
            <IconArrowDown size={18} />
            {unseen > 0 ? `${unseen} new` : 'Latest'}
          </button>
        )}
      </div>

      {roomStatus !== 'joined' && (
        <p role="status" className="bg-gold px-4 py-1.5 text-center text-[0.9rem] font-semibold text-[#10312F]">
          {roomStatus === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…'}
        </p>
      )}

      <form onSubmit={handleSubmit} className="pb-safe flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5">
        <label htmlFor="chat-message" className="sr-only">
          Message the group
        </label>
        <textarea
          id="chat-message"
          ref={boxRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            resizeBox();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={4000}
          placeholder="Message the group"
          enterKeyHint="send"
          className="min-h-12 flex-1 resize-none rounded-3xl border border-field bg-background px-5 py-3 text-base leading-snug text-foreground outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition disabled:bg-surface-2 disabled:text-muted"
        >
          <IconSend size={22} />
        </button>
      </form>
    </main>
  );
}
