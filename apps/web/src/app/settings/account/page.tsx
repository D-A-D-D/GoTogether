'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useRequireAuth } from '@/lib/use-require-auth';
import { AccountSettings } from '@/app/profile/account-settings';
import { EmailVerification } from '@/app/profile/email-verification';
import { Button } from '@/components/ui';
import { IconLogout } from '@/components/icons';

export default function AccountPage() {
  const status = useRequireAuth();
  const { logout } = useAuth();
  const router = useRouter();
  if (status !== 'authenticated') return null;

  async function handleLogout() {
    await logout();
    router.push('/');
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-4">
      <h1 className="sr-only">Account and data</h1>
      <EmailVerification />
      <div className="-mt-8">
        <AccountSettings />
      </div>
      <div className="mt-10 border-t border-line pt-6">
        <Button variant="secondary" onClick={handleLogout}>
          <IconLogout size={20} />
          Log out
        </Button>
      </div>
    </main>
  );
}
