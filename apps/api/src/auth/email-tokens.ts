// The single-use links we email (reset a password, verify an address). Pure, so
// the rules can be tested without a database (email-tokens.spec.ts).
import { createHash, randomBytes } from 'node:crypto';

/** How long a link works. A reset is sensitive, so it is short; verifying an address can wait a day. */
export const RESET_TTL_MS = 60 * 60_000;
export const VERIFICATION_TTL_MS = 24 * 60 * 60_000;

/** How many of each kind we will send to one address in an hour. */
export const EMAILS_PER_HOUR = 3;

export function hashEmailToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * 256 bits from the system's random source. `raw` goes in the email and is never
 * stored; `hash` is what the database keeps, so a copy of the table can't be
 * turned into working links.
 */
export function generateEmailToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashEmailToken(raw) };
}
