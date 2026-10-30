'use client';

import { useState } from 'react';
import { ApiError, resendVerificationEmail } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ErrorText } from '@/components/form-controls';
import { Button } from '@/components/ui';

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
    <div className="mb-6 rounded-2xl border-2 border-gold bg-gold/15 p-4">
      <p className="text-lg font-bold">Please confirm your email address</p>
      <p className="mt-1 text-muted">
        We sent a link to <strong className="text-foreground">{user.email}</strong>. Confirming it lets us reach you if you
        ever forget your password.
      </p>
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={handleResend} disabled={sending || sent}>
          {sending ? 'Sending…' : sent ? 'Sent — check your inbox' : 'Resend email'}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
