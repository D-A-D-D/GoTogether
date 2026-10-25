import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailMessage } from './email-templates.js';

/**
 * Sends email through the provider named by EMAIL_PROVIDER.
 *
 * - `resend` (required in production, see config/env.ts): Resend's HTTP API.
 *   Needs RESEND_API_KEY and EMAIL_FROM, an address on a domain verified with them.
 * - `log` (the default, for development): prints the message instead, links
 *   included, so a flow can be tried without an account. It must never be used
 *   in production - the log would then hold working reset links.
 *
 * Another provider is one more branch in `send`; nothing else knows which is in use.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  /** The web app's address, for building links in emails. */
  get webOrigin(): string {
    return this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  }

  async send(message: EmailMessage): Promise<void> {
    const provider = this.config.get<string>('EMAIL_PROVIDER', 'log');
    if (provider === 'resend') return this.sendWithResend(message);
    this.logger.warn(`[email:log] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }

  private async sendWithResend(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.getOrThrow<string>('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.getOrThrow<string>('EMAIL_FROM'),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      // A slow provider must not hold a request open indefinitely.
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`Resend rejected the email (${response.status}): ${detail}`);
    }
  }
}
