import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  email: string;
}

/**
 * Pulls the user attached by JwtAccessStrategy#validate (shape:
 * { userId, email }) onto the request — only meaningful behind
 * JwtAccessGuard.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
  return request.user;
});
