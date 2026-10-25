'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError, resetPassword } from '@/lib/api';
import { tokenFromFragment } from '@/lib/token-fragment';
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
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
        <p className="mt-3 text-sm text-foreground/70">
          Open the link from your email again, exactly as it was sent — or ask for a new one.
        </p>
        <Link href="/forgot-password" className="mt-6 text-sm text-accent hover:underline">
          Send me a new link
        </Link>
      </main>
    );
  }

  if (stage === 'done') {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Password changed</h1>
        <p className="mt-3 text-sm text-foreground/70">
          You&apos;ve been signed out everywhere, so log in with your new password.
        </p>
        <Link href="/login" className="mt-6 text-sm text-accent hover:underline">
          Log in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
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
          {tooShort && <p className="text-xs text-foreground/60">At least 8 characters.</p>}
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
          {mismatch && <p className="text-xs text-foreground/60">These don&apos;t match yet.</p>}
        </div>

        <ErrorText>{error}</ErrorText>
        {linkIsBad && (
          <Link href="/forgot-password" className="text-sm text-accent hover:underline">
            Send me a new link
          </Link>
        )}

        <PrimaryButton type="submit" disabled={!valid || submitting} className="mt-2">
          {submitting ? 'Saving…' : 'Change password'}
        </PrimaryButton>
      </form>
    </main>
  );
}
