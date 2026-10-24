'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { API_URL, getAccessToken, listMessages, type ChatMessage } from '@/lib/api';
import { ErrorText, TextInput, PrimaryButton } from '@/components/form-controls';

type RoomStatus = 'connecting' | 'joined' | 'denied' | 'disconnected';

// Passed explicitly: "a full page came back" is how we know there may be older messages.
const HISTORY_PAGE_SIZE = 50;

// Within this many pixels of the bottom counts as "reading the latest".
const NEAR_BOTTOM_PX = 120;

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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('connecting');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Whether the reader is at the latest messages. Only then does a new message scroll the list.
  const nearBottom = useRef(true);
  // Set just before older messages are prepended, so the scroll position can be kept where it was.
  const prependAnchor = useRef<{ scrollHeight: number } | null>(null);
  const lastMessageId = useRef<string | null>(null);
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
      } catch {
        if (!cancelled) setHistoryError('Could not load message history.');
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

    socket.on('disconnect', () => {
      if (!cancelled) setRoomStatus('disconnected');
    });

    socket.on('message', (message: ChatMessage) => {
      if (cancelled) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    });

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [authStatus, tripId]);

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
      }
    }
    lastMessageId.current = last?.id ?? null;
  }, [messages, userId]);

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
    if (list) nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
  }

  function handleSend(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !socketRef.current) return;
    setSendError(null);
    setDraft('');
    socketRef.current.emit(
      'sendMessage',
      { tripId, content },
      (ack: { ok: boolean; error?: string }) => {
        if (!ack.ok) setSendError(ack.error ?? 'Message failed to send.');
      },
    );
  }

  if (authStatus !== 'authenticated') return null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Trip chat</h1>

      {roomStatus === 'denied' && (
        <div className="mt-8">
          <ErrorText>{roomError}</ErrorText>
        </div>
      )}

      {roomStatus !== 'denied' && (
        <>
          {/* Capped so the list scrolls on its own — otherwise the whole page does, and the
              scroll position can't be kept when older messages are loaded above. */}
          <div
            ref={listRef}
            onScroll={handleListScroll}
            className="mt-4 max-h-[65vh] min-h-[40vh] flex-1 overflow-y-auto rounded-xl border border-line bg-surface p-4"
          >
            {hasMoreHistory && (
              <div className="mb-3 text-center">
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  disabled={loadingOlder}
                  className="rounded-full border border-line px-4 py-1.5 text-xs text-foreground/70 hover:border-accent/50 hover:text-foreground disabled:opacity-50"
                >
                  {loadingOlder ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}
            {historyError && <ErrorText>{historyError}</ErrorText>}
            {roomStatus === 'connecting' && messages.length === 0 && (
              <p className="text-sm text-foreground/50">Connecting…</p>
            )}
            <div className="flex flex-col gap-3">
              {messages.map((m) => {
                const mine = m.senderId === user?.id;
                return (
                  <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    <span className="text-xs text-foreground/40">
                      {mine ? 'You' : m.sender.name} &middot; {formatTime(m.createdAt)}
                    </span>
                    <div
                      className={`mt-0.5 max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                        mine ? 'bg-accent text-background' : 'bg-background text-foreground'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })}
            </div>
            <div ref={bottomRef} />
          </div>

          <ErrorText>{sendError}</ErrorText>
          {roomStatus === 'disconnected' && (
            <p className="mt-2 text-xs text-foreground/50">Reconnecting…</p>
          )}

          <form onSubmit={handleSend} className="mt-3 flex gap-2">
            <TextInput
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message the group"
              maxLength={4000}
              disabled={roomStatus !== 'joined'}
              className="flex-1"
            />
            <PrimaryButton type="submit" disabled={roomStatus !== 'joined' || !draft.trim()} className="w-auto px-5">
              Send
            </PrimaryButton>
          </form>
        </>
      )}
    </main>
  );
}
