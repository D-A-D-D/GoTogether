import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestUser } from '../auth/current-user.decorator.js';
import { UserRole } from '../generated/prisma/index.js';

/**
 * Admins only. Runs after JwtAccessGuard, which has already put the user on
 * the request — with `role` read from the database (briefly cached), never
 * from the token, so demoting someone takes effect at once.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    if (request.user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admins only');
    }
    return true;
  }
}
