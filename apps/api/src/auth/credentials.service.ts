import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { RateWindow } from '../common/rate-window.js';
import { AccountStatus, EmailTokenPurpose } from '../generated/prisma/index.js';
import { passwordResetEmail, tokenLink, verificationEmail, type EmailMessage } from '../email/email-templates.js';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  EMAILS_PER_HOUR,
  RESET_TTL_MS,
  VERIFICATION_TTL_MS,
  generateEmailToken,
  hashEmailToken,
} from './email-tokens.js';
import { LoginAttemptsService } from './login-attempts.service.js';

const BCRYPT_ROUNDS = 12;
const HOUR_MS = 60 * 60_000;

/** One answer for every way a link can be unusable, so nothing is learned from which it was. */
export const INVALID_LINK = 'This link is invalid or has expired. Please ask for a new one.';

/**
 * Forgotten passwords and email verification - the two things a person does with
 * a link we email them. The rules that matter:
 *
 * - A link works once, and only for an hour (reset) or a day (verify). Only its
 *   hash is stored.
 * - Asking for a reset says the same thing whether or not the address has an
 *   account, and the email is sent in the background, so neither the reply nor
 *   how long it took reveals who has an account here.
 * - A successful reset signs the account out everywhere and lifts any
 *   failed-sign-in lock - the person has just proved who they are.
 * - Suspended, closed and deleted accounts get nothing and can't use a link.
 */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);
  /** Emails sent per address and kind, so this can't be used to flood someone's inbox. In memory, per process. */
  private readonly sends = new RateWindow(EMAILS_PER_HOUR, HOUR_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly loginAttempts: LoginAttemptsService,
  ) {}

  // ---------------------------------------------------------------- sending

  /** Creates a token (retiring any earlier unused one of the same kind) and returns the raw value for the email. */
  private async issueToken(userId: string, purpose: EmailTokenPurpose, ttlMs: number): Promise<string> {
    const { raw, hash } = generateEmailToken();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.emailToken.create({ data: { userId, purpose, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) } }),
    ]);
    return raw;
  }

  /** Fire and forget: a failure to send is logged, never thrown, and never makes a reply slower. */
  private deliver(message: EmailMessage): void {
    this.email.send(message).catch((error: Error) => {
      this.logger.error(`Could not send "${message.subject}": ${error.message}`);
    });
  }

  private underCap(kind: string, address: string): boolean {
    const key = `${kind}:${address.trim().toLowerCase()}`;
    if (this.sends.isFull(key)) return false;
    this.sends.record(key);
    return true;
  }

  /**
   * Always resolves, says nothing about whether the address has an account, and takes
   * the same time either way (one lookup). Only an active account gets an email, and
   * only a few an hour.
   */
  async requestPasswordReset(emailAddress: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: emailAddress.trim(), mode: 'insensitive' } },
      select: { id: true, email: true, name: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) return;
    if (!this.underCap('reset', user.email)) return;
    // Writing the token and sending the email happen after the reply. Either would take
    // noticeably longer than "no such account", and a visible difference in how long the
    // answer takes is as good as a different answer.
    this.queueReset(user);
  }

  /** Issues a reset token and emails it, in the background. Failures are logged, not thrown. */
  private queueReset(user: { id: string; email: string; name: string }): void {
    this.issueToken(user.id, EmailTokenPurpose.PASSWORD_RESET, RESET_TTL_MS)
      .then((token) =>
        this.deliver(
          passwordResetEmail({
            to: user.email,
            name: user.name,
            link: tokenLink(this.email.webOrigin, '/reset-password', token),
          }),
        ),
      )
      .catch((error: Error) => this.logger.error(`Could not prepare a password reset email: ${error.message}`));
  }

  /** Issues a verification token and emails it, in the background. Failures are logged, not thrown. */
  private queueVerification(user: { id: string; email: string; name: string }): void {
    this.issueToken(user.id, EmailTokenPurpose.EMAIL_VERIFICATION, VERIFICATION_TTL_MS)
      .then((token) =>
        this.deliver(
          verificationEmail({
            to: user.email,
            name: user.name,
            link: tokenLink(this.email.webOrigin, '/verify-email', token),
          }),
        ),
      )
      .catch((error: Error) => this.logger.error(`Could not prepare a verification email: ${error.message}`));
  }

  /**
   * Emails a link to confirm the address. Used right after sign-up; never throws,
   * so signing up cannot fail because email is down.
   */
  sendVerification(user: { id: string; email: string; name: string; emailVerifiedAt: Date | null }): void {
    if (user.emailVerifiedAt) return;
    if (!this.underCap('verify', user.email)) return;
    this.queueVerification(user);
  }

  /** For a signed-in person who didn't get (or lost) the first one. Tells them if they are already done, or if they've asked too often. */
  async resendVerification(userId: string): Promise<{ alreadyVerified: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });
    if (!user) throw new BadRequestException('Account not found');
    if (user.emailVerifiedAt) return { alreadyVerified: true };
    if (!this.underCap('verify', user.email)) {
      throw new HttpException(
        "We've already sent you a few emails - please check your inbox and spam folder, or try again in an hour.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.queueVerification(user);
    return { alreadyVerified: false };
  }

  // ------------------------------------------------------------ using links

  /**
   * Spends a link: finds it, checks it is the right kind, unused and unexpired,
   * and marks it used in one conditional update, so two people (or two clicks)
   * can never both succeed with the same link.
   */
  private async consume(rawToken: string, purpose: EmailTokenPurpose): Promise<string> {
    const record = await this.prisma.emailToken.findUnique({ where: { tokenHash: hashEmailToken(rawToken) } });
    if (!record || record.purpose !== purpose) throw new BadRequestException(INVALID_LINK);
    const spent = await this.prisma.emailToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (spent.count !== 1) throw new BadRequestException(INVALID_LINK);
    return record.userId;
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const userId = await this.consume(rawToken, EmailTokenPurpose.PASSWORD_RESET);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, accountStatus: true },
    });
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) throw new BadRequestException(INVALID_LINK);

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      // Any other reset link still out there is now pointless.
      this.prisma.emailToken.updateMany({
        where: { userId, purpose: EmailTokenPurpose.PASSWORD_RESET, usedAt: null },
        data: { usedAt: now },
      }),
      // Signed out everywhere: whoever had the old password, or a stolen session, loses it.
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    this.loginAttempts.recordSuccess(user.email);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const userId = await this.consume(rawToken, EmailTokenPurpose.EMAIL_VERIFICATION);
    await this.prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  }
}
