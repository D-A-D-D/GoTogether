import { UnauthorizedException } from '@nestjs/common';
import { JwtAccessStrategy } from './jwt-access.strategy.js';

function strategyFor(state: { accountStatus: string; role: string } | null) {
  const accounts = { get: vi.fn().mockResolvedValue(state) };
  const strategy = new JwtAccessStrategy({ getOrThrow: () => 'test-secret' } as never, accounts as never);
  return { strategy, accounts };
}

const payload = { sub: 'user-1', email: 'u@example.com' };

describe('JwtAccessStrategy.validate', () => {
  it('lets an account in good standing through, with its role from the database', async () => {
    const { strategy, accounts } = strategyFor({ accountStatus: 'ACTIVE', role: 'ADMIN' });
    expect(await strategy.validate(payload)).toEqual({ userId: 'user-1', email: 'u@example.com', role: 'ADMIN' });
    expect(accounts.get).toHaveBeenCalledWith('user-1');
  });

  it("takes the role from the account, not from anything in the token", async () => {
    const { strategy } = strategyFor({ accountStatus: 'ACTIVE', role: 'USER' });
    const forged = { ...payload, role: 'ADMIN' } as typeof payload;
    expect((await strategy.validate(forged)).role).toBe('USER');
  });

  it.each(['SUSPENDED', 'BANNED'])('turns away a %s account even though its token is valid', async (accountStatus) => {
    const { strategy } = strategyFor({ accountStatus, role: 'USER' });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('turns away an account that no longer exists', async () => {
    const { strategy } = strategyFor(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 401, which the web client turns into "sign in again", not 403', async () => {
    const { strategy } = strategyFor({ accountStatus: 'SUSPENDED', role: 'USER' });
    const error = await strategy.validate(payload).catch((e: unknown) => e);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
  });
});
