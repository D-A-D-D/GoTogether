'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import Link from 'next/link';
import { ApiError, resetPassword } from '@/lib/api';
import { tokenFromFragment } from '@/lib/token-fragment';
import { useHydrated } from '@/lib/use-hydrated';
import { Label, TextInput, ErrorText, PrimaryButton } from '@/components/form-controls';

type Stage = 'reading' | 'ready' | 'no-link' | 'done';

export default function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>('reading');
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkIsBad, setLinkIsBad] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useHydrated();
  // The token, once read. Kept in a ref as well as state because React runs effects twice in
  // development: the first run takes the token out of the address bar (below), so the second
  // would find nothing and must not conclude the link was incomplete.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    function read(initial: boolean) {
      const found = tokenFromFragment(window.location.hash);
      if (found) {
        tokenRef.current = found;
        setToken(found);
        setStage('ready');
        // The token has served its purpose in the address bar: take it out, so it
        // isn't left in the history, a screenshot or a shared tab.
        window.history.replaceState(null, '', window.location.pathname);
      } else if (initial && !tokenRef.current) {
        setStage('no-link');
      }
    }
    // Deferred a microtask so setState never happens synchronously within the
    // effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => read(true));
    // Pasting a link into a tab that is already on this page only changes the hash: no reload.
    const onHashChange = () => read(false);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= 8 && password.length <= 72 && password === confirm;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !token || submitting) return;
    setError(null);
    setLinkIsBad(false);
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setStage('done');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setLinkIsBad(true);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === 'reading') return null;

  if (stage === 'no-link') {
    return (
      <AuthLayout>
        <h1 className="text-3xl font-bold leading-tight">This link is incomplete</h1>
        <p className="mt-3 text-base text-muted">
          Open the link from your email again, exactly as it was sent — or ask for a new one.
        </p>
        <Link href="/forgot-password" className="mt-6 font-semibold text-accent-ink underline-offset-4 hover:underline">
          Send me a new link
        </Link>
      </AuthLayout>
    );
  }

  if (stage === 'done') {
    return (
      <AuthLayout>
        <h1 className="text-3xl font-bold leading-tight">Password changed</h1>
        <p className="mt-3 text-base text-muted">
          You&apos;ve been signed out everywhere, so log in with your new password.
        </p>
        <Link href="/login" className="mt-6 font-semibold text-accent-ink underline-offset-4 hover:underline">
          Log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-3xl font-bold leading-tight">Choose a new password</h1>

      <form method="post" onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <TextInput
            id="new-password"
            type="password"
            required
            autoComplete="new-password"
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {tooShort && <p className="text-[0.85rem] text-muted">At least 8 characters.</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password">Type it again</Label>
          <TextInput
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            maxLength={72}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && <p className="text-[0.85rem] text-muted">These don&apos;t match yet.</p>}
        </div>

        <ErrorText>{error}</ErrorText>
        {linkIsBad && (
          <Link href="/forgot-password" className="font-semibold text-accent-ink underline-offset-4 hover:underline">
            Send me a new link
          </Link>
        )}

        <PrimaryButton type="submit" disabled={!valid || submitting || !hydrated} className="mt-2">
          {submitting ? 'Saving…' : 'Change password'}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
