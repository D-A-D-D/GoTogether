import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';

const contextFor = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('lets an admin through', () => {
    expect(guard.canActivate(contextFor({ userId: 'a', email: 'a@x', role: 'ADMIN' }))).toBe(true);
  });

  it('refuses an ordinary user', () => {
    expect(() => guard.canActivate(contextFor({ userId: 'u', email: 'u@x', role: 'USER' }))).toThrow(ForbiddenException);
  });

  it('refuses a request with no user at all', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  it('refuses a user with no role', () => {
    expect(() => guard.canActivate(contextFor({ userId: 'u', email: 'u@x' }))).toThrow(ForbiddenException);
  });
});
