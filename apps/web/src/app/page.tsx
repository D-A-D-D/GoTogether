'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { HealthStatus } from '@/components/health-status';

export default function Home() {
  const { user, status } = useAuth();

  if (status === 'authenticated') {
    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-24 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Welcome back</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Hey, {user?.name}.</h1>
        <p className="max-w-md text-base text-foreground/70">
          Chat and expenses are still on the way — discovery, hosting, and your trips are real now.
        </p>
        <div className="flex items-center gap-3">
          <Link
            href="/trips/discover"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
          >
            Discover trips
          </Link>
          <Link href="/trips/mine" className="text-sm text-foreground/70 hover:text-foreground">
            Your trips
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-accent">GoTogether</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Travel together, not alone.
      </h1>
      <p className="max-w-md text-base text-foreground/70">
        Find compatible travel companions, host or join trips, and build trust as you go — one
        real trip at a time.
      </p>
      {status === 'unauthenticated' && (
        <div className="flex items-center gap-3">
          <Link
            href="/register"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
          >
            Get started
          </Link>
          <Link href="/login" className="text-sm text-foreground/70 hover:text-foreground">
            Log in
          </Link>
        </div>
      )}
      <HealthStatus />
    </main>
  );
}
