// What makes a chat message valid, and how it reads in a notification. Pure, so the rules are testable
// without a database or a socket.

export type MessageKindName = 'TEXT' | 'IMAGE' | 'VOICE';

export const MAX_TEXT_LENGTH = 4000;
export const MAX_CAPTION_LENGTH = 1000;
export const NOTIFICATION_PREVIEW_LENGTH = 80;

/**
 * Why a message cannot be sent, as a sentence a person can read - or null if it is fine.
 * Text needs words. A picture needs its uploaded file and may have a short caption. A voice note needs its
 * file and carries no text (anything sent with it is ignored by the caller, not stored).
 */
export function messageProblem(kind: MessageKindName, content: string, mediaId: string | undefined): string | null {
  if (kind === 'TEXT') {
    if (mediaId) return 'A text message cannot carry a file';
    if (content.trim().length === 0) return 'A message cannot be empty';
    if (content.length > MAX_TEXT_LENGTH) return `A message can be at most ${MAX_TEXT_LENGTH} characters`;
    return null;
  }
  if (!mediaId) return kind === 'IMAGE' ? 'Choose a picture to send' : 'Record a voice message to send';
  if (kind === 'IMAGE' && content.length > MAX_CAPTION_LENGTH) return `A caption can be at most ${MAX_CAPTION_LENGTH} characters`;
  return null;
}

/** The text to store: what was typed, trimmed - and nothing at all for a voice note. */
export function storedContent(kind: MessageKindName, content: string): string {
  return kind === 'VOICE' ? '' : content.trim();
}

/** The body of the push notification for a message. */
export function notificationBody(kind: MessageKindName, content: string): string {
  const cut = (text: string) => (text.length > NOTIFICATION_PREVIEW_LENGTH ? `${text.slice(0, NOTIFICATION_PREVIEW_LENGTH)}…` : text);
  if (kind === 'VOICE') return '🎤 Voice message';
  if (kind === 'IMAGE') return content.trim() ? `📷 ${cut(content.trim())}` : '📷 Photo';
  return cut(content);
}
