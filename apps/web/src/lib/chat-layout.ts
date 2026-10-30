// How a conversation is laid out: messages from one person close together become a cluster (the
// name once at the top, the time once at the bottom, a tail on the last bubble), and a divider
// marks each new day. Pure, so the rules are testable.

import { dayLabel } from '@/lib/format';

export interface LayoutMessage {
  id: string;
  senderId: string;
  createdAt: string;
}

/** More than this between two messages from the same person starts a new cluster. */
export const CLUSTER_GAP_MS = 5 * 60 * 1000;

export type ChatItem<M extends LayoutMessage> =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: M; first: boolean; last: boolean };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** `messages` must be oldest first. */
export function layoutChat<M extends LayoutMessage>(messages: M[], now: Date = new Date()): ChatItem<M>[] {
  const items: ChatItem<M>[] = [];
  messages.forEach((message, i) => {
    const previous = messages[i - 1];
    const next = messages[i + 1];
    const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
    if (newDay) items.push({ kind: 'day', key: `day-${message.id}`, label: dayLabel(message.createdAt, now) });

    const joinsPrevious =
      !!previous &&
      !newDay &&
      previous.senderId === message.senderId &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <= CLUSTER_GAP_MS;
    const nextJoins =
      !!next &&
      dayKey(next.createdAt) === dayKey(message.createdAt) &&
      next.senderId === message.senderId &&
      new Date(next.createdAt).getTime() - new Date(message.createdAt).getTime() <= CLUSTER_GAP_MS;

    items.push({ kind: 'message', key: message.id, message, first: !joinsPrevious, last: !nextJoins });
  });
  return items;
}

/** How far someone has read, as the time of the newest message they have seen. */
export interface ReaderMark {
  userId: string;
  /** The createdAt of the last message they read. */
  at: string;
}

/**
 * Where each reader's "seen" marker goes: under the newest message they have read - but not one they wrote
 * themselves (their own message is not something they "saw"), so it goes under the newest one by someone
 * else. Messages must be oldest first. Returns message id -> the readers to show under it, in the order given.
 */
export function placeReaders<M extends LayoutMessage>(messages: M[], marks: ReaderMark[]): Map<string, string[]> {
  const placed = new Map<string, string[]>();
  for (const mark of marks) {
    const at = Date.parse(mark.at);
    if (Number.isNaN(at)) continue;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (Date.parse(message.createdAt) <= at && message.senderId !== mark.userId) {
        placed.set(message.id, [...(placed.get(message.id) ?? []), mark.userId]);
        break;
      }
    }
  }
  return placed;
}
