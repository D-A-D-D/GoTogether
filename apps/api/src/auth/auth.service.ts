import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service.js';
import { TokensService } from './tokens.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountStatus, type User } from '../generated/prisma/index.js';

const BCRYPT_ROUNDS = 12;

// Shown at sign-in to someone whose account isn't in good standing. Deliberately
// says nothing about why (a report, a moderator's note) — that's between them
// and whoever reviews it.
export const RESTRICTED_ACCOUNT_MESSAGES: Record<Exclude<AccountStatus, 'ACTIVE'>, string> = {
  SUSPENDED: 'This account has been suspended. If you think that is a mistake, please get in touch with us.',
  BANNED: 'This account has been closed.',
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async register(email: string, password: string, name: string) {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.usersService.create({ email, passwordHash, name });
    const tokens = await this.tokensService.issueTokenPair(user.id, user.email);
    return { user, tokens };
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  /**
   * Issues a session — unless the account is suspended or closed. Checked
   * after the password (or OAuth identity) has been proven, so the message
   * can't be used to probe which email addresses are restricted.
   */
  async login(user: User) {
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(RESTRICTED_ACCOUNT_MESSAGES[user.accountStatus]);
    }
    const tokens = await this.tokensService.issueTokenPair(user.id, user.email);
    return { user, tokens };
  }

  async refresh(rawRefreshToken: string) {
    const record = await this.tokensService.verifyRefreshToken(rawRefreshToken);
    const user = await this.usersService.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    // A restricted account can't extend its session. 401, like any refresh
    // that fails, so the client simply ends the session and shows the login
    // page, where signing in explains what's happened.
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('This account is not available');
    }
    const tokens = await this.tokensService.issueTokenPair(user.id, user.email, record.id);
    return { user, tokens };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokensService.revokeRefreshToken(rawRefreshToken);
  }

  /**
   * Finds-or-creates a user for an OAuth login (Google/Apple). OAuth-only
   * accounts have no passwordHash — email/password login stays unavailable
   * for them unless they later set one.
   */
  async findOrCreateOAuthUser(params: {
    provider: string;
    providerAccountId: string;
    email: string;
    name: string;
  }) {
    const existingLink = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: params.provider,
          providerAccountId: params.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (existingLink) {
      return existingLink.user;
    }

    const user =
      (await this.usersService.findByEmail(params.email)) ??
      (await this.usersService.create({
        email: params.email,
        passwordHash: null,
        name: params.name,
      }));

    await this.prisma.oAuthAccount.create({
      data: {
        provider: params.provider,
        providerAccountId: params.providerAccountId,
        userId: user.id,
      },
    });

    return user;
  }
}
