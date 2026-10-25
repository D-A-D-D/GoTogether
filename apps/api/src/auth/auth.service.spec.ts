import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService, RESTRICTED_ACCOUNT_MESSAGES } from './auth.service.js';

// Only the account-status handling is covered: a suspended or closed account
// must not be able to start or extend a session.

function harness(user: Record<string, unknown> | null = null) {
  const issueTokenPair = vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', refreshExpiresAt: new Date() });
  const tokens = {
    issueTokenPair,
    verifyRefreshToken: vi.fn().mockResolvedValue({ id: 'token-1', userId: 'user-1' }),
  };
  const users = { findById: vi.fn().mockResolvedValue(user), findByEmail: vi.fn().mockResolvedValue(user) };
  const service = new AuthService(users as never, tokens as never, {} as never);
  return { service, issueTokenPair };
}

const account = (accountStatus: string, extra: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'u@example.com',
  accountStatus,
  ...extra,
});

describe('AuthService.login', () => {
  it('starts a session for an active account', async () => {
    const { service, issueTokenPair } = harness();
    await service.login(account('ACTIVE') as never);
    expect(issueTokenPair).toHaveBeenCalledWith('user-1', 'u@example.com');
  });

  it.each(['SUSPENDED', 'BANNED', 'DELETED'] as const)('refuses a %s account with a 403 and its own message, issuing nothing', async (status) => {
    const { service, issueTokenPair } = harness();
    const error = await service.login(account(status) as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(RESTRICTED_ACCOUNT_MESSAGES[status]);
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('says nothing about why — no report or moderator note', () => {
    for (const message of Object.values(RESTRICTED_ACCOUNT_MESSAGES)) {
      expect(message).not.toMatch(/report|moderator|reason|because/i);
    }
  });
});

describe('AuthService.refresh', () => {
  it('extends the session of an active account', async () => {
    const { service, issueTokenPair } = harness(account('ACTIVE'));
    await service.refresh('raw-token');
    expect(issueTokenPair).toHaveBeenCalled();
  });

  it.each(['SUSPENDED', 'BANNED', 'DELETED'])('refuses to extend a %s account, with a 401 so the client just ends the session', async (status) => {
    const { service, issueTokenPair } = harness(account(status));
    const error = await service.refresh('raw-token').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('refuses an account that no longer exists', async () => {
    const { service } = harness(null);
    await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.validateUser', () => {
  it("doesn't reveal that an account is restricted to someone who doesn't know its password", async () => {
    const passwordHash = bcrypt.hashSync('right-password', 4);
    const { service } = harness(account('SUSPENDED', { passwordHash }));
    const error = await service.validateUser('u@example.com', 'wrong-password').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe('Invalid email or password');
  });
});
