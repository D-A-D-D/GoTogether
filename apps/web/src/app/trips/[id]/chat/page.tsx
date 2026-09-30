'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { API_URL, getAccessToken, listMessages, type ChatMessage } from '@/lib/api';
import { ErrorText, TextInput, PrimaryButton } from '@/components/form-controls';

type RoomStatus = 'connecting' | 'joined' | 'denied' | 'disconnected';

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
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

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const history = await listMessages(tripId);
        if (!cancelled) setMessages(history);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

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
          <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-line bg-surface p-4">
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
