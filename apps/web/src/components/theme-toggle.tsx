'use client';

import { IconMoon, IconSun } from '@/components/icons';
import { IconButton } from '@/components/ui';
import { useIsDark, usePreferences } from '@/lib/use-preferences';

/** One press between light and dark. The full choice (including "match my device") is in Settings. */
export function ThemeToggle({ className }: { className?: string }) {
  const [, update] = usePreferences();
  const dark = useIsDark();
  return (
    <IconButton label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => update({ theme: dark ? 'light' : 'dark' })} className={className}>
      {dark ? <IconSun size={24} /> : <IconMoon size={24} />}
    </IconButton>
  );
}
