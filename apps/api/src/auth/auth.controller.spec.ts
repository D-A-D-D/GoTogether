import { HttpException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';

// The sign-in route's use of the per-account failed-attempt limit: when it is
// asked, what counts as a failure, and what a correct password does.

function harness(options: { validate?: () => Promise<unknown>; blocked?: boolean } = {}) {
  const credentials = { sendVerification: vi.fn() };
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
    credentials as never,
  );
  const res = { cookie: vi.fn() };
  const signIn = () => controller.login({ email: 'una@example.com', password: 'pw' } as never, res as never);
  const register = authRegister(controller, res);
  return { signIn, validateUser, login, loginAttempts, res, credentials, register };
}

function authRegister(controller: AuthController, res: { cookie: unknown }) {
  return (service: { register: (...a: unknown[]) => Promise<unknown> }) => {
    (controller as unknown as { authService: unknown }).authService = service;
    return controller.register({ email: 'una@example.com', password: 'pw-long-enough', name: 'Una' } as never, res as never);
  };
}

describe('AuthController.register — verification email', () => {
  const created = { id: 'u1', email: 'una@example.com', name: 'Una', emailVerifiedAt: null };
  const service = { register: vi.fn().mockResolvedValue({ user: created, tokens: { accessToken: 'a', refreshToken: 'r', refreshExpiresAt: new Date() } }) };

  it('sends the new person a verification email, and still signs them in', async () => {
    const { register, credentials, res } = harness();
    const result = (await register(service)) as { accessToken: string };
    expect(credentials.sendVerification).toHaveBeenCalledWith(created);
    expect(result.accessToken).toBe('a');
    expect(res.cookie).toHaveBeenCalled();
  });
});

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
