'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, verifyEmailToken } from '@/lib/api';
import { tokenFromFragment } from '@/lib/token-fragment';

type Stage = 'verifying' | 'done' | 'failed' | 'no-link';

export default function VerifyEmailPage() {
  const [stage, setStage] = useState<Stage>('verifying');
  const [message, setMessage] = useState<string | null>(null);
  // The link works exactly once, and React runs effects twice in development: without
  // this the second run would spend an already-used link and report a failure.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFromFragment(window.location.hash);
    if (!token) {
      void Promise.resolve().then(() => setStage('no-link'));
      return;
    }
    window.history.replaceState(null, '', window.location.pathname);
    verifyEmailToken(token)
      .then(() => setStage('done'))
      .catch((err) => {
        setMessage(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
        setStage('failed');
      });
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      {stage === 'verifying' && <p className="text-sm text-foreground/60">Confirming your email…</p>}

      {stage === 'done' && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Email confirmed</h1>
          <p className="mt-3 text-sm text-foreground/70">Thanks — your email address is verified.</p>
          <Link href="/profile" className="mt-6 text-sm text-accent hover:underline">
            Go to your profile
          </Link>
        </>
      )}

      {stage === 'failed' && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t confirm that</h1>
          <p className="mt-3 text-sm text-foreground/70">{message}</p>
          <p className="mt-3 text-sm text-foreground/70">
            Log in and use &ldquo;Resend email&rdquo; on your profile to get a fresh link.
          </p>
          <Link href="/profile" className="mt-6 text-sm text-accent hover:underline">
            Go to your profile
          </Link>
        </>
      )}

      {stage === 'no-link' && (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
          <p className="mt-3 text-sm text-foreground/70">Open the link from your email again, exactly as it was sent.</p>
          <Link href="/profile" className="mt-6 text-sm text-accent hover:underline">
            Go to your profile
          </Link>
        </>
      )}
    </main>
  );
}
