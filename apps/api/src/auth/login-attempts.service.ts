import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RateWindow } from '../common/rate-window.js';

export const MAX_FAILED_LOGINS = 10;
export const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;

/**
 * Failed sign-ins per *account*, whatever address they come from. The per-IP
 * limit stops one machine hammering the form; this stops a spread-out attack on
 * one person's password. The trade-off is that someone can deliberately burn a
 * victim's attempts and make them wait (see docs/IDEAS.md) - at 10 per 15
 * minutes with a plain "try again later", that is a nuisance, not a lockout.
 *
 * In memory and per process, like RateWindow.
 *
 * The logic lives here, not in the injectable class below, so it can be tested
 * with a controllable clock. (A constructor parameter on the injectable would be
 * read by Nest as a dependency to inject, and the API would not start.)
 */
export class FailedLoginTracker {
  constructor(private readonly failures: RateWindow) {}

  private key(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Throws 429, saying how long to wait, if this account has had too many recent failures. */
  assertAllowed(email: string): void {
    const key = this.key(email);
    if (!this.failures.isFull(key)) return;
    const minutes = Math.max(1, Math.ceil(this.failures.retryAfterMs(key) / 60_000));
    throw new HttpException(
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  recordFailure(email: string): void {
    this.failures.record(this.key(email));
  }

  /** A correct password forgives the earlier typos. */
  recordSuccess(email: string): void {
    this.failures.clear(this.key(email));
  }
}

@Injectable()
export class LoginAttemptsService extends FailedLoginTracker {
  constructor() {
    super(new RateWindow(MAX_FAILED_LOGINS, FAILED_LOGIN_WINDOW_MS));
  }
}
