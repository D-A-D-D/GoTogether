'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { activeTab, createVisitStack, routeMeta } from '@/lib/nav';
import { ButtonLink, IconButton } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { SiteFooter } from '@/components/site-footer';
import {
  IconBack,
  IconBag,
  IconCompass,
  IconLogout,
  IconPlus,
  IconSettings,
  IconShield,
  IconUser,
  LogoMark,
} from '@/components/icons';

// Screens visited in this session, so Back can go back through them when there is somewhere to go,
// and to the screen's parent when there is not (someone who landed from a link or a notification).
const visits = createVisitStack();

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-accent-ink ${className}`}>
      <LogoMark size={26} />
      <span className="font-display text-[1.35rem] font-bold tracking-tight text-foreground">GoTogether</span>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, status, logout } = useAuth();
  const meta = routeMeta(pathname);
  const authed = status === 'authenticated';
  const current = activeTab(pathname);
  const showTabs = authed && !meta.immersive;

  useEffect(() => {
    const onPop = () => visits.markPop();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => visits.visit(pathname), [pathname]);

  function goBack() {
    if (visits.canGoBack()) router.back();
    else router.push(meta.back ?? '/');
  }

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Desktop: a rail down the left, as on Instagram. */}
      {authed && (
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 md:flex">
          <Link href="/trips/discover" className="px-3 pb-6" aria-label="GoTogether home">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
            <RailLink href="/trips/discover" label="Discover" active={current === 'discover'} icon={<IconCompass size={26} />} />
            <RailLink href="/trips/mine" label="My trips" active={current === 'mine'} icon={<IconBag size={26} />} />
            <RailLink href="/profile" label="Profile" active={pathname === '/profile'} icon={<IconUser size={26} />} />
            <RailLink href="/settings" label="Settings" active={pathname.startsWith('/settings')} icon={<IconSettings size={26} />} />
            {user?.role === 'ADMIN' && (
              <RailLink href="/admin" label="Admin" active={pathname === '/admin'} icon={<IconShield size={26} />} />
            )}
            <ButtonLink href="/trips/new" size="lg" block className="mt-4">
              <IconPlus size={22} />
              Host a trip
            </ButtonLink>
          </nav>
          <div className="flex items-center gap-3 border-t border-line px-2 pt-4">
            {user && <UserAvatar user={user} size={40} />}
            <span className="min-w-0 flex-1 truncate font-medium">{user?.name}</span>
            <IconButton label="Log out" onClick={handleLogout}>
              <IconLogout size={22} />
            </IconButton>
          </div>
        </aside>
      )}

      <div className={`flex min-h-dvh flex-1 flex-col ${authed ? 'md:pl-64' : ''}`}>
        {/* Top bar: Back on every screen that is not a main tab. */}
        <header className="sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur pt-safe">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-1 px-3 sm:px-4">
            {meta.tab ? (
              <Link href={authed ? '/trips/discover' : '/'} className={`mr-1 ${authed ? 'md:hidden' : ''}`} aria-label="GoTogether home">
                {authed ? <LogoMark size={30} className="text-accent-ink" /> : <Wordmark />}
              </Link>
            ) : (
              <IconButton label="Back" onClick={goBack} className="-ml-1">
                <IconBack size={26} />
              </IconButton>
            )}
            {meta.title && (
              <p className={`min-w-0 flex-1 truncate font-display text-xl font-bold ${meta.tab && !authed ? 'sr-only' : ''}`}>
                {meta.title}
              </p>
            )}
            {!meta.title && <span className="flex-1" />}
            {authed && <ThemeToggle />}
            {authed && pathname === '/profile' && (
              <Link
                href="/settings"
                aria-label="Settings"
                title="Settings"
                className="pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-surface-2"
              >
                <IconSettings size={24} />
              </Link>
            )}
            {status === 'unauthenticated' && (
              <nav aria-label="Account" className="flex items-center gap-1.5">
                {pathname !== '/login' && (
                  <ButtonLink href="/login" variant="ghost" size="sm">
                    Log in
                  </ButtonLink>
                )}
                {pathname !== '/register' && (
                  <ButtonLink href="/register" size="sm">
                    Sign up
                  </ButtonLink>
                )}
              </nav>
            )}
          </div>
        </header>

        <div className={`flex flex-1 flex-col ${showTabs ? 'pb-24 md:pb-0' : ''}`}>
          {children}
          {!meta.immersive && <SiteFooter />}
        </div>
      </div>

      {/* Mobile: tabs along the bottom, within thumb reach. Labelled, because an icon alone is a guess. */}
      {showTabs && (
        <nav
          aria-label="Main"
          className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        >
          <ul className="mx-auto grid max-w-md grid-cols-4">
            <TabLink href="/trips/discover" label="Discover" active={current === 'discover'} icon={<IconCompass />} />
            <TabLink href="/trips/mine" label="My trips" active={current === 'mine'} icon={<IconBag />} />
            <TabLink
              href="/trips/new"
              label="Host"
              active={current === 'new'}
              icon={
                <span className="flex h-9 w-12 items-center justify-center rounded-full bg-accent text-on-accent">
                  <IconPlus size={22} />
                </span>
              }
            />
            <TabLink href="/profile" label="Profile" active={current === 'profile'} icon={<IconUser />} />
          </ul>
        </nav>
      )}
    </div>
  );
}

function RailLink({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`pressable flex h-12 items-center gap-4 rounded-xl px-3 text-lg ${
        active ? 'bg-accent-soft font-bold text-accent-ink' : 'font-medium hover:bg-surface-2'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function TabLink({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`pressable flex h-16 flex-col items-center justify-center gap-0.5 text-[0.8rem] ${
          active ? 'font-bold text-accent-ink' : 'font-medium text-muted'
        }`}
      >
        {icon}
        {label}
      </Link>
    </li>
  );
}
