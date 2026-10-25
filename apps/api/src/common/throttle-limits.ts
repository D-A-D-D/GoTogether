// Per-IP request limits, in one place so they can be read and tuned together.
// They are deliberately generous: in the launch market many people share one
// public IP address (carrier-grade NAT), so a tight per-IP limit would lock out
// real users. The tight limits are per *account* instead - failed sign-ins in
// LoginAttemptsService, messages per user in the chat gateway.

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

/** What a person sees when they hit a per-address limit. */
export const TOO_MANY_REQUESTS = 'Too many requests - please slow down and try again in a moment.';

export const LIMITS = {
  /** Every route unless it says otherwise. */
  default: { limit: 300, ttl: MINUTE_MS },
  /** Sign-in attempts from one address; the per-account limit is stricter. */
  login: { limit: 10, ttl: MINUTE_MS },
  register: { limit: 10, ttl: MINUTE_MS },
  /** The web app refreshes its session on every page load. */
  refresh: { limit: 60, ttl: MINUTE_MS },
  /** Heavy or destructive account actions: exporting data, deleting the account. */
  accountAction: { limit: 10, ttl: HOUR_MS },
} as const;
