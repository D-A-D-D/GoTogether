'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function SiteHeader() {
  const { user, status, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-mono text-sm font-bold uppercase tracking-widest text-accent">
          GoTogether
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          {status === 'authenticated' && (
            <>
              <Link href="/profile" className="text-foreground/70 hover:text-foreground">
                {user?.name}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-line px-3 py-1.5 text-foreground/70 hover:text-foreground"
              >
                Log out
              </button>
            </>
          )}

          {status === 'unauthenticated' && (
            <>
              <Link href="/login" className="text-foreground/70 hover:text-foreground">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-accent px-4 py-1.5 font-medium text-background hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
