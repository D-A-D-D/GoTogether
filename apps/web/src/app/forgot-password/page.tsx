'use client';

import { useState, type FormEvent } from 'react';
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
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm text-foreground/70">
          If there&apos;s an account for <strong className="text-foreground">{sentTo}</strong>, we&apos;ve sent a link to
          choose a new password. It works once and expires in an hour.
        </p>
        <p className="mt-3 text-sm text-foreground/70">
          Nothing arrived? Look in your spam folder, and check the address is spelled the way you signed up.
        </p>
        <Link href="/login" className="mt-6 text-sm text-accent hover:underline">
          Back to log in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mt-2 text-sm text-foreground/70">Enter your email and we&apos;ll send you a link to choose a new one.</p>

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

      <p className="mt-6 text-center text-sm text-foreground/70">
        Remembered it?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
