'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// The API's Google OAuth callback redirects here with the access token in
// the URL fragment (never the query string, so it never reaches server
// logs) — read it once, hand it to AuthProvider, then drop it from the URL.
export default function AuthCallbackPage() {
  const { completeWithToken } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Every setState below happens after this microtask, never
    // synchronously within the effect body itself (react-hooks/set-state-in-effect).
    void Promise.resolve().then(async () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('accessToken');
      if (!token) {
        setError('No access token in the redirect — try signing in again.');
        return;
      }
      try {
        await completeWithToken(token);
        router.replace('/profile');
      } catch {
        setError('Could not complete sign-in — try again.');
      }
    });
  }, [completeWithToken, router]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <p className="text-sm text-foreground/70">Signing you in…</p>
      )}
    </main>
  );
}
