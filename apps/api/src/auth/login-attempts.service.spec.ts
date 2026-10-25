import { HttpException, HttpStatus } from '@nestjs/common';
import { RateWindow } from '../common/rate-window.js';
import { FAILED_LOGIN_WINDOW_MS, FailedLoginTracker, LoginAttemptsService, MAX_FAILED_LOGINS } from './login-attempts.service.js';

function service() {
  let t = 5_000_000;
  const svc = new FailedLoginTracker(new RateWindow(MAX_FAILED_LOGINS, FAILED_LOGIN_WINDOW_MS, () => t));
  return { svc, advance: (ms: number) => (t += ms) };
}

const failTimes = (svc: FailedLoginTracker, email: string, n: number) => {
  for (let i = 0; i < n; i++) svc.recordFailure(email);
};

describe('FailedLoginTracker', () => {
  it('allows sign-in for an account with no failures', () => {
    const { svc } = service();
    expect(() => svc.assertAllowed('una@example.com')).not.toThrow();
  });

  it('allows up to the limit of failures, then refuses with a 429', () => {
    const { svc } = service();
    failTimes(svc, 'una@example.com', MAX_FAILED_LOGINS - 1);
    expect(() => svc.assertAllowed('una@example.com')).not.toThrow();
    svc.recordFailure('una@example.com');
    const error = (() => { try { svc.assertAllowed('una@example.com'); } catch (e) { return e as HttpException; } })();
    expect(error).toBeInstanceOf(HttpException);
    expect(error!.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('says how long to wait, in whole minutes', () => {
    const { svc, advance } = service();
    failTimes(svc, 'una@example.com', MAX_FAILED_LOGINS);
    expect(() => svc.assertAllowed('una@example.com')).toThrow('Try again in 15 minutes.');
    advance(10 * 60_000);
    expect(() => svc.assertAllowed('una@example.com')).toThrow('Try again in 5 minutes.');
  });

  it('says "1 minute", not "1 minutes", and never "0 minutes"', () => {
    const { svc, advance } = service();
    failTimes(svc, 'una@example.com', MAX_FAILED_LOGINS);
    advance(FAILED_LOGIN_WINDOW_MS - 20_000);
    expect(() => svc.assertAllowed('una@example.com')).toThrow('Try again in 1 minute.');
  });

  it('lets the account back in once the window has passed', () => {
    const { svc, advance } = service();
    failTimes(svc, 'una@example.com', MAX_FAILED_LOGINS);
    advance(FAILED_LOGIN_WINDOW_MS + 1);
    expect(() => svc.assertAllowed('una@example.com')).not.toThrow();
  });

  it('counts per account: one person\'s failures do not affect another', () => {
    const { svc } = service();
    failTimes(svc, 'una@example.com', MAX_FAILED_LOGINS);
    expect(() => svc.assertAllowed('raj@example.com')).not.toThrow();
  });

  it('treats the same address typed differently as one account', () => {
    const { svc } = service();
    failTimes(svc, 'Una@Example.com', MAX_FAILED_LOGINS - 1);
    svc.recordFailure('  una@example.COM ');
    expect(() => svc.assertAllowed('UNA@example.com')).toThrow(HttpException);
  });

  it('forgives earlier mistakes after a correct password', () => {
    const { svc } = service();
    failTimes(svc, 'una@example.com', MAX_FAILED_LOGINS - 1);
    svc.recordSuccess('una@example.com');
    failTimes(svc, 'una@example.com', MAX_FAILED_LOGINS - 1);
    expect(() => svc.assertAllowed('una@example.com')).not.toThrow();
  });
});

describe('the policy, pinned', () => {
  // Written as literals on purpose: these are product decisions, so changing one
  // should mean changing this test knowingly, not silently moving both together.
  it('allows 10 failed sign-ins per account in 15 minutes', () => {
    expect(MAX_FAILED_LOGINS).toBe(10);
    expect(FAILED_LOGIN_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

describe('LoginAttemptsService (what Nest builds)', () => {
  it('needs nothing injected, so the API can start', () => {
    // Nest reads a constructor's parameter types as dependencies to resolve; none may be added.
    expect(LoginAttemptsService.length).toBe(0);
    expect(() => new LoginAttemptsService()).not.toThrow();
  });

  it('uses the real limits: the tenth failure blocks, the ninth does not', () => {
    const svc = new LoginAttemptsService();
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) svc.recordFailure('una@example.com');
    expect(() => svc.assertAllowed('una@example.com')).not.toThrow();
    svc.recordFailure('una@example.com');
    expect(() => svc.assertAllowed('una@example.com')).toThrow(HttpException);
  });
});
