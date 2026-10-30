import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlocksService } from '../safety/blocks.service.js';
import { AccountStatus, MediaKind, MembershipStatus } from '../generated/prisma/index.js';
import { sniffMedia } from '../common/media-sniff.js';
import { HOUR_MS, MINUTE_MS, TOO_MANY_REQUESTS } from '../common/throttle-limits.js';
import { RateWindow } from '../common/rate-window.js';

/** What may be uploaded. Generous enough for a phone photo that the app has already shrunk; no more. */
export const MEDIA_LIMITS = {
  avatarMaxBytes: 1_500_000,
  avatarMaxPixels: 4096,
  imageMaxBytes: 4_000_000,
  imageMaxPixels: 8192,
  voiceMaxBytes: 4_000_000,
  voiceMaxDurationMs: 180_000,
  /** Chat pictures and voice notes one person may upload in ten minutes. */
  chatUploads: { limit: 20, windowMs: 10 * MINUTE_MS },
  /** Profile pictures one person may set in an hour. */
  avatarChanges: { limit: 10, windowMs: HOUR_MS },
} as const;

export interface StoredMedia {
  id: string;
  kind: MediaKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface ServedMedia {
  mime: string;
  data: Buffer;
}

const NOT_FOUND = 'Not found';

/** Prisma stores bytes from a plain Uint8Array; a Buffer is one, but typed more loosely. */
const asBytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(buffer);

/**
 * Profile pictures and the pictures and voice notes sent in trip chats.
 *
 * Three rules run through all of it. What a file IS is decided by its bytes, never by the uploader's claim
 * (common/media-sniff.ts). Who may SEE it is decided by the same rules as the thing it belongs to: a chat
 * file only by people on that trip and not blocked with the sender, a picture only by signed-in people not
 * blocked with its owner - and everyone else is told "not found", not "forbidden", so nothing is revealed.
 * And uploads are capped by size, by picture dimensions and by rate.
 */
@Injectable()
export class MediaService {
  private readonly chatUploads = new RateWindow(MEDIA_LIMITS.chatUploads.limit, MEDIA_LIMITS.chatUploads.windowMs);
  private readonly avatarChanges = new RateWindow(MEDIA_LIMITS.avatarChanges.limit, MEDIA_LIMITS.avatarChanges.windowMs);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
  ) {}

  private tooFast(): never {
    throw new HttpException(TOO_MANY_REQUESTS, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** A picture: right kind, small enough in bytes, and not enormous in pixels. */
  private checkPicture(body: Buffer, maxBytes: number, maxPixels: number) {
    if (body.length > maxBytes) throw new PayloadTooLargeException(`That picture is too large (the limit is ${Math.round(maxBytes / 1_000_000 * 10) / 10} MB).`);
    const found = sniffMedia(body);
    if (!found || found.family !== 'image') {
      throw new BadRequestException('That does not look like a picture we can use. Please choose a JPEG, PNG or WebP image.');
    }
    if (found.width > maxPixels || found.height > maxPixels) {
      throw new PayloadTooLargeException(`That picture is too large (the limit is ${maxPixels} pixels on a side).`);
    }
    return found;
  }

  // ---------------------------------------------------------------- profile pictures

  async setAvatar(userId: string, body: Buffer): Promise<{ avatarUpdatedAt: Date }> {
    if (this.avatarChanges.isFull(userId)) this.tooFast();
    const picture = this.checkPicture(body, MEDIA_LIMITS.avatarMaxBytes, MEDIA_LIMITS.avatarMaxPixels);
    this.avatarChanges.record(userId);

    const previous = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarMediaId: true } });
    const avatarUpdatedAt = new Date();
    const created = await this.prisma.media.create({
      data: {
        ownerId: userId,
        kind: MediaKind.AVATAR,
        mime: picture.mime,
        size: body.length,
        width: picture.width,
        height: picture.height,
        data: asBytes(body),
      },
      select: { id: true },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { avatarMediaId: created.id, avatarUpdatedAt } });
    // The old one only after the person points at the new one, so there is never a moment with neither.
    if (previous?.avatarMediaId) await this.prisma.media.deleteMany({ where: { id: previous.avatarMediaId, ownerId: userId } });
    return { avatarUpdatedAt };
  }

  async removeAvatar(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarMediaId: true } });
    await this.prisma.user.update({ where: { id: userId }, data: { avatarMediaId: null, avatarUpdatedAt: null } });
    if (user?.avatarMediaId) await this.prisma.media.deleteMany({ where: { id: user.avatarMediaId, ownerId: userId } });
  }

  /** Someone's picture, for another signed-in person - unless they are blocked with each other or the account is closed. */
  async getAvatar(viewerId: string, targetId: string): Promise<ServedMedia> {
    const own = viewerId === targetId;
    const [target, blocked] = await Promise.all([
      this.prisma.user.findUnique({
        relationLoadStrategy: 'join',
        where: { id: targetId },
        select: { accountStatus: true, avatar: { select: { mime: true, data: true } } },
      }),
      own ? Promise.resolve(false) : this.blocks.areBlocked(viewerId, targetId),
    ]);
    if (!target?.avatar || blocked || (!own && target.accountStatus !== AccountStatus.ACTIVE)) throw new NotFoundException(NOT_FOUND);
    return { mime: target.avatar.mime, data: Buffer.from(target.avatar.data) };
  }

  // ---------------------------------------------------------------- chat pictures and voice notes

  /** Stores a picture or voice note for a trip's chat; it is attached to a message afterwards, by sending that message. */
  async storeChatMedia(userId: string, tripId: string, body: Buffer, claimedDurationMs?: number): Promise<StoredMedia> {
    if (this.chatUploads.isFull(userId)) this.tooFast();
    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId } },
      select: { status: true },
    });
    if (membership?.status !== MembershipStatus.APPROVED) {
      throw new ForbiddenException('Only approved trip members can send pictures or voice notes');
    }

    const largest = Math.max(MEDIA_LIMITS.imageMaxBytes, MEDIA_LIMITS.voiceMaxBytes);
    if (body.length > largest) throw new PayloadTooLargeException('That file is too large.');
    const found = sniffMedia(body);
    if (!found) throw new BadRequestException('That file type is not supported. Send a JPEG, PNG or WebP picture, or a voice recording.');

    let data: { kind: MediaKind; width: number | null; height: number | null; durationMs: number | null };
    if (found.family === 'image') {
      this.checkPicture(body, MEDIA_LIMITS.imageMaxBytes, MEDIA_LIMITS.imageMaxPixels);
      data = { kind: MediaKind.CHAT_IMAGE, width: found.width, height: found.height, durationMs: null };
    } else {
      if (body.length > MEDIA_LIMITS.voiceMaxBytes) throw new PayloadTooLargeException('That voice note is too long.');
      // The length is the app's own count of how long it recorded. It only decides what is shown, so it is
      // clamped rather than trusted: nobody can make a voice note claim to be a week long.
      const ms = Number.isFinite(claimedDurationMs) ? Math.round(claimedDurationMs as number) : 0;
      data = { kind: MediaKind.CHAT_VOICE, width: null, height: null, durationMs: Math.min(Math.max(ms, 0), MEDIA_LIMITS.voiceMaxDurationMs) };
    }

    this.chatUploads.record(userId);
    return this.prisma.media.create({
      data: { ownerId: userId, tripId, mime: found.mime, size: body.length, ...data, data: asBytes(body) },
      select: { id: true, kind: true, mime: true, size: true, width: true, height: true, durationMs: true },
    });
  }

  /** A chat file, for the people who may see the message it belongs to. */
  async getChatMedia(viewerId: string, mediaId: string): Promise<ServedMedia> {
    const media = await this.prisma.media.findUnique({
      relationLoadStrategy: 'join',
      where: { id: mediaId },
      select: {
        ownerId: true,
        kind: true,
        mime: true,
        data: true,
        tripId: true,
        message: { select: { senderId: true, room: { select: { tripId: true } } } },
      },
    });
    // Avatars are served by their own route only, so one rule covers each kind of file.
    if (!media || media.kind === MediaKind.AVATAR) throw new NotFoundException(NOT_FOUND);

    const serve = (): ServedMedia => ({ mime: media.mime, data: Buffer.from(media.data) });
    // Not yet sent in a message: only the person who uploaded it can see it (they are previewing it).
    if (!media.message) {
      if (media.ownerId === viewerId) return serve();
      throw new NotFoundException(NOT_FOUND);
    }
    if (media.message.senderId === viewerId) return serve();

    const tripId = media.message.room.tripId;
    const [membership, blocked] = await Promise.all([
      this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId: viewerId } }, select: { status: true } }),
      this.blocks.areBlocked(viewerId, media.message.senderId),
    ]);
    if (membership?.status !== MembershipStatus.APPROVED || blocked) throw new NotFoundException(NOT_FOUND);
    return serve();
  }
}
