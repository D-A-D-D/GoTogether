import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseTtlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return value * unitMs;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private signAccessToken(userId: string, email: string): string {
    const ttl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    return this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: parseTtlToMs(ttl) / 1000,
      },
    );
  }

  /**
   * Issues a fresh access+refresh pair and persists the refresh token's
   * hash (never the raw token — docs/BLUEPRINT.md §03 RefreshToken model).
   * `replacesTokenId`, when set, closes the loop on the row being rotated
   * out so the chain is auditable.
   */
  async issueTokenPair(userId: string, email: string, replacesTokenId?: string): Promise<TokenPair> {
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d');
    const jti = randomUUID();
    const refreshToken = this.jwt.sign(
      { sub: userId, jti },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: parseTtlToMs(refreshTtl) / 1000,
      },
    );
    const refreshExpiresAt = new Date(Date.now() + parseTtlToMs(refreshTtl));

    const created = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });

    if (replacesTokenId) {
      await this.prisma.refreshToken.update({
        where: { id: replacesTokenId },
        data: { revokedAt: new Date(), replacedBy: created.id },
      });
    }

    return {
      accessToken: this.signAccessToken(userId, email),
      refreshToken,
      refreshExpiresAt,
    };
  }

  /**
   * Verifies a refresh token's signature AND that its hash is still a
   * live, unrevoked row — a token that's valid-but-already-rotated
   * (reused after rotation) is treated as compromised and rejected.
   */
  async verifyRefreshToken(rawToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(rawToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!record || record.revokedAt || record.expiresAt < new Date() || record.userId !== payload.sub) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    return record;
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
