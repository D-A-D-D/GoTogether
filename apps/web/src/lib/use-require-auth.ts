'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/** Redirects to /login once we know for sure the session isn't valid — never during the initial 'loading' check. */
export function useRequireAuth() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  return status;
}
