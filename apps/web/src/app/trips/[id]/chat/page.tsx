'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import {
  API_URL,
  ApiError,
  getAccessToken,
  getReadStates,
  getTrip,
  listMessages,
  listTripMembers,
  uploadChatMedia,
  type ChatMessage,
  type MessageKind,
} from '@/lib/api';
import { layoutChat, placeReaders, type ReaderMark } from '@/lib/chat-layout';
import { insertAt } from '@/lib/emoji-data';
import { plural } from '@/lib/format';
import { CHAT_IMAGE, prepareImage, UnsupportedImageError } from '@/lib/image';
import { useQuery } from '@/lib/query';
import { MAX_VOICE_MS, formatDuration } from '@/lib/voice';
import { ButtonLink, IconButton, Skeleton, TripCover } from '@/components/ui';
import { EmojiPicker } from '@/components/emoji-picker';
import { UserAvatar, type AvatarUser } from '@/components/user-avatar';
import { IconArrowDown, IconClose, IconImage, IconMic, IconSend, IconSmile, IconTrash } from '@/components/icons';
import { ChatImage, VoicePlayer } from './message-content';
import { useVoiceRecorder } from './use-voice-recorder';

type RoomStatus = 'connecting' | 'joined' | 'denied' | 'disconnected';

// Passed explicitly: "a full page came back" is how we know there may be older messages.
const HISTORY_PAGE_SIZE = 50;

// Within this many pixels of the bottom counts as "reading the latest".
const NEAR_BOTTOM_PX = 120;

// The tallest the message box grows before it scrolls inside itself (about five lines).
const COMPOSER_MAX_PX = 140;

// A recording shorter than this is almost certainly a mis-tap.
const MIN_VOICE_MS = 700;

/** A message the person has sent that the server hasn't confirmed yet, or that failed. */
interface Outgoing {
  localId: string;
  kind: MessageKind;
  content: string;
  createdAt: string;
  failed: boolean;
  failure?: string;
  /** A picture: the local copy, shown while it uploads. */
  previewUrl?: string;
  /** What to upload, kept so a failed send can be tried again. */
  blob?: Blob;
  durationMs?: number;
  /** Set once the file has been uploaded. */
  mediaId?: string;
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

/** Whether a message that has just arrived is the one this person was waiting to see confirmed. */
function isTheSame(o: Outgoing, message: ChatMessage): boolean {
  if (o.failed || o.kind !== message.kind) return false;
  return o.kind === 'TEXT' ? o.content === message.content : !!o.mediaId && o.mediaId === message.media?.id;
}

/** Small round pictures of the people who have seen a message. */
function SeenBy({ people }: { people: AvatarUser[] }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, 4);
  const extra = people.length - shown.length;
  return (
    <div className="mt-1 flex items-center justify-end gap-0.5 px-1" role="img" aria-label={`Seen by ${people.map((p) => p.name).join(', ')}`}>
      {shown.map((person) => (
        <UserAvatar key={person.id} user={person} size={18} className="ring-2 ring-background" />
      ))}
      {extra > 0 && <span className="ml-0.5 text-[0.75rem] font-semibold text-muted">+{extra}</span>}
    </div>
  );
}

export default function TripChatPage() {
  const authStatus = useRequireAuth();
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;
  const signedIn = authStatus === 'authenticated';
  const receiptsOn = user?.readReceipts === true;

  // Usually already cached from the trip page the person just came from.
  const { data: trip } = useQuery(`trip:${tripId}`, () => getTrip(tripId), { enabled: signedIn });
  const { data: members } = useQuery(`trip:${tripId}:members`, () => listTripMembers(tripId), { enabled: signedIn });
  // How far each other member has read. Empty for someone with read receipts off: it is a trade.
  const { data: savedReads } = useQuery(`trip:${tripId}:reads`, () => getReadStates(tripId), { enabled: signedIn && receiptsOn, staleMs: 0 });

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
  const [atBottom, setAtBottom] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  // Read markers that arrived live, on top of the saved ones.
  const [liveReads, setLiveReads] = useState<Record<string, string>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const recorder = useVoiceRecorder();

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Whether the reader is at the latest messages. Only then does a new message scroll the list.
  const nearBottom = useRef(true);
  // Set just before older messages are prepended, so the scroll position can be kept where it was.
  const prependAnchor = useRef<{ scrollHeight: number } | null>(null);
  const lastMessageId = useRef<string | null>(null);
  const reportedRead = useRef<string | null>(null);
  const localCounter = useRef(0);
  const userId = user?.id;

  useEffect(() => {
    if (!signedIn) return;

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
      // The server has it now: the grey "sending" copy of the same message can go.
      if (message.senderId === userId) {
        setOutgoing((prev) => {
          const at = prev.findIndex((o) => isTheSame(o, message));
          if (at === -1) return prev;
          if (prev[at].previewUrl) URL.revokeObjectURL(prev[at].previewUrl as string);
          return prev.filter((_, i) => i !== at);
        });
      }
    });

    // Someone has read up to a message (only sent to people who share read receipts too).
    socket.on('read', (read: { userId: string; at: string }) => {
      if (!cancelled) setLiveReads((prev) => ({ ...prev, [read.userId]: read.at }));
    });

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [signedIn, tripId, userId]);

  // Whether the screen is actually being looked at: a message is not "read" in a background tab.
  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  const newestId = messages[messages.length - 1]?.id;

  // Tell the others how far this person has read - once they are looking at the latest message, and only
  // if they share read receipts (the server checks as well).
  useEffect(() => {
    if (!receiptsOn || roomStatus !== 'joined' || !newestId || !atBottom || !pageVisible) return;
    if (reportedRead.current === newestId) return;
    const timer = setTimeout(() => {
      reportedRead.current = newestId;
      socketRef.current?.emit('markRead', { tripId, messageId: newestId });
    }, 500);
    return () => clearTimeout(timer);
  }, [receiptsOn, roomStatus, newestId, atBottom, pageVisible, tripId]);

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
    setAtBottom((prev) => (prev === nearBottom.current ? prev : nearBottom.current));
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

  // ---------------------------------------------------------------- sending

  const fail = useCallback((localId: string, failure: string) => {
    setOutgoing((prev) => prev.map((o) => (o.localId === localId ? { ...o, failed: true, failure } : o)));
  }, []);

  /** Uploads what needs uploading, then sends the message. */
  const deliver = useCallback(
    async (item: Outgoing) => {
      const socket = socketRef.current;
      if (!socket) {
        fail(item.localId, 'You are offline. Check your connection and try again.');
        return;
      }
      let mediaId = item.mediaId;
      if (item.kind !== 'TEXT' && !mediaId) {
        try {
          const uploaded = await uploadChatMedia(tripId, item.blob as Blob, item.durationMs);
          mediaId = uploaded.id;
          setOutgoing((prev) => prev.map((o) => (o.localId === item.localId ? { ...o, mediaId } : o)));
        } catch (err) {
          fail(item.localId, err instanceof ApiError ? err.message : 'Could not upload that. Check your connection and try again.');
          return;
        }
      }
      socket.emit('sendMessage', { tripId, kind: item.kind, content: item.content, mediaId }, (ack: { ok: boolean; error?: string }) => {
        if (ack.ok) {
          // If the live copy never turns up (a dropped connection), do not leave a grey ghost behind.
          setTimeout(() => setOutgoing((prev) => prev.filter((o) => o.localId !== item.localId)), 8000);
        } else {
          fail(item.localId, ack.error ?? 'Message failed to send.');
        }
      });
    },
    [tripId, fail],
  );

  function queue(item: Omit<Outgoing, 'localId' | 'createdAt' | 'failed'>) {
    const full: Outgoing = { ...item, localId: `local-${++localCounter.current}`, createdAt: new Date().toISOString(), failed: false };
    setOutgoing((prev) => [...prev, full]);
    void deliver(full);
  }

  function clearPendingImage() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.url);
    setPendingImage(null);
  }

  function send() {
    if (roomStatus !== 'joined') return;
    const text = draft.trim();
    if (pendingImage) {
      queue({ kind: 'IMAGE', content: text, previewUrl: pendingImage.url, blob: pendingImage.blob });
      setPendingImage(null); // the preview address now belongs to the outgoing message
    } else if (text) {
      queue({ kind: 'TEXT', content: text });
    } else {
      return;
    }
    setDraft('');
    setEmojiOpen(false);
    requestAnimationFrame(resizeBox);
  }

  function retry(item: Outgoing) {
    const again = { ...item, failed: false, failure: undefined };
    setOutgoing((prev) => prev.map((o) => (o.localId === item.localId ? again : o)));
    void deliver(again);
  }

  function discard(item: Outgoing) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setOutgoing((prev) => prev.filter((o) => o.localId !== item.localId));
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

  function insertEmoji(emoji: string) {
    const box = boxRef.current;
    const start = box?.selectionStart ?? draft.length;
    const end = box?.selectionEnd ?? start;
    const next = insertAt(draft, emoji, start, end);
    setDraft(next.value);
    requestAnimationFrame(() => {
      box?.setSelectionRange(next.caret, next.caret);
      resizeBox();
    });
  }

  async function handleFileChosen(file: File) {
    setAttachError(null);
    try {
      const { blob } = await prepareImage(file, CHAT_IMAGE);
      clearPendingImage();
      setPendingImage({ blob, url: URL.createObjectURL(blob) });
      boxRef.current?.focus();
    } catch (err) {
      setAttachError(err instanceof UnsupportedImageError ? err.message : 'Could not use that picture. Please try another.');
    }
  }

  // ---------------------------------------------------------------- voice

  async function startRecording() {
    setAttachError(null);
    setEmojiOpen(false);
    await recorder.start();
  }

  const { finish: finishRecording, state: recorderState, elapsedMs } = recorder;
  const sendRecording = useCallback(async () => {
    const recording = await finishRecording();
    if (!recording) return;
    if (recording.durationMs < MIN_VOICE_MS) {
      setAttachError('That was too short. Tap the microphone, speak, then tap send.');
      return;
    }
    const full: Outgoing = {
      localId: `local-${++localCounter.current}`,
      kind: 'VOICE',
      content: '',
      createdAt: new Date().toISOString(),
      failed: false,
      blob: recording.blob,
      durationMs: recording.durationMs,
    };
    setOutgoing((prev) => [...prev, full]);
    void deliver(full);
  }, [finishRecording, deliver]);

  // A recording stops, and is sent, at the longest the server accepts.
  const recordingNow = recorderState === 'recording';
  const atLimit = recordingNow && elapsedMs >= MAX_VOICE_MS - 100;
  useEffect(() => {
    // Deferred a microtask so setState never happens synchronously within the effect body.
    if (atLimit) void Promise.resolve().then(() => sendRecording());
  }, [atLimit, sendRecording]);

  // ---------------------------------------------------------------- what to show

  const items = useMemo(() => layoutChat(messages), [messages]);

  /** Everyone we can put a name and picture to: the trip's members, and anyone who has sent a message. */
  const people = useMemo(() => {
    const byId = new Map<string, AvatarUser>();
    for (const m of members ?? []) byId.set(m.userId, m.user);
    for (const m of messages) if (!byId.has(m.sender.id)) byId.set(m.sender.id, m.sender);
    return byId;
  }, [members, messages]);

  const readersByMessage = useMemo(() => {
    if (!receiptsOn) return new Map<string, string[]>();
    const latest = new Map<string, string>();
    for (const r of savedReads ?? []) latest.set(r.userId, r.lastReadAt);
    for (const [id, at] of Object.entries(liveReads)) {
      const known = latest.get(id);
      if (!known || Date.parse(at) > Date.parse(known)) latest.set(id, at);
    }
    const marks: ReaderMark[] = [...latest].filter(([id]) => id !== userId).map(([id, at]) => ({ userId: id, at }));
    return placeReaders(messages, marks);
  }, [receiptsOn, savedReads, liveReads, messages, userId]);

  if (!signedIn) return null;

  const hasContent = draft.trim().length > 0 || !!pendingImage;
  const connected = roomStatus === 'joined';

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
              const media = m.kind !== 'TEXT';
              const readers = (readersByMessage.get(m.id) ?? []).map((id) => people.get(id)).filter((p): p is AvatarUser => !!p);
              return (
                <div key={item.key} className={`${first ? 'mt-2.5' : 'mt-0.5'}`}>
                  <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                    {!mine && <div className="w-8 shrink-0">{last && <UserAvatar user={m.sender} size={32} />}</div>}
                    <div className={`flex max-w-[78%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      {!mine && first && <span className="mb-0.5 ml-3 text-[0.85rem] font-semibold text-muted">{m.sender.name}</span>}
                      <div
                        className={`break-words text-base leading-snug ${media ? 'p-1.5' : 'whitespace-pre-wrap px-4 py-2.5'} ${
                          mine ? 'bg-accent text-on-accent' : 'bg-surface-2 text-foreground'
                        } ${
                          mine
                            ? `rounded-3xl ${last ? 'rounded-br-md' : ''} ${first ? '' : 'rounded-tr-lg'}`
                            : `rounded-3xl ${last ? 'rounded-bl-md' : ''} ${first ? '' : 'rounded-tl-lg'}`
                        }`}
                      >
                        {m.kind === 'IMAGE' && m.media && <ChatImage media={m.media} caption={m.content} />}
                        {m.kind === 'VOICE' && m.media && (
                          <div className="px-2.5 py-1.5">
                            <VoicePlayer media={m.media} mine={mine} />
                          </div>
                        )}
                        {media && !m.media && <span className="px-2.5 py-1.5 italic opacity-80">This file is no longer available.</span>}
                        {m.kind === 'IMAGE' && m.content && <p className="whitespace-pre-wrap px-2.5 pb-1 pt-1.5">{m.content}</p>}
                        {m.kind === 'TEXT' && m.content}
                      </div>
                      {last && <span className="mx-3 mt-0.5 text-[0.8rem] text-muted">{formatTime(m.createdAt)}</span>}
                    </div>
                  </div>
                  <SeenBy people={readers} />
                </div>
              );
            })}

            {outgoing.map((o) => (
              <div key={o.localId} className="mt-0.5 flex justify-end">
                <div className="flex max-w-[78%] flex-col items-end">
                  <div
                    className={`rounded-3xl bg-accent text-base leading-snug text-on-accent ${o.kind === 'TEXT' ? 'whitespace-pre-wrap break-words px-4 py-2.5' : 'p-1.5'} ${o.failed ? 'opacity-60 ring-2 ring-danger' : 'opacity-70'}`}
                  >
                    {o.kind === 'IMAGE' && o.previewUrl && (
                      <div className="w-[min(16rem,68vw)] overflow-hidden rounded-2xl">
                        {/* The picture as it is on this device, shown while it uploads. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={o.previewUrl} alt="The picture you are sending" className="max-h-72 w-full object-cover" />
                      </div>
                    )}
                    {o.kind === 'VOICE' && <p className="px-3 py-2 font-semibold">🎤 Voice message · {formatDuration(o.durationMs ?? 0)}</p>}
                    {o.kind === 'IMAGE' && o.content && <p className="whitespace-pre-wrap px-2.5 pb-1 pt-1.5">{o.content}</p>}
                    {o.kind === 'TEXT' && o.content}
                  </div>
                  {o.failed ? (
                    <div className="mx-3 mt-1 flex flex-wrap items-center justify-end gap-x-3 text-[0.9rem] font-semibold text-danger">
                      <span>{o.failure ?? 'Not sent.'}</span>
                      <button type="button" onClick={() => retry(o)} className="underline">
                        Try again
                      </button>
                      <button type="button" onClick={() => discard(o)} className="text-muted underline">
                        Delete
                      </button>
                    </div>
                  ) : (
                    <span className="mx-3 mt-0.5 text-[0.8rem] text-muted">{o.kind === 'TEXT' || o.mediaId ? 'Sending…' : 'Uploading…'}</span>
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
            className="pop-in pressable absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-forest px-4 py-2.5 text-[0.95rem] font-semibold text-on-forest shadow-card ring-1 ring-white/20"
          >
            <IconArrowDown size={18} />
            {unseen > 0 ? `${unseen} new` : 'Latest'}
          </button>
        )}
      </div>

      {roomStatus !== 'joined' && (
        <p role="status" className="bg-gold px-4 py-1.5 text-center text-[0.9rem] font-semibold text-on-gold">
          {roomStatus === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…'}
        </p>
      )}

      <div className="pb-safe border-t border-line bg-surface">
        {(attachError || recorder.error) && (
          <p role="alert" className="px-4 pt-2.5 text-[0.95rem] font-medium text-danger">
            {attachError ?? recorder.error}
          </p>
        )}

        {pendingImage && (
          <div className="flex items-center gap-3 px-3 pt-3">
            {/* The chosen picture, before it is sent. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingImage.url} alt="The picture you are about to send" className="h-20 w-20 rounded-xl object-cover" />
            <p className="min-w-0 flex-1 text-[0.95rem] text-muted">Add a caption if you like, then press send.</p>
            <IconButton label="Remove this picture" onClick={clearPendingImage}>
              <IconClose size={22} />
            </IconButton>
          </div>
        )}

        {emojiOpen && !recordingNow && <EmojiPicker onPick={insertEmoji} />}

        {recorderState !== 'idle' ? (
          <div className="flex items-center gap-2 px-3 py-2.5" role="group" aria-label="Recording a voice message">
            <IconButton label="Throw this recording away" onClick={recorder.cancel} className="!text-danger">
              <IconTrash size={24} />
            </IconButton>
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-3xl bg-surface-2 px-4 py-2.5">
              {recordingNow ? (
                <>
                  <span aria-hidden="true" className="recording-dot h-3 w-3 shrink-0 rounded-full bg-accent" />
                  <span role="timer" className="w-12 shrink-0 text-base font-bold tabular-nums">
                    {formatDuration(elapsedMs)}
                  </span>
                  <div className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[2px]" aria-hidden="true">
                    {recorder.levels.map((level, i) => (
                      <span key={i} className="w-[3px] shrink-0 rounded-full bg-accent" style={{ height: `${Math.round(18 + level * 82)}%` }} />
                    ))}
                  </div>
                </>
              ) : (
                <span className="font-semibold text-muted">Allow the microphone to start…</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void sendRecording()}
              disabled={!recordingNow}
              aria-label="Send voice message"
              className="pressable btn-shadow flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-50"
            >
              <IconSend size={22} />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex items-end gap-1.5 px-2 py-2.5">
            <IconButton label={emojiOpen ? 'Hide emoji' : 'Add an emoji'} onClick={() => setEmojiOpen((open) => !open)} aria-pressed={emojiOpen} className={emojiOpen ? '!bg-accent-soft !text-accent-ink' : ''}>
              <IconSmile size={26} />
            </IconButton>
            <IconButton label="Send a picture" onClick={() => fileRef.current?.click()} disabled={!connected}>
              <IconImage size={26} />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ''; // so choosing the same picture again still counts
                if (file) void handleFileChosen(file);
              }}
            />
            <label htmlFor="chat-message" className="sr-only">
              {pendingImage ? 'Caption' : 'Message the group'}
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
              placeholder={pendingImage ? 'Add a caption…' : 'Message the group'}
              enterKeyHint="send"
              className="min-h-12 min-w-0 flex-1 resize-none rounded-3xl border border-field bg-background px-4 py-3 text-base leading-snug text-foreground outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            {hasContent ? (
              <button
                type="submit"
                disabled={!connected}
                aria-label="Send message"
                className="pressable btn-shadow flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-50 disabled:shadow-none"
              >
                <IconSend size={22} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRecording()}
                disabled={!connected}
                aria-label="Record a voice message"
                className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-50"
              >
                <IconMic size={24} />
              </button>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
