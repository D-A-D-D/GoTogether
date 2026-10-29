'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { useHydrated } from '@/lib/use-hydrated';
import { Label, TextInput, ErrorText, PrimaryButton } from '@/components/form-controls';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useHydrated();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, name);
      router.push('/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-foreground/70">
        Start at trust score 50 — it builds as you complete trips and get reviewed.
      </p>

      <form method="post" onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <TextInput
            id="name"
            name="name"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <TextInput
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <ErrorText>{error}</ErrorText>

        <PrimaryButton type="submit" disabled={submitting || !hydrated} className="mt-2">
          {submitting ? 'Creating account…' : 'Create account'}
        </PrimaryButton>
      </form>

      <p className="mt-4 text-center text-xs text-foreground/60">
        By signing up you agree to the{' '}
        <Link href="/terms" className="underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="mt-6 text-center text-sm text-foreground/70">
        Already have an account?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
