// The rules of private (one-to-one) chat, with no database or network in them so they can be tested directly.
//
// How it works. Two people who are on a trip together can ask to talk privately. A request carries ONE
// message; the other person then accepts or declines, and until they accept nobody can send more. Declining is
// never shown to the person who asked - they keep seeing "waiting" - so nobody is told "no". When the host
// removes someone from a trip, their private chats with the people on that trip are CLOSED: to talk again they
// must be on a trip together again and ask again, and be accepted again. Blocking someone deletes the chat.

export type DirectStatusName = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CLOSED';

export const MAX_DIRECT_LENGTH = 2000;
/** Someone whose request was declined may ask again after this long. */
export const ASK_AGAIN_AFTER_DECLINE_MS = 30 * 24 * 60 * 60 * 1000;

/** The two ids in a fixed order, so a pair of people has exactly one thread whoever asked first. */
export function pairOf(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

/** How a thread looks to one of the two people. HIDDEN: it is not shown to them at all. */
export type DirectView = 'ACCEPTED' | 'REQUEST_IN' | 'REQUEST_OUT' | 'CLOSED' | 'HIDDEN';

export function viewOf(thread: { status: DirectStatusName; requesterId: string }, meId: string): DirectView {
  const iAsked = thread.requesterId === meId;
  switch (thread.status) {
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'PENDING':
      return iAsked ? 'REQUEST_OUT' : 'REQUEST_IN';
    // The person who asked is not told it was declined; the person who declined no longer sees it.
    case 'DECLINED':
      return iAsked ? 'REQUEST_OUT' : 'HIDDEN';
    case 'CLOSED':
      return 'CLOSED';
  }
}

/** Why a message cannot be sent right now, as a sentence a person can read - or null if it can. */
export function sendProblem(
  thread: { status: DirectStatusName; requesterId: string },
  senderId: string,
  sentSinceRequest: number,
): string | null {
  switch (thread.status) {
    case 'ACCEPTED':
      return null;
    case 'PENDING':
      if (thread.requesterId !== senderId) return 'Accept their request first to reply';
      return sentSinceRequest >= 1 ? 'You can send more once they accept your request' : null;
    case 'DECLINED':
      return thread.requesterId === senderId ? 'You can send more once they accept your request' : 'This conversation is not open';
    case 'CLOSED':
      return 'This private chat is closed. You can ask again once you are on a trip together.';
  }
}

/** Whether a fresh request may replace what is there. Never overrides an accepted chat or a request still waiting. */
export function canAskAgain(
  thread: { status: DirectStatusName; requesterId: string; respondedAt: Date | null },
  askerId: string,
  now: Date,
): boolean {
  switch (thread.status) {
    case 'CLOSED':
      return true;
    case 'DECLINED':
      // The person who declined may change their mind at once; the person who was declined has to wait.
      if (thread.requesterId !== askerId) return true;
      return !!thread.respondedAt && now.getTime() - thread.respondedAt.getTime() >= ASK_AGAIN_AFTER_DECLINE_MS;
    default:
      return false;
  }
}

/** Why a message's text is not acceptable, or null. */
export function textProblem(content: string): string | null {
  if (content.trim().length === 0) return 'A message cannot be empty';
  if (content.length > MAX_DIRECT_LENGTH) return `A message can be at most ${MAX_DIRECT_LENGTH} characters`;
  return null;
}

/** Whether someone has something waiting for them: a reply or a request to answer. */
export function needsAttention(
  thread: { status: DirectStatusName; requesterId: string; lowReadAt: Date | null; highReadAt: Date | null; userLowId: string },
  meId: string,
  last: { senderId: string; createdAt: Date } | null,
): boolean {
  if (viewOf(thread, meId) === 'REQUEST_IN') return true;
  if (!last || last.senderId === meId) return false;
  const myReadAt = thread.userLowId === meId ? thread.lowReadAt : thread.highReadAt;
  return !myReadAt || last.createdAt.getTime() > myReadAt.getTime();
}
