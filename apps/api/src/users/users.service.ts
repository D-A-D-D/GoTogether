import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { User } from '../generated/prisma/index.js';

export type PublicUser = Omit<User, 'passwordHash' | 'homeLat' | 'homeLng'> & { hasPassword: boolean };

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByIdWithTags(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { preferenceTags: true },
    });
  }

  create(data: { email: string; passwordHash: string | null; name: string; emailVerifiedAt?: Date }) {
    return this.prisma.user.create({ data });
  }

  updateProfile(
    id: string,
    data: {
      name?: string;
      bio?: string;
      homeCity?: string;
      homeRegion?: string;
      preferenceTagIds?: string[];
    },
  ) {
    const { preferenceTagIds, ...rest } = data;
    return this.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(preferenceTagIds
          ? { preferenceTags: { set: preferenceTagIds.map((tagId) => ({ id: tagId })) } }
          : {}),
      },
      include: { preferenceTags: true },
    });
  }

  /**
   * Strips fields that must never leave the server: password hash and the
   * precise geocode used internally by the matching engine's location
   * factor (docs/BLUEPRINT.md section 09 - only city/region-level location is
   * ever returned to a client). `hasPassword` says whether the account has
   * one at all (a Google-only account doesn't) without revealing the hash;
   * deleting an account asks for the password, or the email if there isn't one.
   */
  toPublicProfile<T extends { passwordHash?: unknown; homeLat?: unknown; homeLng?: unknown }>(
    user: T,
  ): Omit<T, 'passwordHash' | 'homeLat' | 'homeLng'> & { hasPassword: boolean } {
    const { passwordHash, homeLat: _homeLat, homeLng: _homeLng, ...rest } = user;
    return { ...rest, hasPassword: Boolean(passwordHash) };
  }
}
