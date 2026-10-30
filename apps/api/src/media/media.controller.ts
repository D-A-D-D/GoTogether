import { BadRequestException, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard.js';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator.js';
import { uploadedBytes } from '../common/raw-media.js';
import { LIMITS } from '../common/throttle-limits.js';
import { MediaService, type ServedMedia } from './media.service.js';

/**
 * Sends a stored file. The headers matter as much as the bytes: the type is the one we found by looking at
 * the file, `nosniff` stops a browser second-guessing it, and the sandbox policy means that even if someone
 * opened this address directly, nothing in the file could run. The file never changes under its address, so
 * it can be kept; "private" keeps shared caches from holding someone's photo.
 */
function send(res: Response, media: ServedMedia): void {
  res.set({
    'Content-Type': media.mime,
    'Content-Length': String(media.data.length),
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.end(media.data);
}

@Controller()
@UseGuards(JwtAccessGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** The file itself is the request body (see common/raw-media.ts), not a multipart form. */
  @Put('users/me/avatar')
  @Throttle({ default: LIMITS.upload })
  setAvatar(@CurrentUser() user: RequestUser, @Req() req: { body?: unknown }) {
    const body = uploadedBytes(req);
    if (!body) throw new BadRequestException('No picture was sent');
    return this.media.setAvatar(user.userId, body);
  }

  @Delete('users/me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAvatar(@CurrentUser() user: RequestUser) {
    return this.media.removeAvatar(user.userId);
  }

  @Get('users/:id/avatar')
  async avatar(@CurrentUser() user: RequestUser, @Param('id') id: string, @Res() res: Response) {
    send(res, await this.media.getAvatar(user.userId, id));
  }

  /** Uploads a picture or voice note for a trip's chat; send it with a message to share it. */
  @Post('trips/:tripId/media')
  @Throttle({ default: LIMITS.upload })
  upload(
    @CurrentUser() user: RequestUser,
    @Param('tripId') tripId: string,
    @Req() req: { body?: unknown },
    @Headers('x-duration-ms') duration?: string,
  ) {
    const body = uploadedBytes(req);
    if (!body) throw new BadRequestException('No file was sent');
    return this.media.storeChatMedia(user.userId, tripId, body, duration ? Number(duration) : undefined);
  }

  @Get('media/:id')
  async file(@CurrentUser() user: RequestUser, @Param('id') id: string, @Res() res: Response) {
    send(res, await this.media.getChatMedia(user.userId, id));
  }
}
