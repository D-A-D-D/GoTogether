'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { ApiError, updateSettings } from '@/lib/api';
import { invalidateQueries } from '@/lib/query';
import { TEXT_SIZES, THEME_CHOICES, type TextSize, type ThemeChoice } from '@/lib/preferences';
import { usePreferences } from '@/lib/use-preferences';
import { ErrorText } from '@/components/form-controls';
import { Button } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { Segmented, SettingsLink, SettingsSection, SettingsToggle } from '@/components/settings-ui';
import { IconBan, IconBell, IconChevronRight, IconDoubleCheck, IconHistory, IconInfo, IconLogout, IconMoon, IconSun, IconUser } from '@/components/icons';

const THEME_ICONS: Record<ThemeChoice, ReactNode> = {
  system: null,
  light: <IconSun size={18} />,
  dark: <IconMoon size={18} />,
};

export default function SettingsPage() {
  const status = useRequireAuth();
  const { user, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [prefs, updatePrefs] = usePreferences();
  // What the switch shows while a change is being saved, so it answers at once.
  const [pendingReceipts, setPendingReceipts] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'authenticated' || !user) return null;

  async function setReadReceipts(next: boolean) {
    setError(null);
    setPendingReceipts(next);
    try {
      await updateSettings({ readReceipts: next });
      await refreshUser();
      invalidateQueries('me');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that. Please try again.');
    } finally {
      setPendingReceipts(null);
    }
  }

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  const receipts = pendingReceipts ?? user.readReceipts;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-4">
      <h1 className="sr-only">Settings</h1>

      <Link href="/profile" className="pressable flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <UserAvatar user={user} size={60} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-xl font-bold leading-tight">{user.name}</span>
          <span className="block truncate text-muted">{user.email}</span>
          <span className="mt-0.5 block text-[0.9rem] font-semibold text-accent-ink">Edit profile and photo</span>
        </span>
        <IconChevronRight size={20} className="shrink-0 text-muted" />
      </Link>

      <SettingsSection title="Appearance" footnote="Appearance is saved on this device only.">
        <div className="flex flex-col gap-3 p-4">
          <p className="font-semibold">Theme</p>
          <Segmented<ThemeChoice>
            label="Theme"
            value={prefs.theme}
            options={THEME_CHOICES.map((c) => ({ ...c, icon: THEME_ICONS[c.value] }))}
            onChange={(theme) => updatePrefs({ theme })}
          />
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="font-semibold">Text size</p>
          <Segmented<TextSize> label="Text size" value={prefs.textSize} options={TEXT_SIZES} onChange={(textSize) => updatePrefs({ textSize })} />
          <p className="rounded-xl bg-surface-2 px-4 py-3">This is how text will look in the app. A trip to the hills, a plan for the weekend.</p>
        </div>
        <SettingsToggle
          label="Reduce motion"
          description="Fewer animations and transitions."
          checked={prefs.reduceMotion}
          onChange={(reduceMotion) => updatePrefs({ reduceMotion })}
        />
      </SettingsSection>

      <SettingsSection title="Privacy" footnote="Read receipts work both ways: if you switch them off you will not see when others have read the chat either.">
        <SettingsToggle
          icon={<IconDoubleCheck size={20} />}
          label="Read receipts"
          description="Let people on your trips see when you have read the chat."
          checked={receipts}
          onChange={setReadReceipts}
          disabled={pendingReceipts !== null}
        />
        <SettingsLink href="/settings/blocked" icon={<IconBan size={20} />} label="Blocked people" description="People you have blocked, and how to unblock them." />
        <SettingsLink href="/settings/history" icon={<IconHistory size={20} />} label="Travel history" description="The trips you have been on, and your trust score over time." />
      </SettingsSection>
      <ErrorText>{error}</ErrorText>

      <SettingsSection title="Notifications">
        <SettingsLink href="/settings/notifications" icon={<IconBell size={20} />} label="Notifications" description="Alerts for join requests and new messages on this device." />
      </SettingsSection>

      <SettingsSection title="Account">
        <SettingsLink href="/settings/account" icon={<IconUser size={20} />} label="Account and data" description="Confirm your email, download your data, or delete your account." />
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsLink href="/terms" icon={<IconInfo size={20} />} label="Terms of use" />
        <SettingsLink href="/privacy" icon={<IconInfo size={20} />} label="Privacy policy" />
      </SettingsSection>

      <div className="mt-8">
        <Button variant="secondary" onClick={handleLogout}>
          <IconLogout size={20} />
          Log out
        </Button>
      </div>
    </main>
  );
}
