'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Landing } from '@/components/landing';

export default function Home() {
  const { status } = useAuth();
  const router = useRouter();

  // Someone signed in has no use for a front page: take them to the trips.
  useEffect(() => {
    if (status === 'authenticated') router.replace('/trips/discover');
  }, [status, router]);

  if (status === 'authenticated') return null;
  return <Landing />;
}
