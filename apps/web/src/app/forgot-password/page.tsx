'use client';

import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import Link from 'next/link';
import { ApiError, requestPasswordReset } from '@/lib/api';
import { useHydrated } from '@/lib/use-hydrated';
import { Label, TextInput, ErrorText, PrimaryButton } from '@/components/form-controls';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useHydrated();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout>
        <h1 className="text-3xl font-bold leading-tight">Check your email</h1>
        <p className="mt-3 text-base text-muted">
          If there&apos;s an account for <strong className="text-foreground">{sentTo}</strong>, we&apos;ve sent a link to
          choose a new password. It works once and expires in an hour.
        </p>
        <p className="mt-3 text-base text-muted">
          Nothing arrived? Look in your spam folder, and check the address is spelled the way you signed up.
        </p>
        <Link href="/login" className="mt-6 font-semibold text-accent underline-offset-4 hover:underline">
          Back to log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-3xl font-bold leading-tight">Forgot your password?</h1>
      <p className="mt-2 text-base text-muted">Enter your email and we&apos;ll send you a link to choose a new one.</p>

      <form method="post" onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <TextInput
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <ErrorText>{error}</ErrorText>

        <PrimaryButton type="submit" disabled={submitting || !hydrated || !email.trim()} className="mt-2">
          {submitting ? 'Sending…' : 'Send me a link'}
        </PrimaryButton>
      </form>

      <p className="mt-6 text-center text-[0.95rem] text-muted">
        Remembered it?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
