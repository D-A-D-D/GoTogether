import { HttpException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';

// The sign-in route's use of the per-account failed-attempt limit: when it is
// asked, what counts as a failure, and what a correct password does.

function harness(options: { validate?: () => Promise<unknown>; blocked?: boolean } = {}) {
  const user = { id: 'u1', email: 'una@example.com' };
  const validateUser = vi.fn(options.validate ?? (async () => user));
  const login = vi.fn().mockResolvedValue({ tokens: { accessToken: 'a', refreshToken: 'r', refreshExpiresAt: new Date() } });
  const loginAttempts = {
    assertAllowed: vi.fn(() => {
      if (options.blocked) throw new HttpException('Too many failed sign-in attempts. Try again in 5 minutes.', 429);
    }),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
  };
  const controller = new AuthController(
    { validateUser, login } as never,
    { toPublicProfile: (u: unknown) => u } as never,
    { get: vi.fn() } as never,
    loginAttempts as never,
  );
  const res = { cookie: vi.fn() };
  const signIn = () => controller.login({ email: 'una@example.com', password: 'pw' } as never, res as never);
  return { signIn, validateUser, login, loginAttempts, res };
}

describe('AuthController.login — failed-attempt limit', () => {
  it('checks the limit before looking at the password at all', async () => {
    const { signIn, validateUser, loginAttempts } = harness({ blocked: true });
    await expect(signIn()).rejects.toBeInstanceOf(HttpException);
    expect(loginAttempts.assertAllowed).toHaveBeenCalledWith('una@example.com');
    expect(validateUser).not.toHaveBeenCalled();
  });

  it('issues no session to a blocked account, even with the right password', async () => {
    const { signIn, login } = harness({ blocked: true });
    await expect(signIn()).rejects.toThrow('Too many failed sign-in attempts');
    expect(login).not.toHaveBeenCalled();
  });

  it('records a wrong password as a failure, and still answers 401', async () => {
    const { signIn, loginAttempts } = harness({
      validate: async () => {
        throw new UnauthorizedException('Invalid email or password');
      },
    });
    await expect(signIn()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(loginAttempts.recordFailure).toHaveBeenCalledWith('una@example.com');
    expect(loginAttempts.recordSuccess).not.toHaveBeenCalled();
  });

  it('does not count a server error against the person trying to sign in', async () => {
    const { signIn, loginAttempts } = harness({
      validate: async () => {
        throw new InternalServerErrorException("Can't reach database server");
      },
    });
    await expect(signIn()).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(loginAttempts.recordFailure).not.toHaveBeenCalled();
  });

  it('a correct password signs in and clears the failures', async () => {
    const { signIn, loginAttempts, login } = harness();
    await signIn();
    expect(loginAttempts.recordSuccess).toHaveBeenCalledWith('una@example.com');
    expect(loginAttempts.recordFailure).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalled();
  });
});
