'use client';

import { useState } from 'react';
import { ApiError, resendVerificationEmail } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ErrorText } from '@/components/form-controls';

/** A reminder, shown until the person has followed the link we emailed them. */
export function EmailVerification() {
  const { user, refreshUser } = useAuth();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.emailVerifiedAt) return null;

  async function handleResend() {
    setError(null);
    setSending(true);
    try {
      const { alreadyVerified } = await resendVerificationEmail();
      if (alreadyVerified) await refreshUser();
      else setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that — try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-accent-2/40 bg-accent-2/10 p-4 text-sm">
      <p className="font-medium">Please confirm your email address</p>
      <p className="mt-1 text-foreground/70">
        We sent a link to <strong className="text-foreground">{user.email}</strong>. Confirming it lets us reach you if you
        ever forget your password.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={handleResend}
          disabled={sending || sent}
          className="rounded-full border border-line px-4 py-1.5 text-foreground/80 hover:border-accent/50 hover:text-foreground disabled:opacity-50"
        >
          {sending ? 'Sending…' : sent ? 'Sent — check your inbox' : 'Resend email'}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
