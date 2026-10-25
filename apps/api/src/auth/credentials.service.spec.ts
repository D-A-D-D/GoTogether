import { BadRequestException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CredentialsService, INVALID_LINK } from './credentials.service.js';
import { EMAILS_PER_HOUR, RESET_TTL_MS, VERIFICATION_TTL_MS, hashEmailToken } from './email-tokens.js';

// The database is mocked: these cover the rules around the emailed links, not
// the queries (those are exercised against the real database by hand - see
// docs/ROADMAP.md).

type Row = Record<string, any>;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(
  options: {
    user?: Row | null;
    token?: Row | null;
    /** What the single-use update reports: 1 = this call spent it, 0 = someone already had or it expired. */
    spent?: number;
    sendError?: Error;
    sendNever?: boolean;
    transactionError?: Error;
  } = {},
) {
  const user =
    options.user === undefined
      ? { id: 'u1', email: 'una@example.com', name: 'Una', accountStatus: 'ACTIVE', emailVerifiedAt: null }
      : options.user;
  const token =
    options.token === undefined
      ? { id: 't1', userId: 'u1', purpose: 'PASSWORD_RESET', tokenHash: 'h', usedAt: null, expiresAt: new Date(Date.now() + 60_000) }
      : options.token;

  const op = (name: string) => vi.fn((args?: unknown) => ({ op: name, args }));
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(user),
      findUnique: vi.fn().mockResolvedValue(user),
      update: op('user.update'),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    emailToken: {
      findUnique: vi.fn().mockResolvedValue(token),
      // issuing/retiring (array transaction) is tagged; spending a link (awaited) reports a count.
      updateMany: vi.fn((args: any) =>
        args.where.id ? Promise.resolve({ count: options.spent ?? 1 }) : { op: 'emailToken.updateMany', args },
      ),
      create: op('emailToken.create'),
    },
    refreshToken: { updateMany: op('refreshToken.updateMany') },
    $transaction: vi.fn(async (ops: unknown[]) => {
      if (options.transactionError) throw options.transactionError;
      return ops;
    }),
  };
  const send = options.sendNever
    ? vi.fn(() => new Promise<void>(() => undefined))
    : options.sendError
      ? vi.fn().mockRejectedValue(options.sendError)
      : vi.fn().mockResolvedValue(undefined);
  const email = { send, webOrigin: 'https://app.example.test' };
  const loginAttempts = { recordSuccess: vi.fn() };
  const service = new CredentialsService(prisma as never, email as never, loginAttempts as never);
  const ran = () => (prisma.$transaction.mock.calls.at(-1)?.[0] as Array<{ op: string; args: any }> | undefined) ?? [];
  const sent = () => send.mock.calls.map((c) => c[0] as { to: string; subject: string; text: string });
  return { service, prisma, send, sent, loginAttempts, ran };
}

/** The token a link in a sent email carries. */
const tokenIn = (text: string) => decodeURIComponent(/#token=([^\s]+)/.exec(text)![1]);

describe('CredentialsService.requestPasswordReset — who gets an email', () => {
  it('emails an active account a link to the reset page', async () => {
    const { service, sent } = harness();
    await service.requestPasswordReset('una@example.com');
    await flush();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].to).toBe('una@example.com');
    expect(sent()[0].subject).toBe('Reset your GoTogether password');
    expect(sent()[0].text).toContain('https://app.example.test/reset-password#token=');
  });

  it('says nothing for an address with no account: no token, no email', async () => {
    const { service, sent, prisma } = harness({ user: null });
    await expect(service.requestPasswordReset('ghost@example.com')).resolves.toBeUndefined();
    await flush();
    expect(sent()).toHaveLength(0);
    expect(prisma.emailToken.create).not.toHaveBeenCalled();
  });

  it.each(['SUSPENDED', 'BANNED', 'DELETED'])('sends nothing to a %s account', async (accountStatus) => {
    const { service, sent, prisma } = harness({ user: { id: 'u1', email: 'una@example.com', name: 'Una', accountStatus } });
    await service.requestPasswordReset('una@example.com');
    await flush();
    expect(sent()).toHaveLength(0);
    expect(prisma.emailToken.create).not.toHaveBeenCalled();
  });

  it('finds the account whatever case the address is typed in', async () => {
    const { service, prisma } = harness();
    await service.requestPasswordReset('  UNA@Example.com ');
    expect(prisma.user.findFirst.mock.calls[0][0].where.email).toEqual({ equals: 'UNA@Example.com', mode: 'insensitive' });
  });

  it('answers the same (nothing) whether or not there is an account, so the reply reveals nothing', async () => {
    const found = await harness().service.requestPasswordReset('una@example.com');
    const missing = await harness({ user: null }).service.requestPasswordReset('ghost@example.com');
    expect(found).toBe(missing);
  });
});

describe('CredentialsService.requestPasswordReset — the token', () => {
  it('stores only a hash of the token that was emailed', async () => {
    const { service, sent, ran } = harness();
    await service.requestPasswordReset('una@example.com');
    await flush();
    const raw = tokenIn(sent()[0].text);
    const created = ran().find((o) => o.op === 'emailToken.create')!.args.data;
    expect(created.tokenHash).toBe(hashEmailToken(raw));
    expect(JSON.stringify(created)).not.toContain(raw);
  });

  it('is a reset token for that person, good for an hour', async () => {
    const before = Date.now();
    const { service, ran } = harness();
    await service.requestPasswordReset('una@example.com');
    await flush();
    const data = ran().find((o) => o.op === 'emailToken.create')!.args.data;
    expect(data).toMatchObject({ userId: 'u1', purpose: 'PASSWORD_RESET' });
    expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(RESET_TTL_MS - 1000);
    expect(data.expiresAt.getTime() - before).toBeLessThanOrEqual(RESET_TTL_MS + 5000);
  });

  it('retires the earlier unused links first, so only the newest works', async () => {
    const { service, ran } = harness();
    await service.requestPasswordReset('una@example.com');
    await flush();
    expect(ran().map((o) => o.op)).toEqual(['emailToken.updateMany', 'emailToken.create']);
    expect(ran()[0].args.where).toEqual({ userId: 'u1', purpose: 'PASSWORD_RESET', usedAt: null });
    expect(ran()[0].args.data.usedAt).toBeInstanceOf(Date);
  });

  it('gives each request a different token', async () => {
    const { service, sent } = harness();
    await service.requestPasswordReset('una@example.com');
    await service.requestPasswordReset('una@example.com');
    await flush();
    expect(tokenIn(sent()[0].text)).not.toBe(tokenIn(sent()[1].text));
  });
});

describe('CredentialsService.requestPasswordReset — abuse and failure', () => {
  it('sends only a few an hour to one address, and still answers the same', async () => {
    const { service, sent } = harness();
    for (let i = 0; i < EMAILS_PER_HOUR + 3; i++) await expect(service.requestPasswordReset('una@example.com')).resolves.toBeUndefined();
    await flush();
    expect(sent()).toHaveLength(EMAILS_PER_HOUR);
  });

  it('counts the same address typed in different cases together', async () => {
    const { service, sent } = harness();
    for (const typed of ['una@example.com', 'UNA@example.com', 'Una@Example.com', 'una@EXAMPLE.com', 'UNA@EXAMPLE.COM']) {
      await service.requestPasswordReset(typed);
    }
    await flush();
    expect(sent()).toHaveLength(EMAILS_PER_HOUR);
  });

  it('shares one allowance between two accounts whose addresses differ only in case - they are the same mailbox', async () => {
    const { service, sent, prisma } = harness();
    for (let i = 0; i < EMAILS_PER_HOUR; i++) await service.requestPasswordReset('una@example.com');
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', email: 'UNA@Example.COM', name: 'Una Two', accountStatus: 'ACTIVE' });
    await service.requestPasswordReset('UNA@Example.COM');
    await flush();
    expect(sent()).toHaveLength(EMAILS_PER_HOUR);
  });

  it('does not make the reply wait for the token to be written either - the answer must take as long for a real account as for an unknown one', async () => {
    const { service, prisma } = harness();
    prisma.$transaction.mockImplementation(() => new Promise(() => undefined)); // never finishes
    await expect(service.requestPasswordReset('una@example.com')).resolves.toBeUndefined();
  });

  it('survives the database failing while it prepares the link', async () => {
    const { service } = harness({ transactionError: new Error('db down') });
    await expect(service.requestPasswordReset('una@example.com')).resolves.toBeUndefined();
    await flush(); // no unhandled rejection
  });

  it('does not make the reply wait for the email to go out - a slow provider must not reveal which addresses have accounts', async () => {
    const { service } = harness({ sendNever: true });
    await expect(service.requestPasswordReset('una@example.com')).resolves.toBeUndefined();
  });

  /**
   * Runs `work` and returns any promise rejection nobody handled. (A vi.fn() can't show
   * this: vitest handles the promises its mocks return, so nothing is ever unhandled -
   * which would hide a missing .catch. A plain rejected promise can.)
   */
  async function unhandledRejectionsDuring(work: () => Promise<void> | void): Promise<unknown[]> {
    const seen: unknown[] = [];
    const listener = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', listener);
    try {
      await work();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', listener);
    }
    return seen;
  }

  it('handles a failed send itself, rather than leaving an unhandled rejection for the process to deal with', async () => {
    const { service } = harness();
    (service as unknown as { email: unknown }).email = { send: () => Promise.reject(new Error('provider down')), webOrigin: 'https://app.example.test' };
    const unhandled = await unhandledRejectionsDuring(() => service.requestPasswordReset('una@example.com'));
    expect(unhandled).toEqual([]);
  });

  it('does the same when a verification email fails to send', async () => {
    const { service } = harness();
    (service as unknown as { email: unknown }).email = { send: () => Promise.reject(new Error('provider down')), webOrigin: 'https://app.example.test' };
    const unhandled = await unhandledRejectionsDuring(() => service.sendVerification({ id: 'u1', email: 'una@example.com', name: 'Una', emailVerifiedAt: null }));
    expect(unhandled).toEqual([]);
  });

  it('survives the email failing to send', async () => {
    const { service } = harness({ sendError: new Error('provider down') });
    await expect(service.requestPasswordReset('una@example.com')).resolves.toBeUndefined();
    await flush(); // no unhandled rejection
  });
});

describe('CredentialsService.resetPassword — a good link', () => {
  it('sets the new password, as a hash that checks out', async () => {
    const { service, ran } = harness();
    await service.resetPassword('a-valid-looking-token-value', 'a brand new password');
    const update = ran().find((o) => o.op === 'user.update')!.args;
    expect(update.where).toEqual({ id: 'u1' });
    expect(update.data.passwordHash).not.toContain('a brand new password');
    expect(await bcrypt.compare('a brand new password', update.data.passwordHash)).toBe(true);
  });

  it('does all of it in one transaction: the password, the other links, and every session', async () => {
    const { service, prisma, ran } = harness();
    await service.resetPassword('a-valid-looking-token-value', 'a brand new password');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ran().map((o) => o.op)).toEqual(['user.update', 'emailToken.updateMany', 'refreshToken.updateMany']);
  });

  it('signs the account out everywhere', async () => {
    const { service, ran } = harness();
    await service.resetPassword('a-valid-looking-token-value', 'a brand new password');
    const revoke = ran().find((o) => o.op === 'refreshToken.updateMany')!.args;
    expect(revoke.where).toEqual({ userId: 'u1', revokedAt: null });
    expect(revoke.data.revokedAt).toBeInstanceOf(Date);
  });

  it('retires any other reset link still out there', async () => {
    const { service, ran } = harness();
    await service.resetPassword('a-valid-looking-token-value', 'a brand new password');
    expect(ran().find((o) => o.op === 'emailToken.updateMany')!.args.where).toEqual({ userId: 'u1', purpose: 'PASSWORD_RESET', usedAt: null });
  });

  it('lifts a failed-sign-in lock: they have just proved who they are', async () => {
    const { service, loginAttempts } = harness();
    await service.resetPassword('a-valid-looking-token-value', 'a brand new password');
    expect(loginAttempts.recordSuccess).toHaveBeenCalledWith('una@example.com');
  });

  it('spends the link in one conditional update, so two clicks cannot both win', async () => {
    const { service, prisma } = harness();
    await service.resetPassword('a-valid-looking-token-value', 'a brand new password');
    const spend = prisma.emailToken.updateMany.mock.calls.map((c) => c[0]).find((a: any) => a.where.id)!;
    expect(spend.where).toMatchObject({ id: 't1', usedAt: null });
    expect(spend.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(spend.data.usedAt).toBeInstanceOf(Date);
  });

  it('looks the link up by its hash, never its raw value', async () => {
    const { service, prisma } = harness();
    await service.resetPassword('a-valid-looking-token-value', 'a brand new password');
    expect(prisma.emailToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashEmailToken('a-valid-looking-token-value') } });
  });
});

describe('CredentialsService.resetPassword — a link that does not work', () => {
  const attempt = (h: ReturnType<typeof harness>) => h.service.resetPassword('a-valid-looking-token-value', 'a brand new password');
  const changedNothing = (h: ReturnType<typeof harness>) => {
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.loginAttempts.recordSuccess).not.toHaveBeenCalled();
  };

  it('refuses a link nobody issued', async () => {
    const h = harness({ token: null });
    await expect(attempt(h)).rejects.toEqual(new BadRequestException(INVALID_LINK));
    changedNothing(h);
  });

  it('refuses a verification link used as a reset link', async () => {
    const h = harness({ token: { id: 't1', userId: 'u1', purpose: 'EMAIL_VERIFICATION' } });
    await expect(attempt(h)).rejects.toEqual(new BadRequestException(INVALID_LINK));
    changedNothing(h);
  });

  it('refuses a link that was already used or has expired (the single-use update reports no change)', async () => {
    const h = harness({ spent: 0 });
    await expect(attempt(h)).rejects.toEqual(new BadRequestException(INVALID_LINK));
    changedNothing(h);
  });

  it.each(['SUSPENDED', 'BANNED', 'DELETED'])('refuses a link for a %s account, with the same message', async (accountStatus) => {
    const h = harness({ user: { id: 'u1', email: 'una@example.com', name: 'Una', accountStatus } });
    await expect(attempt(h)).rejects.toEqual(new BadRequestException(INVALID_LINK));
    changedNothing(h);
  });

  it('refuses a link whose account no longer exists', async () => {
    const h = harness({ user: null });
    await expect(attempt(h)).rejects.toEqual(new BadRequestException(INVALID_LINK));
  });

  it('gives one message for every way a link can fail, so nothing is learned from which it was', async () => {
    const messages = await Promise.all(
      [harness({ token: null }), harness({ spent: 0 }), harness({ token: { id: 't', userId: 'u1', purpose: 'EMAIL_VERIFICATION' } }), harness({ user: null })].map((h) =>
        attempt(h).catch((e: BadRequestException) => e.message),
      ),
    );
    expect(new Set(messages)).toEqual(new Set([INVALID_LINK]));
  });
});

describe('CredentialsService.verifyEmail', () => {
  const verificationToken = { id: 't9', userId: 'u1', purpose: 'EMAIL_VERIFICATION' };

  it('marks the address verified, once', async () => {
    const { service, prisma } = harness({ token: verificationToken });
    await service.verifyEmail('a-valid-looking-token-value');
    const call = prisma.user.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u1', emailVerifiedAt: null });
    expect(call.data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('refuses a password-reset link used to verify', async () => {
    const { service, prisma } = harness();
    await expect(service.verifyEmail('a-valid-looking-token-value')).rejects.toEqual(new BadRequestException(INVALID_LINK));
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined]])('refuses a link that does not exist (%s)', async (token) => {
    const { service, prisma } = harness({ token: token as never });
    await expect(service.verifyEmail('a-valid-looking-token-value')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a link that was already used or has expired', async () => {
    const { service, prisma } = harness({ token: verificationToken, spent: 0 });
    await expect(service.verifyEmail('a-valid-looking-token-value')).rejects.toEqual(new BadRequestException(INVALID_LINK));
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('CredentialsService.sendVerification', () => {
  const unverified = { id: 'u1', email: 'una@example.com', name: 'Una', emailVerifiedAt: null };

  it('emails a link to the verification page, good for a day', async () => {
    const before = Date.now();
    const { service, sent, ran } = harness();
    service.sendVerification(unverified);
    await flush();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].subject).toBe('Confirm your GoTogether email address');
    expect(sent()[0].text).toContain('https://app.example.test/verify-email#token=');
    const data = ran().find((o) => o.op === 'emailToken.create')!.args.data;
    expect(data).toMatchObject({ userId: 'u1', purpose: 'EMAIL_VERIFICATION' });
    expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(VERIFICATION_TTL_MS - 1000);
  });

  it('stores only a hash', async () => {
    const { service, sent, ran } = harness();
    service.sendVerification(unverified);
    await flush();
    const raw = tokenIn(sent()[0].text);
    expect(ran().find((o) => o.op === 'emailToken.create')!.args.data.tokenHash).toBe(hashEmailToken(raw));
  });

  it('does nothing for an address that is already verified', async () => {
    const { service, sent, prisma } = harness();
    service.sendVerification({ ...unverified, emailVerifiedAt: new Date() });
    await flush();
    expect(sent()).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('never throws, so signing up cannot fail because of email - whether sending or the database fails', async () => {
    const sendFails = harness({ sendError: new Error('provider down') });
    expect(() => sendFails.service.sendVerification(unverified)).not.toThrow();
    const dbFails = harness({ transactionError: new Error('db down') });
    expect(() => dbFails.service.sendVerification(unverified)).not.toThrow();
    await flush();
  });

  it('sends only a few an hour to one address', async () => {
    const { service, sent } = harness();
    for (let i = 0; i < EMAILS_PER_HOUR + 2; i++) service.sendVerification(unverified);
    await flush();
    expect(sent()).toHaveLength(EMAILS_PER_HOUR);
  });

  it('counts reset and verification emails separately', async () => {
    const { service, sent } = harness();
    for (let i = 0; i < EMAILS_PER_HOUR; i++) await service.requestPasswordReset('una@example.com');
    service.sendVerification(unverified);
    await flush();
    expect(sent().filter((m) => m.subject.startsWith('Confirm'))).toHaveLength(1);
  });
});

describe('CredentialsService.resendVerification', () => {
  it('tells someone already verified, and sends nothing', async () => {
    const { service, sent } = harness({ user: { id: 'u1', email: 'una@example.com', name: 'Una', emailVerifiedAt: new Date() } });
    await expect(service.resendVerification('u1')).resolves.toEqual({ alreadyVerified: true });
    await flush();
    expect(sent()).toHaveLength(0);
  });

  it('sends a fresh link to someone not yet verified', async () => {
    const { service, sent } = harness();
    await expect(service.resendVerification('u1')).resolves.toEqual({ alreadyVerified: false });
    await flush();
    expect(sent()).toHaveLength(1);
  });

  it('says plainly, with a 429, when they have asked too often', async () => {
    const { service } = harness();
    for (let i = 0; i < EMAILS_PER_HOUR; i++) await service.resendVerification('u1');
    const error = await service.resendVerification('u1').catch((e: HttpException) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toMatch(/spam folder/);
  });

  it('refuses an account that does not exist', async () => {
    const { service } = harness({ user: null });
    await expect(service.resendVerification('ghost')).rejects.toBeInstanceOf(BadRequestException);
  });
});
