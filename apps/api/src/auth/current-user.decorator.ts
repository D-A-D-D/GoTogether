import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../generated/prisma/index.js';

export interface RequestUser {
  userId: string;
  email: string;
  /** Read from the database (briefly cached), never from the token — a demotion applies at once. */
  role: UserRole;
}

/**
 * Pulls the user attached by JwtAccessStrategy#validate (shape:
 * { userId, email, role }) onto the request — only meaningful behind
 * JwtAccessGuard.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
  return request.user;
});
